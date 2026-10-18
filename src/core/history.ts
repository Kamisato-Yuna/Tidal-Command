import { parseGameSave, validateGameSave } from './save';
import type { GameState } from './types';

/** Separate from the active match: history only contains validated finished games. */
export const HISTORY_KEY = 'tidal-command:history:v1';
export const LEGACY_SAVE_KEY = 'tidal-command:match:v1';
export const HISTORY_VERSION = 1;
export const HISTORY_BACKUP_FORMAT = 'tidal-command:match-history';
export const MAX_RECENT_MATCHES = 50;
/** Bounds parsing work. Hitting this limit never deletes existing favorites. */
export const MAX_HISTORY_BYTES = 20 * 1024 * 1024;
export const MAX_BACKUP_BYTES = MAX_HISTORY_BYTES;

export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
export interface MatchRecord {
  id: string;
  /** Completion time, or recovery time for a save that did not record a date. */
  completedAt: number;
  favorite: boolean;
  game: GameState;
}
export interface HistoryResult {
  ok: boolean;
  /** On failure these are the previous successfully read, persisted records. */
  records: MatchRecord[];
  error: string;
  changed: boolean;
  evicted: number;
  imported: number;
}
interface HistoryStore { version: 1; records: MatchRecord[] }
interface HistoryBackup extends HistoryStore { format: typeof HISTORY_BACKUP_FORMAT; exportedAt: number }
interface MergedRecords { records: MatchRecord[]; evicted: number; imported: number }

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000;
}
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : '浏览器存储不可用'; }
function outcome(records: MatchRecord[], error = '', changed = false, evicted = 0, imported = 0): HistoryResult {
  return { ok: !error, records, error, changed, evicted, imported };
}
function checkSize(raw: string): void {
  if (typeof raw !== 'string' || raw.length > MAX_HISTORY_BYTES || new TextEncoder().encode(raw).byteLength > MAX_HISTORY_BYTES) {
    throw new Error('对战记录文件超过 20 MB，未更改已有记录');
  }
}
function parseJSON(raw: string): unknown {
  checkSize(raw);
  try { return JSON.parse(raw); } catch { throw new Error('对战记录不是有效 JSON，未更改已有记录'); }
}

