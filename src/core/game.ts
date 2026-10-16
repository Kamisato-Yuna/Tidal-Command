import { FLEET_SPECS, type AIObservation, type Coord, type Difficulty, type GameState, type KnownCell, type Ship, type ShotEvent, type Side } from './types';
import { independentSeed } from './random';
import { isCoord, randomFleet, validateFleet } from './placement';
export function opponent(side: Side): Side { return side === 'player' ? 'ai' : 'player'; }
export function cloneFleet(fleet: readonly Ship[]): Ship[] { return fleet.map(s => ({ ...s, cells: [...s.cells] })); }
export function createGame(playerFleet: readonly Ship[], difficulty: Difficulty, options: { matchId?: string; aiRngState?: number; enemyFleet?: readonly Ship[]; placementSeed?: number } = {}): GameState {
  if (difficulty !== 'easy' && difficulty !== 'normal') throw new Error('难度无效');
  const enemyFleet = options.enemyFleet ?? randomFleet(options.placementSeed ?? independentSeed(), difficulty);
  for (const fleet of [playerFleet, enemyFleet]) { const check = validateFleet(fleet); if (!check.valid) throw new Error(check.errors.join('；')); }
  const matchId = options.matchId ?? (globalThis.crypto?.randomUUID?.() || `match-${Date.now()}-${independentSeed()}`);
  return { version: 1, matchId, difficulty, fleets: { player: cloneFleet(playerFleet), ai: cloneFleet(enemyFleet) }, shots: { player: [], ai: [] }, turn: 'player', winner: null, events: [], aiRngState: (options.aiRngState ?? independentSeed()) >>> 0 || 1 };
}
/** Immutable atomic transition: animations cannot apply damage or complete a turn. */
export function applyShot(state: GameState, side: Side, coord: Coord): { state: GameState; event: ShotEvent } {
  if (state.winner) throw new Error('本局已结束');
  if (side !== state.turn) throw new Error('还未轮到这一方');
  if (!isCoord(coord)) throw new Error('目标不在棋盘内');
  if (state.shots[side].includes(coord)) throw new Error('此坐标已经攻击过');
  const target = opponent(side), shots = [...state.shots[side], coord];
  const hitShip = state.fleets[target].find(s => s.cells.includes(coord));
  const isSunk = hitShip && hitShip.cells.every(c => shots.includes(c));
  const winner = state.fleets[target].every(s => s.cells.every(c => shots.includes(c))) ? side : null;
  const event: ShotEvent = { id: `${state.matchId}:${state.events.length + 1}`, turnIndex: state.events.length + 1, attacker: side, coord,
    result: isSunk ? 'sunk' : hitShip ? 'hit' : 'miss', ...(isSunk ? { sunkShip: { ...hitShip, cells: [...hitShip.cells] } } : {}), ...(winner ? { winner } : {}) };
  return { event, state: { ...state, shots: { ...state.shots, [side]: shots }, turn: opponent(side), winner, events: [...state.events, event] } };
}
export function getKnownBoard(state: GameState, attacker: Side): KnownCell[] {
  const known: KnownCell[] = Array<KnownCell>(100).fill('unknown');
  for (const event of state.events) { if (event.attacker !== attacker) continue; known[event.coord] = event.result === 'miss' ? 'miss' : 'hit'; if (event.sunkShip) for (const cell of event.sunkShip.cells) known[cell] = 'sunk'; }
  return known;
}
export function getSunkShips(state: GameState, target: Side): Ship[] {
  return state.events.filter(e => e.attacker === opponent(target) && e.sunkShip).map(e => ({ ...e.sunkShip!, cells: [...e.sunkShip!.cells] }));
}
export function visibleShips(state: GameState, target: Side): Ship[] { return target === 'player' || state.winner ? cloneFleet(state.fleets[target]) : getSunkShips(state, target); }
export function projectObservation(state: GameState, attacker: Side): AIObservation {
  const sunk = getSunkShips(state, opponent(attacker)), remaining = FLEET_SPECS.map(s => s.length);
  for (const s of sunk) { const index = remaining.indexOf(s.length); if (index >= 0) remaining.splice(index, 1); }
  return { width: 10, height: 10, knownEnemyBoard: getKnownBoard(state, attacker), remainingEnemyLengths: remaining, publicSunkShips: sunk.map(s => [...s.cells]), turnIndex: state.events.length + 1 };
}
export interface BattleStats { shots: number; hits: number; accuracy: number; sunkOrder: string[] }
export function battleStats(state: GameState, attacker: Side): BattleStats {
  const events = state.events.filter(e => e.attacker === attacker), hits = events.filter(e => e.result !== 'miss').length;
  return { shots: events.length, hits, accuracy: events.length ? hits / events.length : 0, sunkOrder: events.flatMap(e => e.sunkShip ? [e.sunkShip.name] : []) };
}
export function findAdjacentHitPair(state: GameState, attacker: Side = 'player'): [number, number] | null {
  if (!state.winner) return null;
  const fleet = state.fleets[opponent(attacker)], hits = state.events.filter(e => e.attacker === attacker && e.result !== 'miss').map(e => e.coord);
  for (const a of hits) for (const b of hits) {
    if (a >= b || Math.abs(a % 10 - b % 10) + Math.abs(Math.floor(a / 10) - Math.floor(b / 10)) !== 1) continue;
    const first = fleet.find(s => s.cells.includes(a)), second = fleet.find(s => s.cells.includes(b));
    if (first && second && first.id !== second.id) return [a, b];
  }
  return null;
}
