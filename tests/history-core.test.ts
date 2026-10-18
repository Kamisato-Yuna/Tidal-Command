import { describe, expect, it } from 'vitest';
import { applyVolley, createGame, getShotQuota } from '../src/core/game';
import { FLEET_SPECS, type GameState, type Ship } from '../src/core/types';
import { archiveCompletedMatch, createMatchRecord, exportHistory, HISTORY_BACKUP_FORMAT, HISTORY_KEY, importHistory, LEGACY_SAVE_KEY, loadHistory, MAX_BACKUP_BYTES, MAX_RECENT_MATCHES, mergeMatchRecords, migrateCompletedSave, parseHistoryBackup, setMatchFavorite, type HistoryStorage, type MatchRecord } from '../src/core/history';

const fleet = (): Ship[] => FLEET_SPECS.map((ship, index) => ({ ...ship, cells: Array.from({ length: ship.length }, (_, j) => (index === 4 ? 86 : 11 + index * 20) + j) }));
function completed(id = 'finished', shellsPerTurn = 5): GameState {
  let game = createGame(fleet(), 'easy', { enemyFleet: fleet(), matchId: id, shellsPerTurn, aiRngState: 13 });
  const hits = fleet().flatMap(ship => ship.cells), misses = Array.from({ length: 100 }, (_, i) => i).filter(c => !hits.includes(c));
  while (!game.winner) {
    const side = game.turn, order = side === 'player' ? [...hits, ...misses] : [...misses, ...hits];
    game = applyVolley(game, side, order.filter(c => !game.shots[side].includes(c)).slice(0, getShotQuota(game))).state;
  }
  return game;
}
class MemoryStorage implements HistoryStorage {
  data = new Map<string, string>();
  writes = 0;
  failRead = false;
  failWrite = false;
  getItem(key: string): string | null { if (this.failRead) throw new Error('SecurityError'); return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.failWrite) throw new Error('QuotaExceededError'); this.writes++; this.data.set(key, value); }
}
const record = (id: string, completedAt = 100, favorite = false): MatchRecord => ({ ...createMatchRecord(completed(id), completedAt), favorite });
function backup(records: MatchRecord[], exportedAt = 1000): string { return JSON.stringify({ format: HISTORY_BACKUP_FORMAT, version: 1, exportedAt, records }); }

