/** Fixed v1 benchmark baselines, not selectable game difficulties. */
import { RNG } from '../core/random';
import type { AIObservation, AIDecision } from '../core/types';
import { neighbors, unknownCells } from './observation';
export function chooseBaseline(kind: 'random' | 'huntTarget', observation: AIObservation, rngState: number): AIDecision {
  const started = performance.now(), rng = new RNG(rngState), board = observation.knownEnemyBoard;
  let pool = unknownCells(observation); if (!pool.length) throw new Error('No unknown cells');
  if (kind === 'huntTarget') {
    const chase = new Set<number>(), extension = new Set<number>();
    for (let c = 0; c < 100; c++) if (board[c] === 'hit') for (const n of neighbors(c)) {
      if (board[n] === 'unknown') chase.add(n);
      if (board[n] === 'hit') { const beyond = n + n - c; if (neighbors(n).includes(beyond) && board[beyond] === 'unknown') extension.add(beyond); }
    }
    if (chase.size) pool = [...(extension.size ? extension : chase)];
    else { const parity = pool.filter(c => (Math.floor(c / 10) + c % 10) % 2 === 0); if (parity.length) pool = parity; }
  }
  return { coord: rng.pick(pool), rngState: rng.state, diagnostics: { strategy: 'easy', samples: 0, nodes: 0, elapsedMs: performance.now() - started, timedOut: false, degraded: false } };
}
