import type { AIDecision, AIObservation, Difficulty } from '../core/types';
import type { SamplingBudget } from '../ai/sampler';
export interface AIRequest { matchId: string; turnId: number; difficulty: Difficulty; observation: AIObservation; rngState: number; budget?: SamplingBudget }
export interface AIResponse extends AIDecision { matchId: string; turnId: number }
export interface AIErrorResponse { matchId: string; turnId: number; error: string }
export function isCurrentAIResponse(response: { matchId: string; turnId: number }, matchId: string, turnId: number): boolean { return response.matchId === matchId && response.turnId === turnId; }
