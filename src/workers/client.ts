import { chooseFallback } from '../ai/normal';
import type { AIRequest, AIResponse, AIErrorResponse } from './protocol';
/** Cancellation prevents old matches or turns from committing an action. */
export function requestAI(request: AIRequest, onResult: (result: AIResponse) => void): () => void {
  const started = performance.now(); let finished = false; let worker: Worker | null = null; let timer: ReturnType<typeof setTimeout> | undefined;
  const complete = (response: AIResponse) => { if (finished || response.matchId !== request.matchId || response.turnId !== request.turnId) return; finished = true; if (timer !== undefined) clearTimeout(timer); worker?.terminate(); onResult(response); };
  const fallback = (reason: string, timedOut = false) => { const result = chooseFallback(request.observation, request.rngState, reason); result.diagnostics.timedOut = timedOut; result.diagnostics.elapsedMs = performance.now() - started; complete({ matchId: request.matchId, turnId: request.turnId, ...result }); };
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<AIResponse | AIErrorResponse>) => { const data = event.data; if (data.matchId !== request.matchId || data.turnId !== request.turnId) return; if ('error' in data) fallback(`Worker 推断失败：${data.error}`); else complete(data); };
    worker.onerror = () => fallback('Worker 不可用，使用公开约束降级');
    worker.postMessage(request); timer = setTimeout(() => fallback('Worker 超过 1 秒保护，使用公开约束降级', true), 1000);
  } catch { fallback('浏览器不支持 Worker，使用公开约束降级'); }
  return () => { finished = true; if (timer !== undefined) clearTimeout(timer); worker?.terminate(); };
}
