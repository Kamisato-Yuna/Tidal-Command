import { RNG } from '../core/random';
import type { AIObservation, AIDecision, AIVolleyDecision } from '../core/types';
import { neighbors, unknownCells, validateObservation, volleySize } from './observation';
/** Limited 65% chase; every target uses the SAME original public board. */
export function chooseEasyVolley(observation: AIObservation, rngState: number, shotCount = 1): AIVolleyDecision {
  const started = performance.now(); validateObservation(observation);
  const rng = new RNG(rngState), unknown = unknownCells(observation), count = volleySize(observation, shotCount);
  const board = observation.knownEnemyBoard, chase = new Set<number>(), extension = new Set<number>();
  for (let cell = 0; cell < 100; cell++) if (board[cell] === 'hit') for (const next of neighbors(cell)) {
    if (board[next] === 'unknown') chase.add(next);
    if (board[next] === 'hit') { const other = next + (next - cell); if (neighbors(next).includes(other) && board[other] === 'unknown') extension.add(other); }
  }
  const coords: number[] = [];
  while (coords.length < count) {
    const available = unknown.filter(c => !coords.includes(c)), chasing = [...chase].filter(c => !coords.includes(c)), extending = [...extension].filter(c => !coords.includes(c));
    const pool = chasing.length && rng.next() < 0.65 ? extending.length ? extending : chasing : available;
    coords.push(rng.pick(pool));
  }
  return { coord: coords[0]!, coords, rngState: rng.state, diagnostics: { strategy: 'easy', samples: 0, nodes: 0, elapsedMs: performance.now() - started, timedOut: false, degraded: false } };
}
export function chooseEasy(observation: AIObservation, rngState: number): AIDecision { return chooseEasyVolley(observation, rngState, 1); }