describe('completed match history and browser storage boundaries', () => {
  it('archives validated matches independently of the active save and is idempotent', () => {
    const storage = new MemoryStorage(), game = completed(), before = JSON.stringify(game);
    storage.setItem(LEGACY_SAVE_KEY, 'active-save-is-untouched');
    expect(loadHistory(storage)).toMatchObject({ ok: true, records: [], changed: false });
    const first = archiveCompletedMatch(storage, game, 12);
    expect(first).toMatchObject({ ok: true, changed: true, imported: 1, evicted: 0 });
    expect(first.records[0]).toEqual({ id: game.matchId, completedAt: 12, favorite: false, game });
    expect(setMatchFavorite(storage, game.matchId, true).ok).toBe(true);
    const writes = storage.writes, again = archiveCompletedMatch(storage, game, 999);
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(again.records).toHaveLength(1);
    expect(again.records[0]).toMatchObject({ completedAt: 12, favorite: true });
    expect(storage.writes).toBe(writes);
    expect(storage.getItem(LEGACY_SAVE_KEY)).toBe('active-save-is-untouched');
    expect(JSON.stringify(game)).toBe(before);
  });

  it('refuses ongoing and tampered games without changing prior data', () => {
    const storage = new MemoryStorage(); archiveCompletedMatch(storage, completed('original'), 1);
    const before = storage.getItem(HISTORY_KEY), unfinished = createGame(fleet(), 'easy', { enemyFleet: fleet() });
    expect(archiveCompletedMatch(storage, unfinished).ok).toBe(false);
    const invalid = completed('tampered'); invalid.events[0]!.result = 'miss';
    expect(archiveCompletedMatch(storage, invalid).ok).toBe(false);
    expect(storage.getItem(HISTORY_KEY)).toBe(before);
    expect(() => createMatchRecord(completed(), -1)).toThrow('时间');
    expect(() => createMatchRecord(completed(), NaN)).toThrow('时间');
  });

  it('keeps 50 nonfavorites plus every favorite and never applies retention during reads or exports', () => {
    const storage = new MemoryStorage(), favorites = Array.from({ length: 52 }, (_, i) => record(`favorite-${i}`, i + 1, true));
    const recent = Array.from({ length: 53 }, (_, i) => record(`recent-${i}`, 200 + i));
    const exported = exportHistory([...favorites, ...recent], 1000);
    expect(parseHistoryBackup(exported)).toHaveLength(105);
    const result = importHistory(storage, exported);
    expect(result).toMatchObject({ ok: true, evicted: 3 });
    expect(result.records.filter(r => r.favorite)).toHaveLength(52);
    expect(result.records.filter(r => !r.favorite)).toHaveLength(MAX_RECENT_MATCHES);
    expect(result.records.some(r => r.id === 'recent-0')).toBe(false);
    expect(result.records.some(r => r.id === 'recent-52')).toBe(true);
    const writes = storage.writes;
    expect(loadHistory(storage).records).toEqual(result.records);
    expect(storage.writes).toBe(writes);
  });

  it('unfavoriting makes a record eligible for only the documented recent retention limit', () => {
    const storage = new MemoryStorage();
    importHistory(storage, exportHistory([record('old-favorite', 1, true), ...Array.from({ length: 50 }, (_, i) => record(`new-${i}`, i + 10))]));
    const result = setMatchFavorite(storage, 'old-favorite', false);
    expect(result).toMatchObject({ ok: true, evicted: 1 });
    expect(result.records).toHaveLength(50);
    expect(result.records.some(r => r.id === 'old-favorite')).toBe(false);
  });

  it('preserves all prior bytes and persisted favorite state when quota prevents a write', () => {
    const storage = new MemoryStorage(); archiveCompletedMatch(storage, completed('old'), 1);
    const before = storage.getItem(HISTORY_KEY), oldRecords = loadHistory(storage).records;
    storage.failWrite = true;
    for (const result of [archiveCompletedMatch(storage, completed('new'), 2), setMatchFavorite(storage, 'old', true), importHistory(storage, exportHistory([record('imported')]))]) {
      expect(result.ok).toBe(false); expect(result.error).toContain('QuotaExceededError'); expect(result.changed).toBe(false);
      expect(result.records).toEqual(oldRecords); expect(storage.getItem(HISTORY_KEY)).toBe(before);
    }
    // Caller can still keep/export an unpersisted completed record without touching storage.
    const pending = createMatchRecord(completed('pending'), 3);
    expect(parseHistoryBackup(exportHistory([...oldRecords, pending])).map(r => r.id)).toEqual(['pending', 'old']);
    storage.failWrite = false;
    expect(archiveCompletedMatch(storage, pending.game, pending.completedAt).ok).toBe(true);
  });

  it('never overwrites corrupt or future-version existing history, even when importing valid data', () => {
    for (const raw of ['{broken', JSON.stringify({ version: 900, records: [] }), JSON.stringify({ version: 1, records: [{ id: 'broken' }] })]) {
      const storage = new MemoryStorage(); storage.setItem(HISTORY_KEY, raw); const writes = storage.writes;
      expect(loadHistory(storage).ok).toBe(false);
      expect(archiveCompletedMatch(storage, completed()).ok).toBe(false);
      expect(importHistory(storage, exportHistory([record('good')])).ok).toBe(false);
      expect(setMatchFavorite(storage, 'good', true).ok).toBe(false);
      expect(migrateCompletedSave(storage, JSON.stringify(completed())).ok).toBe(false);
      expect(storage.getItem(HISTORY_KEY)).toBe(raw); expect(storage.writes).toBe(writes);
    }
  });

  it('fails clearly when reads are unavailable and never attempts a write', () => {
    const storage = new MemoryStorage(); storage.failRead = true;
    expect(loadHistory(storage)).toMatchObject({ ok: false, records: [] });
    expect(archiveCompletedMatch(storage, completed()).error).toContain('SecurityError');
    expect(storage.writes).toBe(0);
  });

  it('re-reads latest storage for stale-tab archive, import, and favorite operations', () => {
    const storage = new MemoryStorage(); archiveCompletedMatch(storage, completed('a'), 1);
    const tabOne = loadHistory(storage);
    archiveCompletedMatch(storage, completed('b'), 2);
    const changed = setMatchFavorite(storage, tabOne.records[0]!.id, true);
    expect(changed.records.map(r => r.id)).toEqual(['b', 'a']);
    expect(changed.records.find(r => r.id === 'a')!.favorite).toBe(true);
    importHistory(storage, exportHistory([record('c', 3)]));
    archiveCompletedMatch(storage, completed('d'), 4);
    expect(loadHistory(storage).records.map(r => r.id)).toEqual(['d', 'c', 'b', 'a']);
  });
});