/** Strict archive shape plus the existing rules engine's full event/volley replay. */
export function validateCompletedMatch(value: unknown): GameState {
  if (!object(value)) throw new Error('对战记录格式无效');
  const legacy = value.version === 1;
  const keys = ['version', 'matchId', 'difficulty', 'fleets', 'shots', 'turn', 'winner', 'events', 'aiRngState'];
  if (!legacy) keys.push('rules', 'volleys');
  if (!exactKeys(value, keys)) throw new Error('对战记录包含未知字段');
  if (!object(value.fleets) || !exactKeys(value.fleets, ['player', 'ai']) || !object(value.shots) || !exactKeys(value.shots, ['player', 'ai'])) throw new Error('对战记录舰队或攻击数据无效');
  for (const side of ['player', 'ai'] as const) {
    const fleet = value.fleets[side];
    if (!Array.isArray(fleet) || fleet.length !== 5 || fleet.some(ship => !object(ship) || !exactKeys(ship, ['id', 'name', 'length', 'cells']))) throw new Error('对战记录舰船格式无效');
  }
  if (!Array.isArray(value.events) || value.events.length > 199) throw new Error('对战攻击记录无效');
  for (const event of value.events) {
    if (!object(event)) throw new Error('对战攻击事件无效');
    if (event.sunkShip !== undefined && (!object(event.sunkShip) || !exactKeys(event.sunkShip, ['id', 'name', 'length', 'cells']))) throw new Error('对战击沉记录格式无效');
    if (event.aiDiagnostics !== undefined && (!object(event.aiDiagnostics) || !exactKeys(event.aiDiagnostics, ['strategy', 'samples', 'nodes', 'elapsedMs', 'timedOut', 'degraded'], ['reason']))) throw new Error('对战决策信息格式无效');
  }
  // The existing save validator compares a few objects via JSON.stringify.
  // Normalize their key order so legitimate JSON reformatting stays importable.
  const shipShape = (ship: Record<string, unknown>) => ({ id: ship.id, name: ship.name, length: ship.length, cells: ship.cells });
  const game = validateGameSave({
    ...value,
    fleets: { player: (value.fleets.player as Record<string, unknown>[]).map(shipShape), ai: (value.fleets.ai as Record<string, unknown>[]).map(shipShape) },
    shots: { player: value.shots.player, ai: value.shots.ai },
    events: value.events.map(event => ({ ...event, ...(event.sunkShip ? { sunkShip: shipShape(event.sunkShip) } : {}) })),
  });
  if (!game.winner || !game.events.length || game.events.at(-1)?.winner !== game.winner) throw new Error('只能保存或复盘已结束的对局');
  return game;
}
export function createMatchRecord(completed: GameState, now = Date.now()): MatchRecord {
  if (!timestamp(now)) throw new Error('对战完成时间无效');
  const game = validateCompletedMatch(completed);
  return { id: game.matchId, completedAt: now, favorite: false, game };
}
function validateRecord(value: unknown): MatchRecord {
  if (!object(value) || !exactKeys(value, ['id', 'completedAt', 'favorite', 'game']) || typeof value.id !== 'string' || typeof value.favorite !== 'boolean' || !timestamp(value.completedAt)) throw new Error('对战记录条目无效');
  const game = validateCompletedMatch(value.game);
  if (value.id !== game.matchId) throw new Error('对战记录编号不一致');
  return { id: value.id, completedAt: value.completedAt, favorite: value.favorite, game };
}
function newestFirst(a: MatchRecord, b: MatchRecord): number {
  return b.completedAt - a.completedAt || a.id.localeCompare(b.id, 'en');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function sameMatch(a: MatchRecord, b: MatchRecord): boolean { return canonical(a.game) === canonical(b.game); }
/** Duplicate imports may add a favorite, but can never silently remove one. */
function mergeValidated(existing: readonly MatchRecord[], incoming: readonly MatchRecord[], retain: boolean): MergedRecords {
  const byId = new Map<string, MatchRecord>();
  let imported = 0;
  for (const [source, items] of [[false, existing], [true, incoming]] as const) {
    for (const record of items) {
      const previous = byId.get(record.id);
      if (previous) {
        if (!sameMatch(previous, record)) throw new Error(`对局 ${record.id} 存在冲突，未更改已有记录`);
        if (record.favorite && !previous.favorite) byId.set(record.id, { ...previous, favorite: true });
      } else {
        byId.set(record.id, record);
        if (source) imported++;
      }
    }
  }
  const sorted = [...byId.values()].sort(newestFirst);
  let recent = 0, evicted = 0;
  const records = retain ? sorted.filter(record => {
    if (record.favorite || recent++ < MAX_RECENT_MATCHES) return true;
    evicted++;
    return false;
  }) : sorted;
  return { records, imported, evicted };
}
/** Useful for pending-session backups. Does not apply retention or touch storage. */
export function mergeMatchRecords(existing: readonly MatchRecord[], incoming: readonly MatchRecord[]): MatchRecord[] {
  return mergeValidated(existing.map(validateRecord), incoming.map(validateRecord), false).records;
}
function validateStore(value: unknown): HistoryStore {
  if (!object(value) || !exactKeys(value, ['version', 'records']) || value.version !== HISTORY_VERSION || !Array.isArray(value.records)) throw new Error('对战记录格式损坏或版本不兼容，原始数据已保留');
  const records = value.records.map(validateRecord);
  // Duplicate entries are recoverable on the next successful transaction; no read writes.
  return { version: 1, records: mergeValidated(records, [], false).records };
}
export function loadHistory(storage: HistoryStorage): HistoryResult {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    return outcome(raw === null ? [] : validateStore(parseJSON(raw)).records);
  } catch (error) {
    return outcome([], `无法读取对战记录：${errorMessage(error)}。未覆盖原始数据。`);
  }
}

