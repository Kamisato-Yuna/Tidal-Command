import { describe, expect, it } from 'vitest';
import { FLEET_SPECS, applyShot, createGame as createGameWithRules, getKnownBoard, getSunkShips, placementCells, canPlaceShip as canPlaceShipWithRules, validateFleet as validateFleetWithRules, randomFleet as randomFleetWithRules, projectObservation, visibleShips, type Ship, type GameState, type Side } from '../src/core';
// Original v1 fixtures intentionally retain touching ships and edge placements.
const createGame: typeof createGameWithRules = (fleet, difficulty, options = {}) => createGameWithRules(fleet, difficulty, { placementRule: 'adjacent-allowed', ...options });
const canPlaceShip: typeof canPlaceShipWithRules = (cells, fleet, ignoreId) => canPlaceShipWithRules(cells, fleet, ignoreId, 'adjacent-allowed');
const validateFleet: typeof validateFleetWithRules = (fleet, complete = true) => validateFleetWithRules(fleet, complete, 'adjacent-allowed');
const randomFleet: typeof randomFleetWithRules = (seed, style) => randomFleetWithRules(seed, style, 'adjacent-allowed');
const fleet = (): Ship[] => FLEET_SPECS.map((s, i) => ({ ...s, cells: placementCells(i * 20, s.length, 'horizontal') }));
function fireAs(state: GameState, side: Side, coord: number): GameState {
  if (state.turn !== side) state = applyShot(state, state.turn, Array.from({ length: 100 }, (_, i) => i).find(i => !state.shots[state.turn].includes(i) && !state.fleets[side].some(s => s.cells.includes(i)))!).state;
  return applyShot(state, side, coord).state;
}
describe('legacy adjacent-allowed fleet rules', () => {
  it('has the exact distinct five-ship, 17-cell fleet', () => {
    expect(FLEET_SPECS.map(s => s.length)).toEqual([5, 4, 3, 3, 2]); expect(new Set(FLEET_SPECS.map(s => s.id)).size).toBe(5); expect(validateFleet(fleet()).valid).toBe(true);
  });
  it('rejects wrapped, out of range, diagonal, gaps, duplicates and overlaps', () => {
    expect(placementCells(9, 2, 'horizontal')).toEqual([]); expect(placementCells(91, 2, 'vertical')).toEqual([]);
    for (const cells of [[9, 10], [1, 12], [1, 3], [1, 1], [-1, 0], [99, 100]]) expect(canPlaceShip(cells, [])).toBe(false);
    expect(canPlaceShip([0, 1], fleet())).toBe(false); const invalid = fleet(); invalid[1]!.cells[0] = 0; expect(validateFleet(invalid).valid).toBe(false);
  });
  it('permits edge and corner touching under one legality rule', () => {
    const existing = [{ ...FLEET_SPECS[4]!, cells: [0, 1] }];
    expect(canPlaceShip([2, 3, 4], existing)).toBe(true); expect(canPlaceShip([10, 20, 30], existing)).toBe(true); expect(canPlaceShip([12, 22, 32], existing)).toBe(true);
  });
  it('generates complete valid fleets under 600 diverse deterministic seeds', () => {
    for (let i = 1; i <= 100; i++) for (const style of ['random', 'easy', 'normal', 'edge', 'adjacent', 'dispersed'] as const) expect(validateFleet(randomFleet(i, style)).valid).toBe(true);
    expect(new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(randomFleet(i + 100, 'normal')))).size).toBe(40);
  }, 20000);
});
describe('atomic turns and public information', () => {
  it('changes turn even on a hit and rejects invalid/repeated/late attacks', () => {
    const initial = createGame(fleet(), 'easy', { enemyFleet: fleet(), matchId: 'test', aiRngState: 42 }), result = applyShot(initial, 'player', 0);
    expect(result.event).toEqual({ id: 'test:1', turnIndex: 1, attacker: 'player', coord: 0, result: 'hit' }); expect(result.state.turn).toBe('ai'); expect(initial.events).toHaveLength(0);
    expect(() => applyShot(result.state, 'player', 1)).toThrow(); const back = applyShot(result.state, 'ai', 99).state;
    expect(() => applyShot(back, 'player', 0)).toThrow(); expect(() => applyShot(back, 'player', 100)).toThrow();
  });
  it('reveals only sunk cells, leaving touching hits unresolved and neighbors unknown', () => {
    const enemy = fleet(); enemy[2]!.cells = [42, 43, 44]; enemy[3]!.cells = [54, 64, 74];
    let state = createGame(fleet(), 'normal', { enemyFleet: enemy }); for (const c of [44, 54, 42, 43]) state = fireAs(state, 'player', c);
    const board = getKnownBoard(state, 'player'); expect(board[44]).toBe('sunk'); expect(board[54]).toBe('hit'); expect(board[55]).toBe('unknown');
    expect(getSunkShips(state, 'ai')).toHaveLength(1); expect(projectObservation(state, 'player').remainingEnemyLengths).toEqual([5, 4, 3, 2]); expect(visibleShips(state, 'ai')).toHaveLength(1);
    expect(state.events.filter(e => e.result === 'hit').every(e => e.sunkShip === undefined)).toBe(true);
  });
  it('wins exactly once, holds layouts fixed, and never requires animation callbacks', () => {
    let state = createGame(fleet(), 'easy', { enemyFleet: fleet() }); const layout = JSON.stringify(state.fleets);
    for (const c of fleet().flatMap(s => s.cells)) state = fireAs(state, 'player', c);
    expect(state.winner).toBe('player'); expect(state.shots.player).toHaveLength(17); expect(JSON.stringify(state.fleets)).toBe(layout);
    expect(() => applyShot(state, 'ai', 98)).toThrow('本局已结束'); expect(state.events.filter(e => e.winner)).toHaveLength(1);
  });
});
