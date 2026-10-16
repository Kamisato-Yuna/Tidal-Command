import type { AIDecision, AIObservation, Difficulty } from '../core/types';
import { chooseEasy } from './easy';
import { chooseNormal } from './normal';
import type { SamplingBudget } from './sampler';
export { chooseEasy } from './easy';
export { chooseNormal, chooseFallback } from './normal';
export * from './sampler';
export * from './observation';
export function chooseAttack(difficulty: Difficulty, observation: AIObservation, rngState: number, budget?: SamplingBudget): AIDecision { return difficulty === 'normal' ? chooseNormal(observation, rngState, budget) : chooseEasy(observation, rngState); }
