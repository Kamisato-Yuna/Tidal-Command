import type { AIDecision, AIVolleyDecision, AIObservation, Difficulty } from '../core/types';
import { chooseEasy, chooseEasyVolley } from './easy';
import { chooseNormal, chooseNormalVolley } from './normal';
import type { SamplingBudget } from './sampler';
export { chooseEasy, chooseEasyVolley } from './easy';
export { chooseNormal, chooseNormalVolley, chooseFallback, chooseFallbackVolley } from './normal';
export * from './sampler';
export * from './observation';
export function chooseAttack(difficulty: Difficulty, observation: AIObservation, rngState: number, budget?: SamplingBudget): AIDecision { return difficulty === 'normal' ? chooseNormal(observation, rngState, budget) : chooseEasy(observation, rngState); }
export function chooseAttackVolley(difficulty: Difficulty, observation: AIObservation, rngState: number, shotCount = 1, budget?: SamplingBudget): AIVolleyDecision { return difficulty === 'normal' ? chooseNormalVolley(observation, rngState, shotCount, budget) : chooseEasyVolley(observation, rngState, shotCount); }
