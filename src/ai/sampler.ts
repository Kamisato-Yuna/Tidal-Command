import { RNG } from '../core/random';
import { allPlacements, boundaryContactEdges, isStraightShip, shipsTouch } from '../core/placement';
import type { AIObservation } from '../core/types';
import { validateObservation } from './observation';
export interface CandidateShip { length: number; cells: number[]; hitCount: number; mask: bigint; hits: bigint }
export interface FleetSample { ships: CandidateShip[] }
export interface SamplingBudget { maxSamples?: number; maxNodes?: number; maxMs?: number }
export interface SamplingResult { samples: FleetSample[]; candidates: CandidateShip[]; nodes: number; timedOut: boolean; nodeLimit: boolean; elapsedMs: number }
const BIT = Array.from({ length: 100 }, (_, i) => 1n << BigInt(i));
function neighborhoodMask(cells: readonly number[]): bigint {
  let mask = 0n;
  for (const c of cells) {
    const row = Math.floor(c / 10), col = c % 10;
    for (let y = Math.max(0, row - 1); y <= Math.min(9, row + 1); y++) for (let x = Math.max(0, col - 1); x <= Math.min(9, col + 1); x++) mask |= BIT[y * 10 + x]!;
  }
  return mask;
}
const PLACEMENTS = new Map([2, 3, 4, 5].map(length => [length, allPlacements(length).map(cells => ({ cells, mask: cells.reduce((mask, c) => mask | BIT[c]!, 0n), blockedMask: neighborhoodMask(cells), boundaryEdges: boundaryContactEdges(cells) }))]));
const CLASSIC_BLOCKS = new Map([...PLACEMENTS.values()].flatMap(placements => placements.map(p => [p.mask, p.blockedMask] as const)));
export function buildCandidates(observation: AIObservation): CandidateShip[] {
  const board = observation.knownEnemyBoard, result: CandidateShip[] = [];
  const classic = (observation.placementRule ?? 'adjacent-allowed') === 'classic';
  const sunkBlock = classic ? neighborhoodMask(observation.publicSunkShips.flatMap(cells => [...cells])) : 0n;
  const allHits = classic ? board.reduce((mask, known, c) => known === 'hit' ? mask | BIT[c]! : mask, 0n) : 0n;
  for (const length of new Set(observation.remainingEnemyLengths)) for (const placement of PLACEMENTS.get(length) || []) {
    if (placement.cells.some(c => board[c] === 'miss' || board[c] === 'sunk')) continue;
    if (classic && (placement.boundaryEdges > 1 || (placement.mask & sunkBlock) !== 0n)) continue;
    // A touching unresolved hit must belong to this same ship under the classic rule.
    // Do not merge disconnected hit groups: exact-cover search decides their ownership.
    if (classic && (placement.blockedMask & allHits & ~placement.mask) !== 0n) continue;
    const hits = placement.cells.filter(c => board[c] === 'hit');
    if (hits.length === length) continue; // Such a ship would already be publicly sunk.
    result.push({ cells: placement.cells, mask: placement.mask, length, hitCount: hits.length, hits: hits.reduce((mask, c) => mask | BIT[c]!, 0n) });
  }
  return result;
}
/** Randomized exact-cover search. Samples are constrained but not uniform/posterior-exact. */
export function sampleFleets(observation: AIObservation, rng: RNG, budget: SamplingBudget = {}): SamplingResult {
  validateObservation(observation);
  const started = performance.now(), maxSamples = Math.max(1, Math.min(5000, budget.maxSamples ?? 640));
  const maxNodes = Math.max(1, Math.min(500000, budget.maxNodes ?? 48000)), maxMs = Math.max(1, Math.min(900, budget.maxMs ?? 420));
  const classic = (observation.placementRule ?? 'adjacent-allowed') === 'classic';
  const candidates = buildCandidates(observation), byLength = new Map<number, CandidateShip[]>(), byHit = new Map<number, CandidateShip[]>();
  const hitCells = observation.knownEnemyBoard.flatMap((c, i) => c === 'hit' ? [i] : []);
  for (const length of new Set(observation.remainingEnemyLengths)) byLength.set(length, candidates.filter(c => c.length === length));
  for (const hit of hitCells) byHit.set(hit, candidates.filter(c => c.cells.includes(hit)));
  const allHits = hitCells.reduce((mask, c) => mask | BIT[c]!, 0n), samples: FleetSample[] = [];
  let nodes = 0, timedOut = false, nodeLimit = false;
  const expired = (): boolean => {
    if (nodes >= maxNodes) { nodeLimit = true; return true; }
    if ((nodes & 63) === 0 && performance.now() - started >= maxMs) { timedOut = true; return true; }
    return false;
  };
  function search(remaining: number[], used: bigint, uncovered: bigint, ships: CandidateShip[]): CandidateShip[] | null {
    if (expired()) return null; nodes++;
    if (!remaining.length) return uncovered === 0n ? ships : null;
    let options: CandidateShip[] = [];
    if (uncovered !== 0n) {
      let smallest = Infinity;
      for (const cell of hitCells) {
        if (!(uncovered & BIT[cell]!)) continue;
        const compatible = (byHit.get(cell) || []).filter(p => remaining.includes(p.length) && !(p.mask & used));
        if (!compatible.length) return null;
        if (compatible.length < smallest) { smallest = compatible.length; options = compatible; }
      }
    } else { const length = Math.max(...remaining); options = (byLength.get(length) || []).filter(p => !(p.mask & used)); }
    if (!options.length) return null;
    const offset = rng.int(options.length);
    let stride = options.length > 1 ? 1 + rng.int(options.length - 1) : 1;
    const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
    while (gcd(stride, options.length) !== 1) stride = stride % options.length + 1;
    for (let i = 0; i < options.length; i++) {
      const ship = options[(offset + i * stride) % options.length]!, next = [...remaining]; next.splice(next.indexOf(ship.length), 1);
      const result = search(next, used | (classic ? CLASSIC_BLOCKS.get(ship.mask)! : ship.mask), uncovered & ~ship.hits, [...ships, ship]);
      if (result) return result; if (timedOut || nodeLimit) return null;
    }
    return null;
  }
  while (samples.length < maxSamples && !timedOut && !nodeLimit) {
    const ships = search([...observation.remainingEnemyLengths], 0n, allHits, []);
    if (ships) samples.push({ ships }); else break;
    if (performance.now() - started >= maxMs) { timedOut = true; break; }
  }
  return { samples, candidates, nodes, timedOut, nodeLimit, elapsedMs: performance.now() - started };
}
export function validateFleetSample(observation: AIObservation, sample: FleetSample): boolean {
  const cells = sample.ships.flatMap(s => s.cells);
  if ((observation.placementRule ?? 'adjacent-allowed') === 'classic') {
    const sunkCells = observation.publicSunkShips.flatMap(ship => [...ship]);
    for (let i = 0; i < sample.ships.length; i++) {
      const ship = sample.ships[i]!;
      if (boundaryContactEdges(ship.cells) > 1 || shipsTouch(ship.cells, sunkCells)) return false;
      if (sample.ships.slice(0, i).some(other => shipsTouch(ship.cells, other.cells))) return false;
    }
  }
  if (new Set(cells).size !== cells.length || cells.some(c => observation.knownEnemyBoard[c] === 'miss' || observation.knownEnemyBoard[c] === 'sunk')) return false;
  if (JSON.stringify(sample.ships.map(s => s.length).sort()) !== JSON.stringify([...observation.remainingEnemyLengths].sort())) return false;
  if (observation.knownEnemyBoard.some((known, cell) => known === 'hit' && !cells.includes(cell))) return false;
  return sample.ships.every(s => s.cells.length === s.length && isStraightShip(s.cells) && s.hitCount === s.cells.filter(c => observation.knownEnemyBoard[c] === 'hit').length && s.cells.some(c => observation.knownEnemyBoard[c] === 'unknown'));
}
