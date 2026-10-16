export type Coord = number;
export type Orientation = 'horizontal' | 'vertical';
export type Difficulty = 'easy' | 'normal';
export type Side = 'player' | 'ai';
export type PlacementRule = 'classic' | 'adjacent-allowed';
export type KnownCell = 'unknown' | 'miss' | 'hit' | 'sunk';
export interface ShipSpec { id: string; name: string; length: number }
export interface Ship extends ShipSpec { cells: number[] }
export interface ShotEvent {
  id: string; turnIndex: number; attacker: Side; coord: Coord; result: 'miss' | 'hit' | 'sunk';
  sunkShip?: Ship; winner?: Side; aiDiagnostics?: AIDiagnostics;
}
export interface MatchRules {
  readonly shellsPerTurn: number;
  /** Explicit legacy/current rule. Touching is allowed; only overlap is forbidden. */
  readonly placement: PlacementRule;
}
/** The full precommitted plan, including any unused tail after a winning shot. */
export interface VolleyRecord { attacker: Side; coords: Coord[] }
export interface GameState {
  version: 2; matchId: string; difficulty: Difficulty; rules: MatchRules; volleys: VolleyRecord[];
  fleets: { player: Ship[]; ai: Ship[] }; shots: { player: number[]; ai: number[] };
  turn: Side; winner: Side | null; events: ShotEvent[]; aiRngState: number;
}
/** The only attack-policy input: no hidden fleet, placement seed or game store. */
export interface AIObservation {
  /** Omitted only by legacy callers; omission explicitly retains adjacency. */
  readonly placementRule?: PlacementRule;
  readonly width: 10; readonly height: 10; readonly knownEnemyBoard: readonly KnownCell[];
  readonly remainingEnemyLengths: readonly number[]; readonly publicSunkShips: readonly (readonly number[])[]; readonly turnIndex: number;
}
export interface AIDiagnostics {
  strategy: 'easy' | 'normal' | 'fallback'; samples: number; nodes: number; elapsedMs: number;
  timedOut: boolean; degraded: boolean; reason?: string;
}
export interface AIDecision { coord: Coord; rngState: number; diagnostics: AIDiagnostics }
export interface AIVolleyDecision extends AIDecision { coords: Coord[] }
export const BOARD_SIZE = 10, BOARD_CELLS = 100, SAVE_VERSION = 2;
export const FLEET_SPECS: readonly Readonly<ShipSpec>[] = Object.freeze([
  Object.freeze({ id: 'carrier', name: '航空母舰', length: 5 }),
  Object.freeze({ id: 'battleship', name: '战列舰', length: 4 }),
  Object.freeze({ id: 'cruiser', name: '巡洋舰', length: 3 }),
  Object.freeze({ id: 'submarine', name: '潜艇', length: 3 }),
  Object.freeze({ id: 'destroyer', name: '驱逐舰', length: 2 }),
]);
