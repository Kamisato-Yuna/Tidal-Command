import { describe, expect, it } from 'vitest';
import { applyVolley, createGame, getKnownBoard, getShotQuota } from '../src/core/game';
import { FLEET_SPECS, type GameState, type Ship, type Side } from '../src/core/types';
import { buildReplayFrames, replayVisibleShips } from '../src/core/replay';

const fleet = (): Ship[] => FLEET_SPECS.map((ship, index) => ({ ...ship, cells: Array.from({ length: ship.length }, (_, j) => (index === 4 ? 86 : 11 + index * 20) + j) }));
function completed(winner: Side = 'player', shellsPerTurn = 5): GameState {
  let game = createGame(fleet(), 'easy', { enemyFleet: fleet(), matchId: `replay-${winner}-${shellsPerTurn}`, shellsPerTurn, aiRngState: 8 });
  const hits = fleet().flatMap(ship => ship.cells), misses = Array.from({ length: 100 }, (_, i) => i).filter(c => !hits.includes(c));
  while (!game.winner) {
    const side = game.turn, order = side === winner ? [...hits, ...misses] : [...misses, ...hits];
    game = applyVolley(game, side, order.filter(c => !game.shots[side].includes(c)).slice(0, getShotQuota(game))).state;
  }
  return game;
}
describe('immutable completed-match per-shot replay', () => {
  it('starts at deployment and adds exactly one frame per executed shot', () => {
    const game = completed(), before = JSON.stringify(game), frames = buildReplayFrames(game);
    expect(frames).toHaveLength(game.events.length + 1);
    expect(frames[0]).toMatchObject({ index: 0, events: [], shots: { player: [], ai: [] }, sunk: { player: [], ai: [] }, lastEvent: null, round: 1, volleyIndex: 0, shotInVolley: 0, plannedShots: 5, winner: null });
    expect(frames[0]!.known.player.every(cell => cell === 'unknown')).toBe(true);
    expect(frames[0]!.known.ai.every(cell => cell === 'unknown')).toBe(true);
    for (let index = 1; index < frames.length; index++) {
      const frame = frames[index]!;
      expect(frame.index).toBe(index); expect(frame.events).toEqual(game.events.slice(0, index)); expect(frame.lastEvent).toEqual(game.events[index - 1]);
      expect(frame.shots.player.length + frame.shots.ai.length).toBe(index);
      expect(frame.winner).toBe(index === game.events.length ? game.winner : null);
    }
    expect(frames.at(-1)!.known.player).toEqual(getKnownBoard(game, 'player'));
    expect(frames.at(-1)!.known.ai).toEqual(getKnownBoard(game, 'ai'));
    expect(frames.at(-1)!.shots).toEqual(game.shots);
    expect(JSON.stringify(game)).toBe(before);
    expect(Object.isFrozen(game.events[0])).toBe(false);
  });
  it('labels partial volleys, rounds and the winning salvo without fabricating its unused tail', () => {
    const game = completed(), frames = buildReplayFrames(game);
    expect(frames[1]).toMatchObject({ volleyIndex: 0, shotInVolley: 1, round: 1, plannedShots: 5 });
    expect(frames[5]).toMatchObject({ volleyIndex: 0, shotInVolley: 5, round: 1 });
    expect(frames[6]).toMatchObject({ volleyIndex: 1, shotInVolley: 1, round: 1 });
    expect(frames[11]).toMatchObject({ volleyIndex: 2, shotInVolley: 1, round: 2 });
    const final = frames.at(-1)!, lastVolley = game.volleys.at(-1)!;
    expect(final).toMatchObject({ shotInVolley: 2, plannedShots: 5, winner: 'player', round: 4 });
    expect(lastVolley.coords).toHaveLength(5);
    for (const coord of lastVolley.coords.slice(2)) {
      expect(final.shots.player).not.toContain(coord); expect(final.known.player[coord]).toBe('unknown');
    }
    expect(Object.keys(final)).not.toContain('volleys'); expect(Object.keys(final)).not.toContain('fleets');
  });
  it('reveals sunk footprints only on the actual sink shot and keeps earlier frames unchanged', () => {
    const game = completed(), frames = buildReplayFrames(game), carrier = game.fleets.ai[0]!;
    expect(frames[4]!.sunk.ai).toEqual([]);
    expect(frames[4]!.known.player[carrier.cells[0]!]).toBe('hit');
    expect(frames[5]!.sunk.ai).toEqual([carrier]);
    expect(carrier.cells.every(c => frames[5]!.known.player[c] === 'sunk')).toBe(true);
    expect(frames[4]!.known.player[carrier.cells.at(-1)!]).toBe('unknown');
    expect(Object.isFrozen(frames)).toBe(true); expect(Object.isFrozen(frames[5]!.sunk.ai[0]!.cells)).toBe(true);
    expect(() => (frames[4]!.known.player as string[]).push('miss')).toThrow();
    expect(() => { frames[5]!.lastEvent!.coord = 99; }).toThrow();
  });
  it('uses only perspective-own and already-sunk enemy ships, including a losing player final frame', () => {
    const game = completed('ai'), frames = buildReplayFrames(game), beginning = frames[0]!, end = frames.at(-1)!;
    expect(replayVisibleShips(game, beginning, 'player')).toEqual({ player: game.fleets.player, ai: [] });
    expect(replayVisibleShips(game, beginning, 'ai')).toEqual({ player: [], ai: game.fleets.ai });
    expect(replayVisibleShips(game, end, 'player').ai).toEqual([]);
    expect(replayVisibleShips(game, end, 'ai').player).toEqual(game.fleets.player);
    const visible = replayVisibleShips(game, beginning, 'player'); visible.player[0]!.cells.push(99);
    expect(game.fleets.player[0]!.cells).not.toContain(99);
  });
  it('supports all shell counts and never changes stored game or starts a new turn', () => {
    for (const shells of [1, 2, 3, 4, 5]) for (const winner of ['player', 'ai'] as const) {
      const game = completed(winner, shells), before = JSON.stringify(game), frames = buildReplayFrames(game);
      expect(frames).toHaveLength(game.events.length + 1); expect(frames.at(-1)!.winner).toBe(winner);
      expect(frames.at(-1)!.round).toBe(Math.ceil(game.volleys.length / 2));
      expect(frames.at(-1)!.shots).toEqual(game.shots); expect(JSON.stringify(game)).toBe(before);
      expect(Object.keys(frames.at(-1)!)).not.toContain('aiRngState');
    }
  });
  it('rejects unfinished and inconsistent games rather than projecting misleading frames', () => {
    const active = createGame(fleet(), 'easy', { enemyFleet: fleet() });
    expect(() => buildReplayFrames(active)).toThrow('已结束');
    const invalid = completed(); invalid.events[0]!.coord = 100;
    expect(() => buildReplayFrames(invalid)).toThrow();
  });
});
