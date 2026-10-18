// @vitest-environment jsdom
/** History integration with mocked WebGL and AI. Real browser coverage is separate. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { applyVolley, createGame, FLEET_SPECS, getShotQuota, serializeGame, type GameState, type Ship } from '../src/core';
import { createMatchRecord, exportHistory, HISTORY_KEY, type MatchRecord } from '../src/core/history';
import App from '../src/App';

const SAVE = 'tidal-command:match:v1';
const mocks = vi.hoisted(() => ({ worker: vi.fn(() => () => {}), blobs: [] as Blob[] }));
vi.mock('../src/audio/sound', () => ({ sound: { unlock: async () => {}, play: () => {}, configure: () => {}, setAmbient: () => {} } }));
vi.mock('../src/workers/client', () => ({ requestAI: mocks.worker }));
vi.mock('../src/scene/SeaBoard', () => ({ SeaBoard: (props: { ships: readonly Ship[]; known?: readonly string[]; interactive?: boolean }) => <div data-testid="history-scene" data-ships={JSON.stringify(props.ships)} data-known={JSON.stringify(props.known)} data-interactive={String(props.interactive)} /> }));
const fleet = (): Ship[] => FLEET_SPECS.map((ship, i) => ({ ...ship, cells: Array.from({ length: ship.length }, (_, j) => (i === 4 ? 86 : 11 + i * 20) + j) }));
function game(id = 'history-ui', completed = true, shellsPerTurn = 5): GameState {
  let state = createGame(fleet(), 'easy', { enemyFleet: fleet(), matchId: id, shellsPerTurn, aiRngState: 17 });
  const hits = fleet().flatMap(ship => ship.cells), misses = Array.from({ length: 100 }, (_, c) => c).filter(c => !hits.includes(c));
  while (completed && !state.winner) {
    const side = state.turn, order = side === 'player' ? [...hits, ...misses] : [...misses, ...hits];
    state = applyVolley(state, side, order.filter(c => !state.shots[side].includes(c)).slice(0, getShotQuota(state))).state;
  }
  return state;
}
const record = (id = 'history-ui', favorite = false): MatchRecord => ({ ...createMatchRecord(game(id), 1770000000000), favorite });
const persist = (records: MatchRecord[]) => localStorage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, records }));
const archive = () => JSON.parse(localStorage.getItem(HISTORY_KEY) || '{"records":[]}') as { records: MatchRecord[] };
const openHistory = () => fireEvent.click(screen.getByRole('button', { name: /^对战记录 / }));
const cards = () => document.querySelectorAll('.history-card');
async function importFile(raw: string) {
  const file = { name: 'history.json', size: new TextEncoder().encode(raw).length, text: async () => raw };
  fireEvent.change(screen.getByLabelText('导入对战备份文件'), { target: { files: [file] } });
  await waitFor(() => expect((screen.getByRole('button', { name: '导入备份' }) as HTMLButtonElement).disabled).toBe(false));
}
function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsText(blob); });
}
beforeEach(() => {
  localStorage.clear(); mocks.worker.mockClear(); mocks.blobs.length = 0;
  localStorage.setItem('tidal-command:settings:v1', JSON.stringify({ fast: true, muted: true, reducedMotion: true, guide: false }));
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((blob: Blob) => { mocks.blobs.push(blob); return 'blob:qa'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('history UI persistence, backup and active-match isolation', () => {
  it('archives a completed autosave once across repeated mounts and exposes result replay actions', () => {
    localStorage.setItem(SAVE, serializeGame(game())); render(<App />);
    expect(archive().records).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /查看上次战报/ }));
    expect(screen.getByRole('button', { name: '复盘本场' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '收藏本场' }));
    expect(screen.getByRole('button', { name: '已收藏本场' }).getAttribute('aria-pressed')).toBe('true');
    const stored = localStorage.getItem(HISTORY_KEY);
    cleanup(); render(<App />); cleanup(); render(<App />);
    expect(localStorage.getItem(HISTORY_KEY)).toBe(stored); expect(archive().records).toHaveLength(1);
    openHistory(); expect(cards()).toHaveLength(1);
    expect(screen.getByRole('button', { name: '取消收藏对局' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not archive an unfinished save or invoke its AI while browsing history', () => {
    const live = applyVolley(game('live', false), 'player', [0, 1, 2, 3, 4]).state;
    localStorage.setItem(SAVE, serializeGame(live)); const before = localStorage.getItem(SAVE);
    persist([record()]); render(<App />); openHistory();
    expect(archive().records).toHaveLength(1); expect(localStorage.getItem(SAVE)).toBe(before);
    expect(mocks.worker).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    expect(screen.getByRole('button', { name: /继续上次作战/ })).toBeTruthy();
    expect(localStorage.getItem(SAVE)).toBe(before);
  });

  it('merges a backup without changing the live match and rejects malformed or conflicting backups atomically', async () => {
    localStorage.setItem(SAVE, serializeGame(game('live', false))); persist([record('existing', true)]);
    render(<App />); openHistory(); const liveBefore = localStorage.getItem(SAVE);
    await importFile(exportHistory([record('imported')]));
    expect(cards()).toHaveLength(2); const before = localStorage.getItem(HISTORY_KEY);
    await importFile('{not json'); expect(screen.getByRole('alert').textContent).toContain('导入失败');
    expect(localStorage.getItem(HISTORY_KEY)).toBe(before);
    const conflict = record('existing'); conflict.game.aiRngState = 18;
    await importFile(exportHistory([conflict])); expect(screen.getByRole('alert').textContent).toContain('冲突');
    expect(localStorage.getItem(HISTORY_KEY)).toBe(before); expect(localStorage.getItem(SAVE)).toBe(liveBefore);
    expect(archive().records.find(r => r.id === 'existing')?.favorite).toBe(true);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('refuses an oversized file before reading its contents', async () => {
    persist([record()]); render(<App />); openHistory(); const before = localStorage.getItem(HISTORY_KEY);
    const text = vi.fn(async () => '{}');
    fireEvent.change(screen.getByLabelText('导入对战备份文件'), { target: { files: [{ size: 20 * 1024 * 1024 + 1, text }] } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('超过20MB'));
    expect(text).not.toHaveBeenCalled(); expect(localStorage.getItem(HISTORY_KEY)).toBe(before);
  });

  it('keeps a failed completion exportable, warns across navigation, and retries without duplicates', async () => {
    persist([record('saved', true)]); localStorage.setItem(SAVE, serializeGame(game('pending')));
    const originalSet = Storage.prototype.setItem; let fail = true;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) { if (key === HISTORY_KEY && fail) throw new DOMException('quota', 'QuotaExceededError'); originalSet.call(this, key, value); });
    const before = localStorage.getItem(HISTORY_KEY); render(<App />);
    expect(screen.getByRole('alert').textContent).toContain('关闭页面可能丢失');
    openHistory(); expect(cards()).toHaveLength(2); expect(screen.getByText('尚未写入浏览器存储')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '导出全部备份' }));
    const backup = JSON.parse(await blobText(mocks.blobs[0]!));
    expect(backup.records.map((r: MatchRecord) => r.id).sort()).toEqual(['pending', 'saved']);
    expect(backup.records.find((r: MatchRecord) => r.id === 'saved').favorite).toBe(true);
    expect(localStorage.getItem(HISTORY_KEY)).toBe(before);
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    expect(screen.getByRole('alert').textContent).toContain('关闭页面可能丢失'); openHistory();
    fail = false; fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    expect(archive().records).toHaveLength(2); expect(screen.queryByText('尚未写入浏览器存储')).toBe(null);
    expect(archive().records.find(r => r.id === 'saved')?.favorite).toBe(true);
  });

  it('does not display a successful favorite when persistent storage rejects the write', () => {
    persist([record()]); render(<App />); openHistory(); const before = localStorage.getItem(HISTORY_KEY);
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) { if (key === HISTORY_KEY) throw new DOMException('quota', 'QuotaExceededError'); originalSet.call(this, key, value); });
    fireEvent.click(screen.getByRole('button', { name: '收藏对局' }));
    expect(screen.getByRole('button', { name: '收藏对局' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('alert').textContent).toContain('已有记录未改变'); expect(localStorage.getItem(HISTORY_KEY)).toBe(before);
  });

  it('never overwrites a corrupt archive when a completed game is recovered or a backup is imported', async () => {
    localStorage.setItem(HISTORY_KEY, '{broken'); localStorage.setItem(SAVE, serializeGame(game('pending')));
    render(<App />); openHistory(); expect(cards()).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toContain('未覆盖原始数据');
    await importFile(exportHistory([record('new')]));
    expect(localStorage.getItem(HISTORY_KEY)).toBe('{broken'); expect(cards()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '导出全部备份' }));
    const backup = JSON.parse(await blobText(mocks.blobs[0]!)); expect(backup.records[0].id).toBe('pending');
  });

  it('refreshes a favorite changed in another tab and preserves it on a later import', async () => {
    persist([record()]); render(<App />); openHistory();
    persist([record('history-ui', true)]);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: HISTORY_KEY, newValue: localStorage.getItem(HISTORY_KEY) })));
    expect(screen.getByRole('button', { name: '取消收藏对局' }).getAttribute('aria-pressed')).toBe('true');
    await importFile(exportHistory([record()]));
    expect(archive().records).toHaveLength(1); expect(archive().records[0].favorite).toBe(true);
  });

  it('filters and paginates retained records while protecting old favorites from the 50-recent cap', async () => {
    const favorite = { ...record('old-favorite', true), completedAt: 1 };
    persist([favorite]); render(<App />); openHistory();
    const records = Array.from({ length: 52 }, (_, i) => ({ ...record(`recent-${i}`), completedAt: 100 + i }));
    await importFile(exportHistory(records));
    expect(archive().records).toHaveLength(51); expect(archive().records.some(r => r.id === favorite.id && r.favorite)).toBe(true);
    expect(cards()).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: '下一页' })); expect(screen.getByText('2 / 5')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^已收藏 1$/ })); expect(cards()).toHaveLength(1);
    expect(screen.getByRole('button', { name: '取消收藏对局' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: '对战记录分页' })).toBe(null);
  });

  it('migrates a completed legacy one-shell save while retaining its legacy rules', () => {
    const current = game('legacy-ui', true, 1);
    const { rules: _rules, volleys: _volleys, ...legacy } = current;
    localStorage.setItem(SAVE, JSON.stringify({ ...legacy, version: 1 })); render(<App />); openHistory();
    expect(archive().records).toHaveLength(1); expect(archive().records[0].game.rules).toEqual({ shellsPerTurn: 1, placement: 'adjacent-allowed' });
    expect(screen.getByText(/旧局相邻规则/)).toBeTruthy();
  });
});

describe('read-only historical replay integration', () => {
  function openReplay() {
    localStorage.setItem(SAVE, serializeGame(game('live-replay', false)));
    persist([record('past-replay')]); render(<App />); openHistory();
    fireEvent.click(screen.getByRole('button', { name: '复盘对局' }));
  }
  const slider = () => screen.getByRole('slider', { name: '回放进度' }) as HTMLInputElement;
  const displayed = () => ({ ships: JSON.parse(screen.getByTestId('history-scene').getAttribute('data-ships')!) as Ship[], known: JSON.parse(screen.getByTestId('history-scene').getAttribute('data-known')!) as string[] });

  it('shows only prefix knowledge, every executed shot and no unused winning-plan tail', () => {
    openReplay(); const liveBefore = localStorage.getItem(SAVE), historyBefore = localStorage.getItem(HISTORY_KEY);
    const completed = archive().records[0].game;
    expect(slider().value).toBe('0'); expect(slider().max).toBe(String(completed.events.length));
    expect(displayed().ships).toEqual([]); expect(displayed().known.every(k => k === 'unknown')).toBe(true);
    expect(screen.getByTestId('history-scene').getAttribute('data-interactive')).toBe('false');
    expect(within(screen.getByRole('region', { name: '当前炮击详情' })).queryByText(/获胜/)).toBe(null);
    fireEvent.change(slider(), { target: { value: '4' } });
    expect(displayed().ships).toEqual([]); expect(displayed().known.filter(k => k === 'hit')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: '下一发' }));
    expect(displayed().ships.map(s => s.id)).toEqual(['carrier']);
    expect(displayed().known.filter(k => k === 'sunk')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: '跳到结局' }));
    expect(slider().value).toBe(String(completed.events.length));
    expect(screen.getByRole('region', { name: '当前炮击详情' }).textContent).toContain('2 / 5');
    expect(screen.getByText('我方获胜。本轮剩余炮弹未发射。')).toBeTruthy();
    for (const unused of completed.volleys.at(-1)!.coords.slice(2)) expect(displayed().known[unused]).toBe('unknown');
    expect(within(screen.getByRole('list', { name: '全部实际炮击记录' })).getAllByRole('listitem')).toHaveLength(completed.events.length + 1);
    fireEvent.click(screen.getByRole('button', { name: '跳到开局' }));
    expect(displayed().ships).toEqual([]); expect(displayed().known.every(k => k === 'unknown')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(localStorage.getItem(SAVE)).toBe(liveBefore); expect(localStorage.getItem(HISTORY_KEY)).toBe(historyBefore);
    expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('switches public perspectives and own boards without revealing future damage or advancing the live game', () => {
    openReplay(); const before = localStorage.getItem(SAVE);
    fireEvent.click(screen.getByRole('button', { name: '己方海域' })); expect(displayed().ships).toHaveLength(5);
    expect(screen.getByRole('grid', { name: '我方舰队布局，第 0 发之后' }).getAttribute('aria-readonly')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '对手视角' })); expect(displayed().ships).toHaveLength(5);
    expect(screen.getByLabelText('航空母舰，剩余 5 格舰体')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /攻击海域/ })); expect(displayed().ships).toEqual([]);
    fireEvent.change(slider(), { target: { value: '5' } });
    expect(displayed().ships).toEqual([]); // AI has not sunk any player ship by this time.
    expect(screen.getByLabelText('航空母舰，剩余 0 格舰体')).toBeTruthy();
    expect(localStorage.getItem(SAVE)).toBe(before); expect(mocks.worker).not.toHaveBeenCalled();
  });

  it('pauses playback on seek, modal opening and exit, and can restart from the result', () => {
    vi.useFakeTimers(); openReplay(); const before = localStorage.getItem(SAVE);
    fireEvent.change(screen.getByRole('combobox', { name: '回放速度' }), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '自动播放' }));
    act(() => vi.advanceTimersByTime(313)); expect(slider().value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    act(() => vi.advanceTimersByTime(1000)); expect(slider().value).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.getByRole('button', { name: '自动播放' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '自动播放' }));
    fireEvent.change(slider(), { target: { value: '6' } }); act(() => vi.advanceTimersByTime(1000)); expect(slider().value).toBe('6');
    fireEvent.click(screen.getByRole('button', { name: '跳到结局' }));
    fireEvent.click(screen.getByRole('button', { name: '重新播放' })); expect(slider().value).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: '返回' })); act(() => vi.advanceTimersByTime(5000));
    expect(screen.queryByRole('main', { name: '战斗回放' })).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: '复盘对局' })); expect(slider().value).toBe('0');
    expect(localStorage.getItem(SAVE)).toBe(before); expect(mocks.worker).not.toHaveBeenCalled();
  });
});
