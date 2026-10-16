import { RNG } from '../core/random';
import type { AIObservation, AIDecision } from '../core/types';
import { sampleFleets, buildCandidates, type SamplingBudget } from './sampler';
import { unknownCells, validateObservation } from './observation';
function selectScore(scores: Float64Array, unknown: number[], rng: RNG): number {
  let best = -Infinity; for (const cell of unknown) best = Math.max(best, scores[cell]!);
  return rng.pick(unknown.filter(cell => scores[cell]! >= best * 0.985 - 1e-8));
}
export function chooseFallback(observation: AIObservation, rngState: number, reason = '推断预算不足'): AIDecision {
  const started = performance.now(); validateObservation(observation);
  const rng = new RNG(rngState), unknown = unknownCells(observation);
  if (!unknown.length) throw new Error('没有可攻击坐标');
  const scores = new Float64Array(100);
  for (const ship of buildCandidates(observation)) for (const c of ship.cells) if (observation.knownEnemyBoard[c] === 'unknown') scores[c]! += 1 + 8 * ship.hitCount / (ship.length - ship.hitCount);
  return { coord: selectScore(scores, unknown, rng), rngState: rng.state, diagnostics: { strategy: 'fallback', samples: 0, nodes: 0, elapsedMs: performance.now() - started, timedOut: false, degraded: true, reason } };
}
export function chooseNormal(observation: AIObservation, rngState: number, budget: SamplingBudget = {}): AIDecision {
  const started = performance.now(), rng = new RNG(rngState), result = sampleFleets(observation, rng, budget), unknown = unknownCells(observation);
  if (!unknown.length) throw new Error('没有可攻击坐标');
  if (!result.samples.length) {
    const fallback = chooseFallback(observation, rng.state, result.timedOut ? '采样超时，无完整候选' : result.nodeLimit ? '节点预算耗尽，无完整候选' : '公开约束下未找到完整舰队');
    return { ...fallback, diagnostics: { ...fallback.diagnostics, nodes: result.nodes, elapsedMs: performance.now() - started, timedOut: result.timedOut } };
  }
  const scores = new Float64Array(100);
  for (const sample of result.samples) for (const ship of sample.ships) {
    const unhit = ship.length - ship.hitCount, score = 1 + (ship.hitCount ? 2.4 / Math.sqrt(unhit) : 0) + (unhit === 1 && ship.hitCount ? 1.1 : 0);
    for (const cell of ship.cells) if (observation.knownEnemyBoard[cell] === 'unknown') scores[cell]! += score;
  }
  const coord = selectScore(scores, unknown, rng);
  return { coord, rngState: rng.state, diagnostics: { strategy: 'normal', samples: result.samples.length, nodes: result.nodes, elapsedMs: performance.now() - started, timedOut: result.timedOut,
    degraded: result.samples.length < Math.min(64, budget.maxSamples ?? 640), ...(result.timedOut ? { reason: '达到时间预算，使用已验证完整候选' } : result.nodeLimit ? { reason: '达到节点预算，使用已验证完整候选' } : {}) } };
}
