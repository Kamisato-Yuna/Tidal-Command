import { describe, it, expect } from 'vitest';
import { createGame, randomFleet, applyShot, parseGameSave, serializeGame } from '../src/core';
const make = () => applyShot(createGame(randomFleet(100), 'normal', { placementSeed: 300, aiRngState: 800, matchId: 'save' }), 'player', 10).state;
describe('versioned replay-validated saves', () => {
  it('restores already-committed next turn without reapplying damage', () => {
    const before = make(), restored = parseGameSave(serializeGame(before)); expect(restored).toEqual(before); expect(restored.turn).toBe('ai'); expect(restored.events).toHaveLength(1);
    const next = applyShot(restored, 'ai', 2).state; expect(next.events).toHaveLength(2); expect(next.shots.player).toEqual([10]);
  });
  it('rejects broken JSON, incompatible versions, duplicate actions and mismatched feedback', () => {
    expect(() => parseGameSave('broken')).toThrow();
    for (const mutate of [
      (v: any) => { v.version = 999; }, (v: any) => { v.events[0].result = 'sunk'; }, (v: any) => { v.events.push(v.events[0]); },
      (v: any) => { v.events[0].shipId = 'leaked'; }, (v: any) => { v.turn = 'player'; }, (v: any) => { v.winner = 'player'; },
      (v: any) => { v.shots.player = []; }, (v: any) => { v.fleets.ai[0].cells = [0, 1, 2, 3, 11]; }, (v: any) => { v.aiRngState = -1; },
    ]) { const value = make(); mutate(value); expect(() => parseGameSave(JSON.stringify(value))).toThrow(); }
  });
  it('accepts measured public AI diagnostics and rejects them on player events', () => {
    let state = make(); state = applyShot(state, 'ai', 30).state; state.events[1]!.aiDiagnostics = { strategy: 'normal', samples: 640, nodes: 4000, elapsedMs: 18, timedOut: false, degraded: false };
    expect(parseGameSave(serializeGame(state))).toEqual(state); state.events[0]!.aiDiagnostics = state.events[1]!.aiDiagnostics; expect(() => serializeGame(state)).toThrow();
  });
});
