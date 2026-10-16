import { createGame, applyVolley } from './game';
import { type GameState, type ShotEvent, type AIDiagnostics, type VolleyRecord } from './types';
function validDiagnostics(value: unknown): value is AIDiagnostics {
  if (!value || typeof value !== 'object') return false;
  const v = value as AIDiagnostics;
  return ['easy', 'normal', 'fallback'].includes(v.strategy) && [v.samples, v.nodes, v.elapsedMs].every(n => Number.isFinite(n) && n >= 0) && typeof v.timedOut === 'boolean' && typeof v.degraded === 'boolean' && (v.reason === undefined || (typeof v.reason === 'string' && v.reason.length < 300));
}
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }
function validatedEvent(raw: ShotEvent, event: ShotEvent): ShotEvent {
  if (!raw || typeof raw !== 'object') throw new Error('存档事件无效');
  const expected = { ...event };
  if (raw.aiDiagnostics !== undefined) {
    if (raw.attacker !== 'ai' || !validDiagnostics(raw.aiDiagnostics)) throw new Error('存档决策信息无效');
    expected.aiDiagnostics = { ...raw.aiDiagnostics };
  }
  const keys = Object.keys(raw).sort();
  if (!same(keys, Object.keys(expected).sort()) || keys.some(k => !same(raw[k as keyof ShotEvent], expected[k as keyof ShotEvent]))) throw new Error('存档事件与规则不一致');
  return expected;
}
/** Replays complete precommitted volleys. Version 1 is explicitly one-shell/adjacent-allowed. */
export function validateGameSave(value: unknown): GameState {
  if (!value || typeof value !== 'object') throw new Error('存档格式已损坏，可以开始新局');
  const data = value as Omit<GameState, 'version'> & { version: unknown };
  if (data.version !== 1 && data.version !== 2) throw new Error('存档版本不兼容，请开始新局');
  if (typeof data.matchId !== 'string' || data.matchId.length < 1 || data.matchId.length > 160) throw new Error('存档对局编号无效');
  if (!Number.isInteger(data.aiRngState) || data.aiRngState <= 0 || data.aiRngState > 0xffffffff) throw new Error('存档随机状态无效');
  if (!data.fleets || !Array.isArray(data.fleets.player) || !Array.isArray(data.fleets.ai)) throw new Error('存档舰队无效');
  if (!Array.isArray(data.events) || data.events.length > 199) throw new Error('存档攻击记录无效');
  const legacy = data.version === 1;
  if (legacy) {
    // Do not reinterpret an alleged legacy save carrying new rules or a salvo log.
    if ('rules' in data || 'volleys' in data) throw new Error('旧版存档规则无效');
  } else {
    if (!data.rules || !['adjacent-allowed', 'classic'].includes(data.rules.placement) || !Number.isInteger(data.rules.shellsPerTurn) || !same(Object.keys(data.rules).sort(), ['placement', 'shellsPerTurn'])) throw new Error('存档对局规则无效');
    if (!Array.isArray(data.volleys) || data.volleys.length > 199) throw new Error('存档齐射记录无效');
  }
  const shellsPerTurn = legacy ? 1 : data.rules.shellsPerTurn;
  let restored = createGame(data.fleets.player, data.difficulty, { enemyFleet: data.fleets.ai, matchId: data.matchId, aiRngState: data.aiRngState, shellsPerTurn, placementRule: legacy ? 'adjacent-allowed' : data.rules.placement });
  const volleys: VolleyRecord[] = legacy ? data.events.map(raw => {
    if (!raw || typeof raw !== 'object') throw new Error('存档事件无效');
    return { attacker: raw.attacker, coords: [raw.coord] };
  }) : data.volleys;
  let offset = 0;
  for (const volley of volleys) {
    if (!volley || typeof volley !== 'object' || !same(Object.keys(volley).sort(), ['attacker', 'coords'])) throw new Error('存档齐射记录无效');
    const result = applyVolley(restored, volley.attacker, volley.coords);
    const events = result.events.map((event, i) => validatedEvent(data.events[offset + i]!, event));
    restored = { ...result.state, events: [...restored.events, ...events] };
    offset += events.length;
  }
  if (offset !== data.events.length) throw new Error('存档攻击记录与齐射不一致');
  if (!same(data.shots, restored.shots) || data.turn !== restored.turn || data.winner !== restored.winner) throw new Error('存档回合状态不一致');
  return restored;
}
export function serializeGame(state: GameState): string { return JSON.stringify(validateGameSave(state)); }
export function parseGameSave(raw: string): GameState {
  if (typeof raw !== 'string' || raw.length > 300000) throw new Error('存档内容无效');
  let data: unknown; try { data = JSON.parse(raw); } catch { throw new Error('存档已损坏，可以开始新局'); }
  return validateGameSave(data);
}
