import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestAI } from '../src/workers/client';
import type { AIRequest, AIResponse } from '../src/workers/protocol';
class FakeWorker {
  static all: FakeWorker[] = []; onmessage: ((event: { data: AIResponse }) => void) | null = null; onerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn(); constructor() { FakeWorker.all.push(this); }
}
const request = (): AIRequest => ({ matchId: 'worker-test', turnId: 2, difficulty: 'normal', rngState: 8, observation: { width: 10, height: 10, knownEnemyBoard: Array(100).fill('unknown'), remainingEnemyLengths: [5, 4, 3, 3, 2], publicSunkShips: [], turnIndex: 3 } });
const response = (): AIResponse => ({ matchId: 'worker-test', turnId: 2, coord: 44, rngState: 10, diagnostics: { strategy: 'normal', samples: 640, nodes: 3800, elapsedMs: 8, timedOut: false, degraded: false } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeWorker.all = []; });
describe('worker lifecycle isolation', () => {
  it('posts only public observation and settles exactly once', () => {
    vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers(); const callback = vi.fn(), input = request(); requestAI(input, callback); const worker = FakeWorker.all[0]!;
    expect(worker.postMessage).toHaveBeenCalledWith(input); expect(Object.keys(input)).not.toContain('fleets'); worker.onmessage?.({ data: response() }); worker.onmessage?.({ data: response() }); vi.advanceTimersByTime(2000);
    expect(callback).toHaveBeenCalledTimes(1); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('ignores stale results and every response after cancellation', () => {
    vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers(); const callback = vi.fn(), cancel = requestAI(request(), callback), worker = FakeWorker.all[0]!;
    worker.onmessage?.({ data: { ...response(), matchId: 'old-game' } }); worker.onmessage?.({ data: { ...response(), turnId: 1 } }); expect(callback).not.toHaveBeenCalled(); cancel(); worker.onmessage?.({ data: response() }); vi.advanceTimersByTime(2000);
    expect(callback).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('terminates over-budget workers and reports honest legal fallback', () => {
    vi.stubGlobal('Worker', FakeWorker); vi.useFakeTimers(); const callback = vi.fn(); requestAI(request(), callback); vi.advanceTimersByTime(1001); expect(callback).toHaveBeenCalledTimes(1);
    const result = callback.mock.calls[0]![0] as AIResponse; expect(result.diagnostics.degraded).toBe(true); expect(result.diagnostics.timedOut).toBe(true); expect(result.diagnostics.strategy).toBe('fallback'); expect(result.coord).toBeGreaterThanOrEqual(0); expect(result.coord).toBeLessThan(100); expect(FakeWorker.all[0]!.terminate).toHaveBeenCalledTimes(1);
  });
});