describe('recoverable old autosave migration', () => {
  it('migrates current and legacy completed saves exactly once, preserving active bytes and original rules', () => {
    for (const legacy of [false, true]) {
      const storage = new MemoryStorage(), current = completed(`recover-${legacy}`, 1);
      // This legal fleet also satisfies the older, adjacency-allowed rules.
      current.rules = { shellsPerTurn: 1, placement: 'adjacent-allowed' };
      const { rules: _rules, volleys: _volleys, ...old } = current;
      const raw = JSON.stringify(legacy ? { ...old, version: 1 } : current);
      storage.setItem(LEGACY_SAVE_KEY, raw);
      const first = migrateCompletedSave(storage, undefined, 123);
      expect(first).toMatchObject({ ok: true, changed: true });
      expect(first.records[0]!.game.rules).toEqual({ shellsPerTurn: 1, placement: 'adjacent-allowed' });
      expect(first.records[0]!.completedAt).toBe(123);
      expect(migrateCompletedSave(storage, undefined, 456)).toMatchObject({ ok: true, changed: false });
      expect(loadHistory(storage).records).toHaveLength(1);
      expect(storage.getItem(LEGACY_SAVE_KEY)).toBe(raw);
    }
  });
  it('does not archive an ongoing save, and keeps damaged autosaves untouched', () => {
    const storage = new MemoryStorage(), active = createGame(fleet(), 'easy', { enemyFleet: fleet() });
    expect(migrateCompletedSave(storage, JSON.stringify(active))).toMatchObject({ ok: true, records: [], changed: false });
    storage.setItem(LEGACY_SAVE_KEY, '{bad');
    expect(migrateCompletedSave(storage).ok).toBe(false);
    expect(storage.getItem(LEGACY_SAVE_KEY)).toBe('{bad');
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
  });
});

describe('strict all-or-nothing backup round trips and deduplication', () => {
  it('round trips its exported format, deduplicates by ID, and preserves a favorite from either copy', () => {
    const storage = new MemoryStorage(), original = record('same', 1), favored = { ...original, favorite: true, completedAt: 999 };
    expect(importHistory(storage, exportHistory([original])).ok).toBe(true);
    expect(importHistory(storage, backup([favored, original])).ok).toBe(true);
    expect(loadHistory(storage).records).toEqual([{ ...original, favorite: true }]);
    const writes = storage.writes;
    expect(importHistory(storage, exportHistory([original]))).toMatchObject({ ok: true, changed: false });
    expect(storage.writes).toBe(writes);
    const exported = exportHistory(loadHistory(storage).records, 1000);
    expect(parseHistoryBackup(exported)).toEqual(loadHistory(storage).records);
    expect(mergeMatchRecords([original], [favored])).toEqual([{ ...original, favorite: true }]);
  });
  it('keeps optional undefined diagnostics stable across storage round trips', () => {
    const storage = new MemoryStorage(), game = completed();
    game.events.find(event => event.attacker === 'ai')!.aiDiagnostics = { strategy: 'easy', samples: 0, nodes: 0, elapsedMs: 1, timedOut: false, degraded: false, reason: undefined };
    expect(archiveCompletedMatch(storage, game, 1).ok).toBe(true);
    expect(archiveCompletedMatch(storage, game, 2)).toMatchObject({ ok: true, changed: false });
  });
  it('treats reordered JSON object properties as the same match', () => {
    const storage = new MemoryStorage(), original = record('same');
    importHistory(storage, exportHistory([original]));
    const reordered = JSON.parse(JSON.stringify(original, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value));
    expect(importHistory(storage, backup([reordered]))).toMatchObject({ ok: true, changed: false });
  });
  it('rejects conflicting same-ID matches atomically rather than replacing one', () => {
    const storage = new MemoryStorage(), original = record('same');
    importHistory(storage, exportHistory([original])); const before = storage.getItem(HISTORY_KEY);
    const conflict = record('same'); conflict.game.aiRngState = 99;
    const result = importHistory(storage, backup([record('other'), conflict]));
    expect(result.ok).toBe(false); expect(result.error).toContain('冲突'); expect(storage.getItem(HISTORY_KEY)).toBe(before);
  });
  it('rejects bad format/version, unknown fields, invalid timestamps, unfinished games and altered events as a whole', () => {
    const storage = new MemoryStorage(); archiveCompletedMatch(storage, completed('persisted'), 1); const before = storage.getItem(HISTORY_KEY);
    const valid = JSON.parse(exportHistory([record('valid')]));
    const mutations: ((v: any) => void)[] = [
      v => { v.format = 'other'; }, v => { v.version = 2; }, v => { v.extra = true; }, v => { v.exportedAt = -1; },
      v => { v.records[0].favorite = 'true'; }, v => { v.records[0].completedAt = 1.5; }, v => { v.records[0].id = 'different'; },
      v => { v.records[0].game.winner = null; }, v => { v.records[0].game.events[0].coord = 100; },
      v => { v.records[0].game.fleets.ai[0].extra = 'unknown'; }, v => { v.records.push({ broken: true }); },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(valid); mutate(candidate);
      expect(importHistory(storage, JSON.stringify(candidate)).ok).toBe(false);
      expect(storage.getItem(HISTORY_KEY)).toBe(before);
    }
  });
  it('rejects oversized UTF-8 backups before JSON parsing', () => {
    const storage = new MemoryStorage();
    expect(importHistory(storage, 'a'.repeat(MAX_BACKUP_BYTES + 1)).error).toContain('20 MB');
    expect(importHistory(storage, '海'.repeat(Math.floor(MAX_BACKUP_BYTES / 3) + 1)).error).toContain('20 MB');
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
  });
});