/**
 * Web Storage setItem is atomic: quota/security failure leaves the old value intact.
 * Do not clear, stage in a second quota-consuming key, or evict extra records on failure.
 */
function commit(storage: HistoryStorage, previous: HistoryResult, next: MergedRecords): HistoryResult {
  try {
    const raw = JSON.stringify({ version: HISTORY_VERSION, records: next.records } satisfies HistoryStore);
    checkSize(raw);
    if (JSON.stringify(previous.records) === JSON.stringify(next.records)) return outcome(previous.records);
    storage.setItem(HISTORY_KEY, raw);
    return outcome(next.records, '', true, next.evicted, next.imported);
  } catch (error) {
    return outcome(previous.records, `保存对战记录失败：${errorMessage(error)}。已有记录未改变，请导出备份后重试。`);
  }
}
export function archiveCompletedMatch(storage: HistoryStorage, completed: GameState, now = Date.now()): HistoryResult {
  const previous = loadHistory(storage);
  if (!previous.ok) return previous;
  try { return commit(storage, previous, mergeValidated(previous.records, [createMatchRecord(completed, now)], true)); }
  catch (error) { return outcome(previous.records, errorMessage(error)); }
}
export function setMatchFavorite(storage: HistoryStorage, id: string, favorite: boolean): HistoryResult {
  const previous = loadHistory(storage);
  if (!previous.ok) return previous;
  if (typeof favorite !== 'boolean' || !previous.records.some(record => record.id === id)) return outcome(previous.records, '找不到此对战记录，未更改收藏');
  const records = previous.records.map(record => record.id === id ? { ...record, favorite } : record);
  return commit(storage, previous, mergeValidated(records, [], true));
}
/** Recovery is idempotent and never removes or modifies the independent active save. */
export function migrateCompletedSave(storage: HistoryStorage, rawSavedGame?: string | null, now = Date.now()): HistoryResult {
  const previous = loadHistory(storage);
  if (!previous.ok) return previous;
  try {
    const raw = rawSavedGame === undefined ? storage.getItem(LEGACY_SAVE_KEY) : rawSavedGame;
    if (!raw) return previous;
    const game = parseGameSave(raw);
    if (!game.winner) return previous;
    return commit(storage, previous, mergeValidated(previous.records, [createMatchRecord(game, now)], true));
  } catch (error) { return outcome(previous.records, `旧对局恢复失败：${errorMessage(error)}。原存档已保留。`); }
}
/** Exports every supplied favorite and pending record; export never applies retention. */
export function exportHistory(records: readonly MatchRecord[], now = Date.now()): string {
  if (!timestamp(now)) throw new Error('备份导出时间无效');
  const validated = mergeValidated([], records.map(validateRecord), false).records;
  const raw = JSON.stringify({ format: HISTORY_BACKUP_FORMAT, version: HISTORY_VERSION, exportedAt: now, records: validated } satisfies HistoryBackup, null, 2);
  checkSize(raw);
  return raw;
}
export function parseHistoryBackup(raw: string): MatchRecord[] {
  const value = parseJSON(raw);
  if (!object(value) || !exactKeys(value, ['format', 'version', 'exportedAt', 'records']) || value.format !== HISTORY_BACKUP_FORMAT || value.version !== HISTORY_VERSION || !timestamp(value.exportedAt) || !Array.isArray(value.records)) throw new Error('不是受支持的潮汐指挥官对战备份');
  return mergeValidated([], value.records.map(validateRecord), false).records;
}
/** All-or-nothing validation/merge before one atomic write. No replacement import. */
export function importHistory(storage: HistoryStorage, raw: string): HistoryResult {
  const previous = loadHistory(storage);
  if (!previous.ok) return previous;
  try { return commit(storage, previous, mergeValidated(previous.records, parseHistoryBackup(raw), true)); }
  catch (error) { return outcome(previous.records, `导入失败：${errorMessage(error)}。已有记录未改变。`); }
}
