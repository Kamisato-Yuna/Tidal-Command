import { createGame, applyShot } from './game';
import { type GameState, type ShotEvent, type AIDiagnostics } from './types';
function validDiagnostics(value: unknown): value is AIDiagnostics {
  if (!value || typeof value !== 'object') return false;
  const v = value as AIDiagnostics;
  return ['easy', 'normal', 'fallback'].includes(v.strategy) && [v.samples, v.nodes, v.elapsedMs].every(n => Number.isFinite(n) && n >= 0) && typeof v.timedOut === 'boolean' && typeof v.degraded === 'boolean' && (v.reason === undefined || (typeof v.reason === 'string' && v.reason.length < 300));
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
/** Replays every committed action and rejects inconsistent data. */
export function validateGameSave(value: unknown): GameState {
  if (!value || typeof value !== 'object') throw new Error('存档格式已损坏，可以开始新局');
  const data = value as GameState;
  if (data.version !== 1) throw new Error('存档版本不兼容，请开始新局');
  if (typeof data.matchId !== 'string' || data.matchId.length < 1 || data.matchId.length > 160) throw new Error('存档对局编号无效');
  if (!Number.isInteger(data.aiRngState) || data.aiRngState <= 0 || data.aiRngState > 0xffffffff) throw new Error('存档随机状态无效');
  if (!data.fleets || !Array.isArray(data.fleets.player) || !Array.isArray(data.fleets.ai)) throw new Error('存档舰队无效');
  if (!Array.isArray(data.events) || data.events.length > 199) throw new Error('存档攻击记录无效');
  let restored = createGame(data.fleets.player, data.difficulty, { enemyFleet: data.fleets.ai, matchId: data.matchId, aiRngState: data.aiRngState });
  for (const raw of data.events) {
    if (!raw || typeof raw !== 'object') throw new Error('存档事件无效');
    const { state, event } = applyShot(restored, raw.attacker, raw.coord), expected: ShotEvent = { ...event };
    if (raw.aiDiagnostics !== undefined) { if (raw.attacker !== 'ai' || !validDiagnostics(raw.aiDiagnostics)) throw new Error('存档决策信息无效'); expected.aiDiagnostics = { ...raw.aiDiagnostics }; }
    const keys = Object.keys(raw).sort();
    if (!same(keys, Object.keys(expected).sort()) || keys.some(k => !same(raw[k as keyof ShotEvent], expected[k as keyof ShotEvent]))) throw new Error('存档事件与规则不一致');
    restored = { ...state, events: [...state.events.slice(0, -1), expected] };
  }
  if (!same(data.shots, restored.shots) || data.turn !== restored.turn || data.winner !== restored.winner) throw new Error('存档回合状态不一致');
  return restored;
}
export function serializeGame(state: GameState): string { return JSON.stringify(validateGameSave(state)); }
export function parseGameSave(raw: string): GameState {
  if (typeof raw !== 'string' || raw.length > 300000) throw new Error('存档内容无效');
  let data: unknown; try { data = JSON.parse(raw); } catch { throw new Error('存档已损坏，可以开始新局'); }
  return validateGameSave(data);
}
