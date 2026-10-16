import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyShot, applyVolley, createGame, getRoundNumber, getShotQuota, parseGameSave, serializeGame, projectObservation, randomFleet, validateFleet, canPlaceShip, FLEET_SPECS, RNG, type AIObservation, type GameState, type Ship } from '../src/core';
import { chooseAttackVolley, chooseEasy, chooseEasyVolley, chooseNormal, chooseNormalVolley, chooseFallbackVolley, sampleFleets, validateFleetSample, buildCandidates } from '../src/ai';
import { requestAI } from '../src/workers/client';
import type { AIRequest, AIResponse, AIResolvedResponse } from '../src/workers/protocol';
const fleet = (): Ship[] => FLEET_SPECS.map((s, i) => ({ ...s, cells: Array.from({ length: s.length }, (_, j) => (i === 4 ? 86 : 11 + i * 20) + j) }));
const game = (shellsPerTurn = 3): GameState => createGame(fleet(), 'normal', { enemyFleet: fleet(), shellsPerTurn, matchId: 'salvos', aiRngState: 71 });
const unknown = (state: GameState, side = state.turn): number[] => Array.from({ length: 100 }, (_, i) => i).filter(c => !state.shots[side].includes(c));
const empty = (placementRule: 'classic' | 'adjacent-allowed' = 'classic'): AIObservation => ({ width: 10, height: 10, placementRule, knownEnemyBoard: Array(100).fill('unknown'), remainingEnemyLengths: [5, 4, 3, 3, 2], publicSunkShips: [], turnIndex: 1 });
const budget = { maxSamples: 48, maxNodes: 24000, maxMs: 900 };
function aiMisses(state: GameState): GameState {
  const cells = state.fleets.player.flatMap(s => s.cells);
  return applyVolley(state, 'ai', unknown(state).filter(c => !cells.includes(c)).slice(0, getShotQuota(state))).state;
}
function nearlyWon(): GameState {
  let state = game(5); const hits = fleet().flatMap(s => s.cells), misses = unknown(state).filter(c => !hits.includes(c)), plan = [...hits.slice(0, -1), ...misses.slice(0, 4)];
  for (let i = 0; i < plan.length; i += 5) state = aiMisses(applyVolley(state, 'player', plan.slice(i, i + 5)).state);
  return state;
}
describe('classic placement: diagonal separation and unit-cell edge budget', () => {
  it('uses classic defaults and accepts only one total boundary contact', () => {
    expect(game().rules).toEqual({ shellsPerTurn: 3, placement: 'classic' });
    expect(validateFleet(fleet()).valid).toBe(true);
    for (const cells of [[1, 11, 21], [10, 11, 12], [78, 88, 98], [17, 18, 19]]) expect(canPlaceShip(cells, [])).toBe(true);
    for (const cells of [[0, 1], [1, 2, 3], [19, 29], [91, 92], [89, 99]]) expect(canPlaceShip(cells, [])).toBe(false);
    const ship = [{ ...FLEET_SPECS[4]!, cells: [11, 12] }];
    expect(canPlaceShip([23, 24], ship)).toBe(false); expect(canPlaceShip([14, 15], ship)).toBe(true);
    expect(canPlaceShip([0, 1], [], undefined, 'adjacent-allowed')).toBe(true);
    expect(canPlaceShip([23, 24], ship, undefined, 'adjacent-allowed')).toBe(true);
  });
  it('generates legal classic fleets in every deployment style', () => {
    for (let seed = 20; seed < 30; seed++) for (const style of ['random', 'easy', 'normal', 'edge', 'adjacent', 'dispersed'] as const) expect(validateFleet(randomFleet(seed, style)).valid).toBe(true);
  }, 20000);
  it('makes every classic complete hypothesis legal and respects public exclusions', () => {
    const observation: AIObservation = { ...empty(), knownEnemyBoard: empty().knownEnemyBoard.map((c, i) => [11, 12].includes(i) ? 'sunk' : i === 45 ? 'hit' : c), remainingEnemyLengths: [5, 4, 3, 3], publicSunkShips: [[11, 12]] };
    const samples = sampleFleets(observation, new RNG(77), budget);
    expect(samples.samples.length).toBe(48);
    for (const sample of samples.samples) {
      expect(validateFleetSample(observation, sample)).toBe(true);
      for (let i = 0; i < sample.ships.length; i++) {
        const others = sample.ships.filter((_, j) => j !== i).map((s, j) => ({ id: `${j}`, name: '', length: s.length, cells: s.cells }));
        expect(canPlaceShip(sample.ships[i]!.cells, [...others, { id: 'sunk', name: '', length: 2, cells: [11, 12] }])).toBe(true);
      }
    }
    const candidates = buildCandidates(observation);
    expect(candidates.every(s => !s.cells.includes(0) && !s.cells.includes(23) && (!s.cells.includes(34) || s.cells.includes(45)))).toBe(true);
    const fallback = chooseFallbackVolley(observation, 55, 5);
    expect(fallback.coords.every(c => candidates.some(s => s.cells.includes(c)))).toBe(true);
  });
});
describe('atomic symmetric salvo turns', () => {
  it('locks 1–5 shells at creation and preserves one-shell API', () => {
    for (let n = 1; n <= 5; n++) { const state = game(n); expect(getShotQuota(state)).toBe(n); expect(getShotQuota(state, 'ai')).toBe(n); }
    for (const n of [0, 6, 1.5, NaN]) expect(() => game(n)).toThrow();
    expect(createGame(fleet(), 'easy', { enemyFleet: fleet() }).rules.shellsPerTurn).toBe(1);
    expect(applyShot(game(1), 'player', 11).event.result).toBe('hit');
    expect(() => applyShot(game(3), 'player', 11)).toThrow('齐射');
    expect(Object.isFrozen(game().rules)).toBe(true);
  });
  it('validates the whole plan up front without mutating any input', () => {
    const initial = game(), snapshot = JSON.stringify(initial);
    for (const coords of [[], [11], [11, 12, 13, 14], [11, 11, 12], [11, 12, 100], [11, 12, NaN], Array(3)]) {
      expect(() => applyVolley(initial, 'player', coords)).toThrow(); expect(JSON.stringify(initial)).toBe(snapshot);
    }
    expect(() => applyVolley(initial, 'ai', [11, 12, 13])).toThrow();
    const next = aiMisses(applyVolley(initial, 'player', [11, 12, 13]).state), before = JSON.stringify(next);
    expect(() => applyVolley(next, 'player', [14, 15, 11])).toThrow('已经攻击'); expect(JSON.stringify(next)).toBe(before);
  });
  it('resolves ordered outcomes then swaps once, with the same quota on both sides', () => {
    const initial = game(3), first = applyVolley(initial, 'player', [11, 0, 12]);
    expect(first.events.map(e => [e.coord, e.result])).toEqual([[11, 'hit'], [0, 'miss'], [12, 'hit']]);
    expect(first.state.turn).toBe('ai'); expect(getShotQuota(first.state)).toBe(3); expect(first.state.volleys).toEqual([{ attacker: 'player', coords: [11, 0, 12] }]);
    expect(getRoundNumber(initial)).toBe(1); expect(getRoundNumber(first.state)).toBe(1);
    const second = applyVolley(first.state, 'ai', [31, 32, 0]);
    expect(second.state.turn).toBe('player'); expect(second.state.events).toHaveLength(6); expect(getRoundNumber(second.state)).toBe(2);
    expect(second.state.fleets).toEqual(initial.fleets); expect(initial.events).toEqual([]);
  });
  it('stops on a winning shot but validates and preserves the complete plan', () => {
    const state = nearlyWon(), last = fleet().flatMap(s => s.cells).at(-1)!, tail = unknown(state).filter(c => c !== last).slice(0, 4);
    expect(() => applyVolley(state, 'player', [last, ...tail.slice(0, 3), 100])).toThrow();
    const result = applyVolley(state, 'player', [last, ...tail]);
    expect(result.events).toHaveLength(1); expect(result.events[0]!.winner).toBe('player'); expect(result.state.winner).toBe('player');
    expect(result.state.volleys.at(-1)!.coords).toEqual([last, ...tail]); expect(result.state.shots.player.some(c => tail.includes(c))).toBe(false);
    expect(getShotQuota(result.state)).toBe(0); expect(getRoundNumber(result.state)).toBe(5);
    expect(() => applyVolley(result.state, 'ai', tail)).toThrow('本局已结束');
    expect(parseGameSave(serializeGame(result.state))).toEqual(result.state);
  });
  it('caps the exact quota to remaining unknown cells for both players', () => {
    let state = game(3); const last = fleet().flatMap(s => s.cells).at(-1)!, plan = unknown(state).filter(c => c !== last);
    for (let i = 0; i < 99; i += 3) {
      state = applyVolley(state, 'player', plan.slice(i, i + 3)).state;
      state = applyVolley(state, 'ai', plan.slice(i, i + 3)).state;
    }
    expect(getShotQuota(state, 'player')).toBe(1); expect(getShotQuota(state, 'ai')).toBe(1); expect(getRoundNumber(state)).toBe(34);
    expect(() => applyVolley(state, 'player', [last, last])).toThrow();
    expect(applyVolley(state, 'player', [last]).state.winner).toBe('player');
  });
});
describe('versioned salvo persistence', () => {
  it('replays whole plans and retains actual attacks, diagnostics and fixed rules', () => {
    let state = applyVolley(game(5), 'player', [11, 12, 13, 14, 15]).state;
    const next = applyVolley(state, 'ai', [31, 32, 33, 34, 0]);
    for (const event of next.events) event.aiDiagnostics = { strategy: 'normal', samples: 640, nodes: 4000, elapsedMs: 18, timedOut: false, degraded: false };
    state = { ...next.state, aiRngState: 123 };
    expect(parseGameSave(serializeGame(state))).toEqual(state);
    for (const mutate of [
      (x: any) => { x.rules.shellsPerTurn = 4; }, (x: any) => { x.volleys[1].coords[4] = 31; },
      (x: any) => { x.volleys[0].coords.reverse(); }, (x: any) => { x.events.pop(); },
      (x: any) => { x.volleys.pop(); }, (x: any) => { x.events[1].result = 'miss'; },
    ]) { const copy = JSON.parse(serializeGame(state)); mutate(copy); expect(() => parseGameSave(JSON.stringify(copy))).toThrow(); }
  });
  it('explicitly validates and migrates v1 adjacent one-shell saves', () => {
    const oldFleet = FLEET_SPECS.map((s, i) => ({ ...s, cells: Array.from({ length: s.length }, (_, j) => i * 10 + j) }));
    let state = createGame(oldFleet, 'easy', { enemyFleet: oldFleet, placementRule: 'adjacent-allowed', matchId: 'v1', aiRngState: 9 });
    state = applyShot(state, 'player', 0).state; state = applyShot(state, 'ai', 99).state;
    const { rules: _rules, volleys: _volleys, ...old } = state, legacy = { ...old, version: 1 };
    const migrated = parseGameSave(JSON.stringify(legacy));
    expect(migrated.version).toBe(2); expect(migrated.rules).toEqual({ shellsPerTurn: 1, placement: 'adjacent-allowed' });
    expect(migrated.events).toEqual(state.events); expect(migrated.volleys).toHaveLength(2);
    expect(parseGameSave(serializeGame(migrated))).toEqual(migrated);
    legacy.events[0]!.result = 'miss'; expect(() => parseGameSave(JSON.stringify(legacy))).toThrow();
  });
});
describe('batch AI public-information boundary', () => {
  it('plans unique targets from one immutable pre-volley observation', () => {
    for (const choose of [chooseEasyVolley, chooseNormalVolley, chooseFallbackVolley]) {
      const observation = empty(); Object.freeze(observation.knownEnemyBoard); Object.freeze(observation.remainingEnemyLengths); Object.freeze(observation.publicSunkShips); Object.freeze(observation);
      const snapshot = JSON.stringify(observation), result = choose(observation, 77, 5);
      expect(result.coords).toHaveLength(5); expect(new Set(result.coords).size).toBe(5); expect(result.coord).toBe(result.coords[0]);
      expect(result.coords.every(c => observation.knownEnemyBoard[c] === 'unknown')).toBe(true); expect(JSON.stringify(observation)).toBe(snapshot);
    }
  });
  it('keeps legacy single-shell first decisions and samples once for the entire salvo', () => {
    const observation = empty('adjacent-allowed');
    expect(chooseEasyVolley(observation, 400, 5).coord).toBe(chooseEasy(observation, 400).coord);
    const solo = chooseNormal(observation, 400, budget), volley = chooseNormalVolley(observation, 400, 5, budget);
    expect(volley.coord).toBe(solo.coord); expect(volley.diagnostics.samples).toBe(solo.diagnostics.samples); expect(volley.diagnostics.nodes).toBe(solo.diagnostics.nodes);
  });
  it('cannot distinguish compatible hidden layouts for full multi-shot plans', () => {
    const first = createGame(randomFleet(1), 'normal', { enemyFleet: randomFleet(2), shellsPerTurn: 5 }), second = createGame(randomFleet(3), 'normal', { enemyFleet: randomFleet(4), shellsPerTurn: 5 });
    const a = projectObservation(first, 'ai'), b = projectObservation(second, 'ai'); expect(a).toEqual(b); expect(Object.keys(a)).not.toContain('fleets');
    const x = chooseNormalVolley(a, 88, 5, budget), y = chooseNormalVolley(b, 88, 5, budget);
    expect(x.coords).toEqual(y.coords); expect(x.rngState).toBe(y.rngState);
  });
  it('caps plans to unknown cells and rejects invalid counts', () => {
    const observation = { ...empty(), knownEnemyBoard: empty().knownEnemyBoard.map((_, i) => [45, 46].includes(i) ? 'unknown' as const : 'miss' as const) };
    for (const difficulty of ['easy', 'normal'] as const) expect(chooseAttackVolley(difficulty, observation, 7, 5, budget).coords.sort()).toEqual([45, 46]);
    for (const n of [0, 6, NaN, 2.5]) expect(() => chooseEasyVolley(empty(), 7, n)).toThrow();
  });
  it('finishes symmetric classic multi-shell games without repeats or deployment changes', () => {
    for (const count of [2, 3, 5]) {
      let state = createGame(randomFleet(40 + count), 'normal', { enemyFleet: randomFleet(80 + count), shellsPerTurn: count }), rng = 47;
      const layout = JSON.stringify(state.fleets);
      while (!state.winner) {
        const side = state.turn, decision = chooseAttackVolley(side === 'ai' ? 'normal' : 'easy', projectObservation(state, side), rng, getShotQuota(state), budget);
        rng = decision.rngState; state = applyVolley(state, side, decision.coords).state;
        expect(state.events.length).toBeLessThanOrEqual(199);
      }
      expect(JSON.stringify(state.fleets)).toBe(layout); expect(parseGameSave(serializeGame(state))).toEqual(state);
    }
  }, 20000);
});
class FakeWorker {
  static all: FakeWorker[] = []; onmessage: ((event: { data: AIResponse }) => void) | null = null; onerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn(); constructor() { FakeWorker.all.push(this); }
}
const request = (): AIRequest => ({ matchId: 'batch-worker', turnId: 3, difficulty: 'normal', shotCount: 5, rngState: 9, observation: empty() });
const response = (): AIResolvedResponse => ({ matchId: 'batch-worker', turnId: 3, coord: 44, coords: [44, 45, 46, 47, 48], rngState: 71, diagnostics: { strategy: 'normal', samples: 640, nodes: 3900, elapsedMs: 10, timedOut: false, degraded: false } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeWorker.all = []; });
describe('batch worker lifecycle', () => {
  it('forwards the quota and returns one full normalized plan', () => {
    vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers(); const callback = vi.fn(), input = request(); requestAI(input, callback);
    const worker = FakeWorker.all[0]!; expect(worker.postMessage).toHaveBeenCalledWith(input); worker.onmessage?.({ data: response() }); worker.onmessage?.({ data: response() }); vi.advanceTimersByTime(2000);
    expect(callback).toHaveBeenCalledExactlyOnceWith(response()); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('falls back for malformed batches and the one-second watchdog', () => {
    vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers();
    for (const coords of [[44, 44, 46, 47, 48], [44], [44, 45, 46, 47, 100]]) {
      const callback = vi.fn(); requestAI(request(), callback); FakeWorker.all.at(-1)!.onmessage?.({ data: { ...response(), coords } });
      const result = callback.mock.calls[0]![0] as AIResolvedResponse; expect(result.coords).toHaveLength(5); expect(new Set(result.coords).size).toBe(5); expect(result.diagnostics.strategy).toBe('fallback');
    }
    const callback = vi.fn(); requestAI(request(), callback); vi.advanceTimersByTime(1001);
    expect(callback).toHaveBeenCalledTimes(1); expect(callback.mock.calls[0]![0].coords).toHaveLength(5); expect(callback.mock.calls[0]![0].diagnostics.timedOut).toBe(true);
  });
  it('ignores stale and cancelled multi-shot results', () => {
    vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers(); const callback = vi.fn(), cancel = requestAI(request(), callback), worker = FakeWorker.all[0]!;
    worker.onmessage?.({ data: { ...response(), matchId: 'old' } }); worker.onmessage?.({ data: { ...response(), turnId: 2 } }); expect(callback).not.toHaveBeenCalled();
    cancel(); worker.onmessage?.({ data: response() }); worker.onerror?.(); vi.advanceTimersByTime(2000); expect(callback).not.toHaveBeenCalled();
  });
});
