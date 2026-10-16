import { RNG } from '../core/random';
import type { AIObservation, AIDecision } from '../core/types';
import { neighbors, unknownCells, validateObservation } from './observation';
/** Limited 65% chase; touching hits are never permanently merged. */
export function chooseEasy(observation: AIObservation, rngState: number): AIDecision {
  const started = performance.now(); validateObservation(observation);
  const rng = new RNG(rngState), unknown = unknownCells(observation);
  if (!unknown.length) throw new Error('没有可攻击坐标');
  const board = observation.knownEnemyBoard, chase = new Set<number>(), extension = new Set<number>();
  for (let cell = 0; cell < 100; cell++) if (board[cell] === 'hit') for (const next of neighbors(cell)) {
    if (board[next] === 'unknown') chase.add(next);
    if (board[next] === 'hit') { const other = next + (next - cell); if (neighbors(next).includes(other) && board[other] === 'unknown') extension.add(other); }
  }
  const pool = chase.size && rng.next() < 0.65 ? [...(extension.size ? extension : chase)] : unknown;
  const coord = rng.pick(pool);
  return { coord, rngState: rng.state, diagnostics: { strategy: 'easy', samples: 0, nodes: 0, elapsedMs: performance.now() - started, timedOut: false, degraded: false } };
}
