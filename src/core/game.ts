import { FLEET_SPECS, type AIObservation, type Coord, type Difficulty, type GameState, type KnownCell, type Ship, type ShotEvent, type Side, type PlacementRule } from './types';
import { independentSeed } from './random';
import { isCoord, randomFleet, validateFleet } from './placement';
export function opponent(side: Side): Side { return side === 'player' ? 'ai' : 'player'; }
export function cloneFleet(fleet: readonly Ship[]): Ship[] { return fleet.map(s => ({ ...s, cells: [...s.cells] })); }
export interface CreateGameOptions { matchId?: string; aiRngState?: number; enemyFleet?: readonly Ship[]; placementSeed?: number; shellsPerTurn?: number; placementRule?: PlacementRule }
export function createGame(playerFleet: readonly Ship[], difficulty: Difficulty, options: CreateGameOptions = {}): GameState {
  if (difficulty !== 'easy' && difficulty !== 'normal') throw new Error('难度无效');
  const shellsPerTurn = options.shellsPerTurn ?? 1;
  if (!Number.isInteger(shellsPerTurn) || shellsPerTurn < 1 || shellsPerTurn > 5) throw new Error('每回合炮弹数必须为 1 至 5');
  const placementRule = options.placementRule ?? 'classic';
  if (placementRule !== 'classic' && placementRule !== 'adjacent-allowed') throw new Error('部署规则无效');
  const enemyFleet = options.enemyFleet ?? randomFleet(options.placementSeed ?? independentSeed(), difficulty, placementRule);
  for (const fleet of [playerFleet, enemyFleet]) { const check = validateFleet(fleet, true, placementRule); if (!check.valid) throw new Error(check.errors.join('；')); }
  const matchId = options.matchId ?? (globalThis.crypto?.randomUUID?.() || `match-${Date.now()}-${independentSeed()}`);
  return { version: 2, matchId, difficulty, rules: Object.freeze({ shellsPerTurn, placement: placementRule }), volleys: [], fleets: { player: cloneFleet(playerFleet), ai: cloneFleet(enemyFleet) }, shots: { player: [], ai: [] }, turn: 'player', winner: null, events: [], aiRngState: (options.aiRngState ?? independentSeed()) >>> 0 || 1 };
}
/** Both sides use the same fixed match quota, capped only by unknown coordinates. */
export function getShotQuota(state: GameState, side: Side = state.turn): number {
  if (side !== 'player' && side !== 'ai') throw new Error('攻击方无效');
  return state.winner ? 0 : Math.min(state.rules.shellsPerTurn, 100 - state.shots[side].length);
}
/** A round contains one player turn and one AI turn, regardless of shell count. */
export function getRoundNumber(state: GameState): number {
  return state.winner ? Math.max(1, Math.ceil(state.volleys.length / 2)) : Math.floor(state.volleys.length / 2) + 1;
}
/** Immutable atomic salvo. Validate the ENTIRE plan before resolving any damage. */
export function applyVolley(state: GameState, side: Side, coords: readonly Coord[]): { state: GameState; events: ShotEvent[] } {
  if (state.winner) throw new Error('本局已结束');
  if (side !== 'player' && side !== 'ai') throw new Error('攻击方无效');
  if (side !== state.turn) throw new Error('还未轮到这一方');
  if (!Array.isArray(coords) || coords.length !== getShotQuota(state, side)) throw new Error(`请选择 ${getShotQuota(state, side)} 个目标`);
  if (Array.from(coords).some(coord => !isCoord(coord))) throw new Error('目标不在棋盘内');
  if (new Set(coords).size !== coords.length) throw new Error('同一轮目标不能重复');
  if (coords.some(coord => state.shots[side].includes(coord))) throw new Error('此坐标已经攻击过');
  const target = opponent(side), shots = [...state.shots[side]], events: ShotEvent[] = [];
  let winner: Side | null = null;
  for (const coord of coords) {
    shots.push(coord);
    const hitShip = state.fleets[target].find(s => s.cells.includes(coord));
    const isSunk = hitShip && hitShip.cells.every(c => shots.includes(c));
    winner = state.fleets[target].every(s => s.cells.every(c => shots.includes(c))) ? side : null;
    const turnIndex = state.events.length + events.length + 1;
    events.push({ id: `${state.matchId}:${turnIndex}`, turnIndex, attacker: side, coord,
      result: isSunk ? 'sunk' : hitShip ? 'hit' : 'miss', ...(isSunk ? { sunkShip: { ...hitShip, cells: [...hitShip.cells] } } : {}), ...(winner ? { winner } : {}) });
    if (winner) break;
  }
  return { events, state: { ...state, shots: { ...state.shots, [side]: shots }, turn: opponent(side), winner, events: [...state.events, ...events], volleys: [...state.volleys, { attacker: side, coords: [...coords] }] } };
}
/** Compatibility API for one-shell matches; multi-shell games must commit a plan. */
export function applyShot(state: GameState, side: Side, coord: Coord): { state: GameState; event: ShotEvent } {
  if (state.rules.shellsPerTurn !== 1) throw new Error('齐射对局必须一次提交全部目标');
  const result = applyVolley(state, side, [coord]);
  return { state: result.state, event: result.events[0]! };
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
  return { width: 10, height: 10, placementRule: state.rules.placement, knownEnemyBoard: getKnownBoard(state, attacker), remainingEnemyLengths: remaining, publicSunkShips: sunk.map(s => [...s.cells]), turnIndex: state.events.length + 1 };
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
