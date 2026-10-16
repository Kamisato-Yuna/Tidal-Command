/// <reference lib="webworker" />
import { chooseAttack } from '../ai';
import type { AIRequest, AIResponse, AIErrorResponse } from './protocol';
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<AIRequest>) => {
  const { matchId, turnId, difficulty, observation, rngState, budget } = event.data;
  try { const response: AIResponse = { matchId, turnId, ...chooseAttack(difficulty, observation, rngState, budget) }; scope.postMessage(response); }
  catch (error) { const response: AIErrorResponse = { matchId, turnId, error: error instanceof Error ? error.message : 'AI 决策异常' }; scope.postMessage(response); }
};
