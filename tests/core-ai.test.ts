import { describe, it, expect } from 'vitest';
import { applyShot, createGame, randomFleet, projectObservation, RNG, FLEET_SPECS, placementCells, type AIObservation } from '../src/core';
import { chooseEasy, chooseNormal, sampleFleets, validateFleetSample, chooseFallback } from '../src/ai';
import { isCurrentAIResponse } from '../src/workers/protocol';
const empty = (): AIObservation => ({ width: 10, height: 10, knownEnemyBoard: Array(100).fill('unknown'), remainingEnemyLengths: [5, 4, 3, 3, 2], publicSunkShips: [], turnIndex: 1 });
const budget = { maxSamples: 80, maxNodes: 12000, maxMs: 900 };
describe('complete-fleet constrained inference', () => {
  it('returns legal complete samples covering multiple independent hit groups', () => {
    const observation = empty(), board = [...observation.knownEnemyBoard]; for (const c of [10, 11, 44, 54, 88]) board[c] = 'hit'; for (const c of [3, 17, 29, 40, 91]) board[c] = 'miss';
    const known = { ...observation, knownEnemyBoard: board }, result = sampleFleets(known, new RNG(225), budget);
    expect(result.samples.length).toBe(80); expect(result.samples.every(s => validateFleetSample(known, s))).toBe(true);
    expect(result.samples.some(s => s.ships.some(ship => ship.cells.includes(44)) && s.ships.some(ship => ship.cells.includes(54) && !ship.cells.includes(44)))).toBe(true);
  });
  it('explains a line longer than any single ship using touching ships', () => {
    const observation = empty(), board = [...observation.knownEnemyBoard]; for (const c of [21, 22, 23, 24, 25, 26]) board[c] = 'hit';
    const known = { ...observation, knownEnemyBoard: board }, result = sampleFleets(known, new RNG(388), budget);
    expect(result.samples.length).toBeGreaterThan(0); expect(result.samples.every(s => validateFleetSample(known, s))).toBe(true);
  });
  it('keeps parallel adjacent hit tracks separate rather than creating a bent ship', () => {
    const observation = empty(), board = [...observation.knownEnemyBoard]; for (const c of [21, 22, 31, 32]) board[c] = 'hit'; for (const c of [11, 12, 41, 42]) board[c] = 'miss';
    const known = { ...observation, knownEnemyBoard: board }, result = sampleFleets(known, new RNG(702), budget);
    expect(result.samples.length).toBeGreaterThan(0); expect(result.samples.every(s => validateFleetSample(known, s))).toBe(true);
    expect(result.samples.every(s => s.ships.filter(ship => ship.hitCount).length >= 2)).toBe(true);
  });
  it('keeps hits next to sunk ships and respects remaining length multiset', () => {
    const board = Array(100).fill('unknown'); for (const c of [44, 45, 46]) board[c] = 'sunk'; board[54] = 'hit';
    const observation: AIObservation = { ...empty(), knownEnemyBoard: board, remainingEnemyLengths: [5, 4, 3, 2], publicSunkShips: [[44, 45, 46]] };
    const result = sampleFleets(observation, new RNG(30), budget); expect(result.samples.length).toBe(80); expect(result.samples.every(s => validateFleetSample(observation, s))).toBe(true);
  });
  it('falls back honestly when search has insufficient budget', () => {
    const result = chooseNormal(empty(), 400, { maxSamples: 200, maxNodes: 1, maxMs: 900 }); expect(result.diagnostics.degraded).toBe(true); expect(result.diagnostics.strategy).toBe('fallback'); expect(empty().knownEnemyBoard[result.coord]).toBe('unknown');
  });
});
describe('fairness and reproducibility', () => {
  it('gives identical decisions on different compatible hidden fleets', () => {
    const first = createGame(randomFleet(1), 'normal', { enemyFleet: randomFleet(2), aiRngState: 40 }), second = createGame(randomFleet(3), 'normal', { enemyFleet: randomFleet(4), aiRngState: 40 });
    const a = projectObservation(first, 'ai'), b = projectObservation(second, 'ai'); expect(a).toEqual(b); expect('fleets' in a).toBe(false); expect('seed' in a).toBe(false);
    const x = chooseNormal(a, 400, budget), y = chooseNormal(b, 400, budget); expect(x.coord).toBe(y.coord); expect(x.rngState).toBe(y.rngState);
  });
  it('is noninterfering after matching hits and misses on different fleets', () => {
    const firstFleet = FLEET_SPECS.map((s, i) => ({ ...s, cells: placementCells(i * 20, s.length, 'horizontal') }));
    const secondFleet = FLEET_SPECS.map((s, i) => ({ ...s, cells: placementCells(i ? i * 20 + 5 : 0, s.length, 'horizontal') }));
    let first = createGame(firstFleet, 'normal', { enemyFleet: randomFleet(999), aiRngState: 800 }), second = createGame(secondFleet, 'normal', { enemyFleet: randomFleet(999), aiRngState: 800 });
    for (const [side, c] of [['player', 98], ['ai', 0], ['player', 99], ['ai', 19]] as const) { first = applyShot(first, side, c).state; second = applyShot(second, side, c).state; }
    const a = projectObservation(first, 'ai'), b = projectObservation(second, 'ai'); expect(a).toEqual(b); expect(a.knownEnemyBoard[0]).toBe('hit'); expect(a.knownEnemyBoard[19]).toBe('miss');
    const x = chooseNormal(a, 800, budget), y = chooseNormal(b, 800, budget); expect(x.coord).toBe(y.coord); expect(x.rngState).toBe(y.rngState);
  });
  it('keeps decisions unaffected by visual RNG and fixed deployment', () => {
    const state = createGame(randomFleet(1), 'normal', { placementSeed: 2, aiRngState: 44 }), snapshot = JSON.stringify(state.fleets), a = chooseNormal(projectObservation(state, 'ai'), 100, budget);
    const visual = new RNG(900); for (let i = 0; i < 10000; i++) visual.next(); const b = chooseNormal(projectObservation(state, 'ai'), 100, budget);
    expect(a.coord).toBe(b.coord); expect(a.rngState).toBe(b.rngState); applyShot(state, 'player', 0); expect(JSON.stringify(state.fleets)).toBe(snapshot);
  });
  it('never chooses an already-shot cell in any policy', () => {
    const board = Array(100).fill('miss'); board[90] = 'unknown'; const observation: AIObservation = { ...empty(), knownEnemyBoard: board };
    for (const choose of [chooseEasy, chooseNormal, chooseFallback]) expect(choose(observation, 2).coord).toBe(90);
  });
  it('rejects stale match and turn responses', () => {
    expect(isCurrentAIResponse({ matchId: 'new', turnId: 2 }, 'new', 2)).toBe(true); expect(isCurrentAIResponse({ matchId: 'old', turnId: 2 }, 'new', 2)).toBe(false); expect(isCurrentAIResponse({ matchId: 'new', turnId: 1 }, 'new', 2)).toBe(false);
  });
});
describe('full simulated games', () => {
  it('finishes without repeats, corrupt turns or changing deployment', () => {
    for (let seed = 71; seed < 79; seed++) {
      let state = createGame(randomFleet(seed, 'adjacent'), 'normal', { enemyFleet: randomFleet(seed + 100, 'edge'), aiRngState: seed + 600 });
      const layout = JSON.stringify(state.fleets); let playerRng = seed + 900, aiRng = seed + 600;
      while (!state.winner) {
        const side = state.turn, observation = projectObservation(state, side), decision = side === 'ai' ? chooseNormal(observation, aiRng, budget) : chooseEasy(observation, playerRng);
        if (side === 'ai') aiRng = decision.rngState; else playerRng = decision.rngState;
        expect(state.shots[side]).not.toContain(decision.coord); state = applyShot(state, side, decision.coord).state; expect(state.events.length).toBeLessThanOrEqual(199);
      }
      expect(state.shots.player.length).toBeLessThanOrEqual(100); expect(state.shots.ai.length).toBeLessThanOrEqual(100); expect(JSON.stringify(state.fleets)).toBe(layout);
    }
  }, 20000);
});
