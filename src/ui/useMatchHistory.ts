import { useEffect, useState } from 'react';
import type { GameState } from '../core';
import { HISTORY_KEY, archiveCompletedMatch, createMatchRecord, exportHistory, importHistory, loadHistory, setMatchFavorite, type MatchRecord, type HistoryResult } from '../core/history';

// Access is deferred so SecurityError/private-mode failures are reported by the store.
const storage = {
  getItem: (key: string) => window.localStorage.getItem(key),
  setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
};

export function useMatchHistory(game: GameState | null) {
  const [history, setHistory] = useState(() => loadHistory(storage));
  const [pending, setPending] = useState<MatchRecord[]>([]);
  const [message, setMessage] = useState('');

  const receive = (result: HistoryResult) => {
    setHistory(old => ({ ...result, records: result.ok || result.records.length ? result.records : old.records }));
    return result.ok;
  };

  const archive = (completed: GameState, completedAt = Date.now()) => {
    const result = archiveCompletedMatch(storage, completed, completedAt);
    receive(result);
    if (result.ok) {
      setPending(old => old.filter(record => record.id !== completed.matchId));
    } else {
      // Never discard the only in-memory copy when persistent storage is full.
      try {
        const record = createMatchRecord(completed, completedAt);
        setPending(old => old.some(item => item.id === record.id) ? old : [...old, record]);
      } catch { /* The active-game validator already reports invalid games. */ }
    }
    return result;
  };

  useEffect(() => {
    if (game?.winner) archive(game);
    // A completed autosave is migrated by the same idempotent archive path.
    // History mutations must not rerun or replace the active game.
  }, [game]);

  useEffect(() => {
    const refresh = (event: StorageEvent) => {
      if (event.key === HISTORY_KEY || event.key === null) receive(loadHistory(storage));
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  useEffect(() => {
    if (!pending.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pending.length]);

  const retry = () => {
    let failed = false;
    for (const record of pending) if (!archive(record.game, record.completedAt).ok) failed = true;
    if (!pending.length) failed = !receive(loadHistory(storage));
    setMessage(failed ? '' : '对战记录已保存到当前浏览器。');
  };

  const toggleFavorite = (record: MatchRecord) => {
    // A pending completion can be favorited only after it actually reaches storage.
    if (pending.includes(record)) {
      const saved = archive(record.game, record.completedAt);
      if (!saved.ok) { setMessage(''); return; }
    }
    const latest = loadHistory(storage);
    if (!latest.ok) { receive(latest); setMessage(''); return; }
    const current = latest.records.find(item => item.id === record.id);
    if (!current) { setMessage('这场对局已不在近期记录中，请先导入备份。'); return; }
    const result = setMatchFavorite(storage, record.id, !current.favorite);
    receive(result);
    setMessage(result.ok ? (!current.favorite ? '已收藏，不会被自动清理。请导出备份以防浏览器数据被清除。' : '已取消收藏，之后按最近50场规则保留。') : '');
  };

  const importBackup = (raw: string) => {
    const result = importHistory(storage, raw);
    receive(result);
    if (result.ok) {
      // Successful imports may contain a pending copy. Retry uses content validation
      // before considering it durably saved, rather than trusting just a match ID.
      for (const record of pending) archive(record.game, record.completedAt);
      setMessage(`备份已合并，新增 ${result.imported} 场对局。${result.evicted ? `较早的 ${result.evicted} 场未收藏记录已按最近50场规则移出。` : '重复对局不会重复保存。'}`);
    } else setMessage('');
    return result.ok;
  };

  const backup = (single?: MatchRecord) => {
    if (single) return exportHistory([single]);
    const latest = loadHistory(storage);
    receive(latest);
    // Corrupt storage is never replaced; known valid and pending copies remain
    // exportable so a storage problem cannot strand the current completed match.
    return exportHistory([...(latest.ok ? latest.records : history.records), ...pending]);
  };

  return { records: history.records, pending, error: history.error, message, retry, toggleFavorite, importBackup, backup };
}
