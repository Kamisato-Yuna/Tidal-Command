import { BOARD_CELLS, FLEET_SPECS, type Coord, type Orientation, type Ship } from './types';
import { RNG, independentSeed } from './random';
export function isCoord(value: unknown): value is Coord { return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < BOARD_CELLS; }
export function formatCoord(coord: Coord): string { return isCoord(coord) ? `${String.fromCharCode(65 + coord % 10)}${Math.floor(coord / 10) + 1}` : '—'; }
export function placementCells(start: Coord, length: number, orientation: Orientation): number[] {
  if (!isCoord(start) || !Number.isInteger(length) || length < 1 || length > 10) return [];
  const col = start % 10, row = Math.floor(start / 10);
  if (orientation === 'horizontal' && col + length <= 10) return Array.from({ length }, (_, i) => start + i);
  if (orientation === 'vertical' && row + length <= 10) return Array.from({ length }, (_, i) => start + i * 10);
  return [];
}
export function isStraightShip(cells: readonly number[]): boolean {
  if (!cells.length || cells.some(c => !isCoord(c)) || new Set(cells).size !== cells.length) return false;
  const ordered = [...cells].sort((a, b) => a - b);
  return ordered.every((c, i) => c === ordered[0]! + i && Math.floor(c / 10) === Math.floor(ordered[0]! / 10)) || ordered.every((c, i) => c === ordered[0]! + i * 10);
}
export function canPlaceShip(cells: readonly number[], fleet: readonly Ship[], ignoreShipId?: string): boolean {
  if (!isStraightShip(cells)) return false;
  const occupied = new Set(fleet.filter(s => s.id !== ignoreShipId).flatMap(s => s.cells));
  return cells.every(c => !occupied.has(c));
}
export function validateFleet(fleet: readonly Ship[], requireComplete = true): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!Array.isArray(fleet)) return { valid: false, errors: ['舰队格式无效'] };
  if (requireComplete && fleet.length !== 5) errors.push('需要部署全部五艘舰船');
  const ids = new Set<string>(), occupied = new Set<number>();
  for (const ship of fleet) {
    if (!ship || typeof ship !== 'object') { errors.push('舰船格式无效'); continue; }
    const spec = FLEET_SPECS.find(s => s.id === ship.id);
    if (!spec || spec.length !== ship.length || spec.name !== ship.name) errors.push('舰船型号无效');
    if (ids.has(ship.id)) errors.push('舰船重复'); ids.add(ship.id);
    if (!Array.isArray(ship.cells) || ship.cells.length !== ship.length || !isStraightShip(ship.cells)) { errors.push('舰船必须在棋盘内连续横向或纵向摆放'); continue; }
    for (const c of ship.cells) { if (occupied.has(c)) errors.push('舰船不能重叠'); occupied.add(c); }
  }
  return { valid: errors.length === 0, errors };
}
export function allPlacements(length: number): number[][] {
  const result: number[][] = [];
  for (let c = 0; c < 100; c++) for (const orientation of ['horizontal', 'vertical'] as const) { const cells = placementCells(c, length, orientation); if (cells.length) result.push(cells); }
  return result;
}
function touches(cells: readonly number[], occupied: readonly number[]): boolean {
  return cells.some(a => occupied.some(b => Math.abs(a % 10 - b % 10) <= 1 && Math.abs(Math.floor(a / 10) - Math.floor(b / 10)) <= 1));
}
export type FleetStyle = 'random' | 'easy' | 'normal' | 'edge' | 'adjacent' | 'dispersed';
/** Procedural, nonuniform generator. It never receives an opponent board. */
export function randomFleet(seed = independentSeed(), style: FleetStyle = 'random'): Ship[] {
  const rng = new RNG(seed);
  if (style === 'normal') return selectDefensiveFleet(rng);
  const mode = style;
  for (let restart = 0; restart < 40; restart++) {
    const fleet: Ship[] = [];
    for (const spec of FLEET_SPECS) {
      let choices = allPlacements(spec.length).filter(c => canPlaceShip(c, fleet));
      const occupied = fleet.flatMap(s => s.cells);
      if (mode === 'easy' || mode === 'dispersed') { const separate = choices.filter(c => !touches(c, occupied)); if (separate.length) choices = separate; }
      else if (mode === 'adjacent' && fleet.length && rng.next() < 0.8) { const near = choices.filter(c => touches(c, occupied)); if (near.length) choices = near; }
      else if (mode === 'edge') { const nearEdge = choices.filter(c => c.some(n => n % 10 === 0 || n % 10 === 9 || n < 10 || n >= 90)); if (nearEdge.length && rng.next() < 0.8) choices = nearEdge; }
      if (!choices.length) break;
      fleet.push({ ...spec, cells: [...rng.pick(choices)] });
    }
    if (validateFleet(fleet).valid) return fleet;
  }
  throw new Error('无法生成完整舰队');
}
/** The evaluator knows its candidate fleet; each simulated attacker sees only marks. */
function defenseTrial(fleet: Ship[], seed: number, policy: 'random' | 'hunt' | 'easy'): number {
  const rng = new RNG(seed), board = new Uint8Array(100), owner = new Int8Array(100).fill(-1);
  const left = fleet.map(s => s.length); fleet.forEach((s, i) => s.cells.forEach(c => { owner[c] = i; }));
  let remaining = 17;
  for (let shots = 1; shots <= 100; shots++) {
    const unknown: number[] = [], parity: number[] = [], chase = new Set<number>(), extension = new Set<number>();
    for (let c = 0; c < 100; c++) {
      if (board[c] === 0) { unknown.push(c); if ((c % 10 + Math.floor(c / 10)) % 2 === 0) parity.push(c); }
      if (board[c] !== 2) continue;
      const next = [c % 10 > 0 ? c - 1 : -1, c % 10 < 9 ? c + 1 : -1, c >= 10 ? c - 10 : -1, c < 90 ? c + 10 : -1];
      for (const n of next) {
        if (n < 0) continue;
        if (board[n] === 0) chase.add(n);
        if (board[n] === 2) { const beyond = n + n - c; if (isCoord(beyond) && Math.abs(beyond % 10 - n % 10) + Math.abs(Math.floor(beyond / 10) - Math.floor(n / 10)) === 1 && board[beyond] === 0) extension.add(beyond); }
      }
    }
    let pool = unknown;
    if (policy !== 'random' && chase.size && (policy === 'hunt' || rng.next() < 0.65)) pool = [...(extension.size ? extension : chase)];
    else if (policy === 'hunt' && parity.length) pool = parity;
    const cell = rng.pick(pool), ship = owner[cell]!; board[cell] = ship < 0 ? 1 : 2;
    if (ship >= 0) { remaining--; left[ship]!--; if (!left[ship]) for (const c of fleet[ship]!.cells) board[c] = 3; if (!remaining) return shots; }
  }
  return 100;
}
function selectDefensiveFleet(rng: RNG): Ship[] {
  const modes: FleetStyle[] = ['random', 'adjacent', 'edge', 'dispersed'];
  const evaluationSeeds = Array.from({ length: 8 }, () => rng.int(0xffffffff) || 1);
  const candidates = Array.from({ length: 24 }, (_, i) => {
    const fleet = randomFleet(rng.int(0xffffffff), modes[i % modes.length]!);
    const costs = evaluationSeeds.map((seed, j) => defenseTrial(fleet, seed, j < 4 ? 'hunt' : j < 7 ? 'easy' : 'random'));
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length, low = Math.min(...costs.slice(0, 7));
    return { fleet, score: mean + low * 0.18 };
  }).sort((a, b) => b.score - a.score);
  return rng.pick(candidates.filter(c => c.score >= candidates[0]!.score * 0.97).slice(0, 5)).fleet;
}
