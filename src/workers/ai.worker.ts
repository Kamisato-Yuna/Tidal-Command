/// <reference lib="webworker" />
import { chooseAttackVolley } from '../ai';
import type { AIRequest, AIResolvedResponse, AIErrorResponse } from './protocol';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<AIRequest>) => {
  const { matchId, turnId, difficulty, observation, rngState, budget, shotCount = 1 } = event.data;
  try { const response: AIResolvedResponse = { matchId, turnId, ...chooseAttackVolley(difficulty, observation, rngState, shotCount, budget) }; scope.postMessage(response); }
  catch (error) { const response: AIErrorResponse = { matchId, turnId, error: error instanceof Error ? error.message : 'AI 决策异常' }; scope.postMessage(response); }
};
