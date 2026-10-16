import { describe, expect, it } from 'vitest';
import { FLEET_SPECS, applyVolley, createGame, parseGameSave, serializeGame, type GameState, type Ship, type ShotEvent, type VolleyRecord } from '../src/core';
import { initialDeployment, selectDeploymentShip, moveDeploymentShip, rotateDeploymentShip, clickDeploymentCell, deactivateDeployment, finishDeploymentMove } from '../src/ui/deployment';
import { previousRoundShots } from '../src/ui/roundMarkers';

const fleet = (): Ship[] => FLEET_SPECS.map((spec, i) => ({ ...spec, cells: Array.from({ length: spec.length }, (_, n) => (i === 4 ? 77 : 11 + i * 20) + n) }));
const placed = () => clickDeploymentCell(initialDeployment(), 11);
const carrierCells = (state: ReturnType<typeof initialDeployment>) => state.fleet.find(s => s.id === 'carrier')?.cells;
const pose = (row: number, col: number, orientation: 'horizontal' | 'vertical' = 'horizontal') => ({ row, col, orientation });

describe('tentative placement transactions', () => {
  it('commits valid click and rotation while retaining an active draft', () => {
    const first = placed();
    expect(carrierCells(first)).toEqual([11, 12, 13, 14, 15]);
    expect(first.draft?.placement).toEqual(pose(1, 1));
    expect(first.draft?.valid).toBe(true);
    const rotated = rotateDeploymentShip(first);
    expect(carrierCells(rotated)).toEqual([11, 21, 31, 41, 51]);
    expect(rotated.orientation).toBe('vertical');
    expect(first.draft?.placement).toEqual(pose(1, 1));
  });

  it('retains an invalid attempted move without changing the last valid committed ship', () => {
    const first = placed(), before = JSON.stringify(first);
    const invalid = moveDeploymentShip(first, 'carrier', pose(2, 8));
    expect(invalid.draft?.valid).toBe(false);
    expect(invalid.draft?.placement).toEqual(pose(2, 8));
    expect(invalid.selectedShipId).toBe('carrier');
    expect(carrierCells(invalid)).toEqual([11, 12, 13, 14, 15]);
    expect(JSON.stringify(first)).toBe(before);
    const restored = deactivateDeployment(invalid);
    expect(carrierCells(restored)).toEqual([11, 12, 13, 14, 15]);
    expect(restored.draft).toBe(null);
    expect(restored.selectedShipId).toBe(null);
    expect(restored.notice).toContain('恢复');
  });

  it('removes an initially unplaced invalid ship only on blur', () => {
    const invalid = clickDeploymentCell(initialDeployment(), 0);
    expect(invalid.fleet).toHaveLength(0);
    expect(invalid.draft?.id).toBe('carrier');
    expect(invalid.draft?.valid).toBe(false);
    expect(invalid.draft?.placement).toEqual(pose(0, 0));
    const removed = deactivateDeployment(invalid);
    expect(removed.fleet).toHaveLength(0);
    expect(removed.draft).toBe(null);
    expect(removed.notice).toContain('移除');
  });

  it('keeps an invalid rotation tentative until selection changes, restoring valid orientation', () => {
    const first = clickDeploymentCell(initialDeployment(), 61);
    const invalid = rotateDeploymentShip(first);
    expect(invalid.orientation).toBe('vertical');
    expect(invalid.draft?.placement).toEqual(pose(6, 1, 'vertical'));
    expect(invalid.draft?.valid).toBe(false);
    expect(carrierCells(invalid)).toEqual([61, 62, 63, 64, 65]);
    const next = selectDeploymentShip(invalid, 'battleship');
    expect(next.draft).toBe(null);
    const reselect = selectDeploymentShip(next, 'carrier');
    expect(reselect.orientation).toBe('horizontal');
    expect(reselect.draft?.placement).toEqual(pose(6, 1));
  });

  it('can repair invalid geometry by moving again, without an intervening blur', () => {
    const invalid = moveDeploymentShip(placed(), 'carrier', pose(-2, 7, 'vertical'));
    const fixed = clickDeploymentCell(invalid, 14);
    expect(fixed.draft?.valid).toBe(true);
    expect(carrierCells(fixed)).toEqual([14, 24, 34, 44, 54]);
    expect(fixed.selectedShipId).toBe('carrier');
  });

  it('does not commit intermediate pointer poses, then commits a valid release once', () => {
    const first = placed();
    const moving = moveDeploymentShip(first, 'carrier', pose(3, 1), false);
    expect(moving.draft?.valid).toBe(true);
    expect(moving.draft?.cells).toEqual([31, 32, 33, 34, 35]);
    expect(carrierCells(moving)).toEqual([11, 12, 13, 14, 15]);
    const released = finishDeploymentMove(moving);
    expect(carrierCells(released)).toEqual([31, 32, 33, 34, 35]);
    expect(finishDeploymentMove(released).fleet).toEqual(released.fleet);
  });

  it('keeps an invalid handle release red and uncommitted until blur', () => {
    const invalid = finishDeploymentMove(moveDeploymentShip(placed(), 'carrier', pose(9, 8), false));
    expect(invalid.draft?.valid).toBe(false);
    expect(invalid.draft?.placement).toEqual(pose(9, 8));
    expect(carrierCells(invalid)).toEqual([11, 12, 13, 14, 15]);
    expect(deactivateDeployment(invalid).draft).toBe(null);
  });

  it('selecting a different committed ship resolves the old draft without relocating either', () => {
    const initial = initialDeployment(fleet());
    const selected = selectDeploymentShip(initial, 'carrier');
    const invalid = moveDeploymentShip(selected, 'carrier', pose(3, 0));
    expect(invalid.draft?.valid).toBe(false);
    const switched = clickDeploymentCell(invalid, 33);
    expect(switched.selectedShipId).toBe('battleship');
    expect(switched.draft?.id).toBe('battleship');
    expect(switched.fleet).toEqual(initial.fleet);
  });

  it('does not let a hidden committed position intercept correction of the active invalid draft', () => {
    const invalid = moveDeploymentShip(placed(), 'carrier', pose(8, 9));
    const corrected = clickDeploymentCell(invalid, 12);
    expect(corrected.draft?.valid).toBe(true);
    expect(carrierCells(corrected)).toEqual([12, 13, 14, 15, 16]);
  });

  it('models off-board origins without wrapped cells, and permits a single perpendicular edge', () => {
    const outside = moveDeploymentShip(initialDeployment(), 'carrier', pose(2, 11));
    expect(outside.draft?.placement).toEqual(pose(2, 11));
    expect(outside.draft?.cells).toEqual([]);
    expect(outside.fleet).toHaveLength(0);
    const endpoint = moveDeploymentShip(outside, 'carrier', pose(0, 1, 'vertical'));
    expect(endpoint.draft?.valid).toBe(true);
    expect(carrierCells(endpoint)).toEqual([1, 11, 21, 31, 41]);
    const alongEdge = rotateDeploymentShip(endpoint);
    expect(alongEdge.draft?.valid).toBe(false);
    expect(carrierCells(alongEdge)).toEqual([1, 11, 21, 31, 41]);
  });
});

