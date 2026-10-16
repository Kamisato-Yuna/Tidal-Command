import { chooseFallbackVolley } from '../ai/normal';
import { volleySize, validateObservation } from '../ai/observation';
import { isCoord } from '../core/placement';
import type { AIRequest, AIResponse, AIResolvedResponse, AIErrorResponse } from './protocol';
/** Cancellation and a hard worker watchdog prevent stale or partial salvo commits. */
export function requestAI(request: AIRequest, onResult: (result: AIResolvedResponse) => void): () => void {
  validateObservation(request.observation);
  const count = volleySize(request.observation, request.shotCount ?? 1);
  const started = performance.now(); let finished = false; let worker: Worker | null = null; let timer: ReturnType<typeof setTimeout> | undefined;
  const complete = (response: AIResolvedResponse) => { if (finished || response.matchId !== request.matchId || response.turnId !== request.turnId) return; finished = true; if (timer !== undefined) clearTimeout(timer); worker?.terminate(); onResult(response); };
  const fallback = (reason: string, timedOut = false) => {
    if (finished) return;
    const result = chooseFallbackVolley(request.observation, request.rngState, count, reason);
    result.diagnostics.timedOut = timedOut; result.diagnostics.elapsedMs = performance.now() - started;
    complete({ matchId: request.matchId, turnId: request.turnId, ...result });
  };
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AIResponse | AIErrorResponse>) => {
      const data = event.data;
      if (finished || !data || data.matchId !== request.matchId || data.turnId !== request.turnId) return;
      if ('error' in data) { fallback(`Worker 推断失败：${String(data.error).slice(0, 150)}`); return; }
      const coords = data.coords ?? (count === 1 ? [data.coord] : []);
      if (!Array.isArray(coords) || coords.length !== count || new Set(coords).size !== count || Array.from(coords).some(c => !isCoord(c) || request.observation.knownEnemyBoard[c] !== 'unknown') || data.coord !== coords[0] || !Number.isInteger(data.rngState) || data.rngState <= 0 || data.rngState > 0xffffffff) { fallback('Worker 返回无效齐射目标，使用公开约束降级'); return; }
      complete({ ...data, coords: [...coords] });
    };
    worker.onerror = () => fallback('Worker 不可用，使用公开约束降级');
    timer = setTimeout(() => fallback('Worker 超过 1 秒保护，使用公开约束降级', true), 1000);
    worker.postMessage(request);
  } catch { fallback('浏览器不支持 Worker，使用公开约束降级'); }
  return () => { if (finished) return; finished = true; if (timer !== undefined) clearTimeout(timer); worker?.terminate(); };
}
