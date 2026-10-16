import type { AIDecision, AIVolleyDecision, AIObservation, Difficulty } from '../core/types';
import type { SamplingBudget } from '../ai/sampler';
export interface AIRequest { matchId: string; turnId: number; difficulty: Difficulty; observation: AIObservation; rngState: number; shotCount?: number; budget?: SamplingBudget }
/** Optional only on the legacy wire format; requestAI always normalizes it. */
export interface AIResponse extends AIDecision { matchId: string; turnId: number; coords?: number[] }
export interface AIResolvedResponse extends AIVolleyDecision { matchId: string; turnId: number }
export interface AIErrorResponse { matchId: string; turnId: number; error: string }
export function isCurrentAIResponse(response: { matchId: string; turnId: number }, matchId: string, turnId: number): boolean { return response.matchId === matchId && response.turnId === turnId; }