describe('last completed public round markers', () => {
  const game = (shellsPerTurn: number) => createGame(fleet(), 'easy', { enemyFleet: fleet(), shellsPerTurn, matchId: 'marker-test', aiRngState: 7 });
  for (const shells of [1, 3, 5]) it(`keeps both sides stable through the next incomplete ${shells}-shell round and save reload`, () => {
    const first = game(shells), p1 = Array.from({ length: shells }, (_, i) => i), a1 = Array.from({ length: shells }, (_, i) => 90 + i);
    expect(previousRoundShots(first)).toEqual({ player: [], ai: [], round: null });
    const one = applyVolley(first, 'player', p1).state;
    expect(previousRoundShots(one)).toEqual({ player: [], ai: [], round: null });
    const two = applyVolley(one, 'ai', a1).state;
    const expected = { player: p1, ai: a1, round: 1 };
    expect(previousRoundShots(two)).toEqual(expected);
    const p2 = Array.from({ length: shells }, (_, i) => 20 + i), a2 = Array.from({ length: shells }, (_, i) => 60 + i);
    const three = applyVolley(two, 'player', p2).state;
    expect(previousRoundShots(three)).toEqual(expected);
    expect(previousRoundShots(parseGameSave(serializeGame(three))!)).toEqual(expected);
    const four = applyVolley(three, 'ai', a2).state;
    expect(previousRoundShots(four)).toEqual({ player: p2, ai: a2, round: 2 });
  });

  it('accepts only public history and excludes unused winning-volley tail coordinates', () => {
    const volleys: VolleyRecord[] = [{ attacker: 'player', coords: [11, 22, 33] }, { attacker: 'ai', coords: [44, 55, 66] }];
    const publicEvents = [['player', 11], ['player', 22], ['player', 33], ['ai', 44]] as const;
    const events: ShotEvent[] = publicEvents.map(([attacker, coord], i) => ({ id: `${i}`, turnIndex: i + 1, attacker, coord, result: 'miss' }));
    expect(previousRoundShots({ volleys, events })).toEqual({ player: [11, 22, 33], ai: [44], round: 1 });
    const snapshot = JSON.stringify({ volleys, events });
    const output = previousRoundShots({ volleys, events }); output.player.push(99);
    expect(JSON.stringify({ volleys, events })).toBe(snapshot);
  });

  it('preserves the last completed round if a player wins before the next AI volley', () => {
    const state = game(1);
    const afterRound = applyVolley(applyVolley(state, 'player', [0]).state, 'ai', [99]).state;
    const terminal = { ...afterRound, winner: 'player', volleys: [...afterRound.volleys, { attacker: 'player', coords: [11] }], events: [...afterRound.events, { id: 'win', turnIndex: 3, attacker: 'player', coord: 11, result: 'sunk', winner: 'player' }] } as GameState;
    expect(previousRoundShots(terminal)).toEqual({ player: [0], ai: [99], round: 1 });
  });
});
