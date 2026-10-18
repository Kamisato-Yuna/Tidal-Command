import { test, expect, type Page, type TestInfo } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { applyVolley, createGame, FLEET_SPECS, getShotQuota, serializeGame, type GameState, type Ship } from '../../src/core';
import { createMatchRecord, exportHistory, HISTORY_KEY, type MatchRecord } from '../../src/core/history';

// Deterministic completed fixtures exercise replay/archive integration. Baseline
// game.spec.ts separately plays a complete match through the normal firing UI.
const SAVE = 'tidal-command:match:v1';
const fleet = (): Ship[] => FLEET_SPECS.map((ship, i) => ({ ...ship, cells: Array.from({ length: ship.length }, (_, j) => (i === 4 ? 86 : 11 + i * 20) + j) }));
function game(id: string, finished = true): GameState {
  let state = createGame(fleet(), 'easy', { enemyFleet: fleet(), matchId: id, shellsPerTurn: 5, aiRngState: 17 });
  const hits = fleet().flatMap(ship => ship.cells), misses = Array.from({ length: 100 }, (_, c) => c).filter(c => !hits.includes(c));
  while (finished && !state.winner) {
    const side = state.turn, order = side === 'player' ? [...hits, ...misses] : [...misses, ...hits];
    state = applyVolley(state, side, order.filter(c => !state.shots[side].includes(c)).slice(0, getShotQuota(state))).state;
  }
  return state;
}
const record = (id: string, favorite = false): MatchRecord => ({ ...createMatchRecord(game(id), 1770000000000), favorite });
async function seed(page: Page, live: GameState, records: MatchRecord[] = []) {
  await page.addInitScript(({ save, history, liveRaw, historyRaw }) => {
    if (!localStorage.getItem(save)) localStorage.setItem(save, liveRaw);
    if (!localStorage.getItem(history)) localStorage.setItem(history, historyRaw);
    localStorage.setItem('tidal-command:settings:v1', JSON.stringify({ fast: true, muted: true, quality: 'high', reducedMotion: true, ambient: false, guide: false }));
  }, { save: SAVE, history: HISTORY_KEY, liveRaw: serializeGame(live), historyRaw: JSON.stringify({ version: 1, records }) });
  await page.goto('./');
}
const liveBytes = (page: Page) => page.evaluate(key => localStorage.getItem(key), SAVE);
const historyBytes = (page: Page) => page.evaluate(key => localStorage.getItem(key), HISTORY_KEY);
async function records(page: Page): Promise<MatchRecord[]> { return JSON.parse((await historyBytes(page))!).records; }
const openHistory = (page: Page) => page.getByRole('button', { name: /^对战记录 / }).click();
async function importBackup(page: Page, raw: string) {
  await page.getByLabel('导入对战备份文件').setInputFiles({ name: 'qa-history.json', mimeType: 'application/json', buffer: Buffer.from(raw) });
  await expect(page.getByRole('button', { name: '导入备份', exact: true })).toBeEnabled();
}
async function frameReady(page: Page) {
  await expect(page.locator('canvas')).toBeVisible();
  await page.evaluate(() => new Promise<void>(resolve => { let n = 24; const frame = () => --n ? requestAnimationFrame(frame) : resolve(); requestAnimationFrame(frame); }));
}
async function exportBackup(page: Page, name: string, info: TestInfo) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const download = await downloadPromise; const path = info.outputPath('download.json'); await download.saveAs(path);
  return JSON.parse(readFileSync(path, 'utf8')) as { records: MatchRecord[] };
}

test('completed migration, result replay, favorite, real download and repeated reload dedup', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const completed = game('browser-completed'); await seed(page, completed);
  await expect.poll(async () => (await records(page)).length).toBe(1);
  await page.getByRole('button', { name: /查看上次战报/ }).click();
  await page.getByRole('button', { name: '收藏本场', exact: true }).click();
  await expect(page.getByRole('button', { name: '已收藏本场', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const before = await liveBytes(page); const exported = await exportBackup(page, '导出本场备份', info);
  expect(exported.records).toHaveLength(1); expect(exported.records[0].favorite).toBe(true);
  await page.getByRole('button', { name: '复盘本场', exact: true }).click(); await frameReady(page);
  await expect(page.getByRole('slider', { name: '回放进度' })).toHaveValue('0');
  await page.getByRole('button', { name: '跳到结局', exact: true }).click();
  await expect(page.getByRole('slider', { name: '回放进度' })).toHaveValue('32');
  await expect(page.getByRole('region', { name: '当前炮击详情' })).toContainText('本轮剩余炮弹未发射');
  await expect(page.getByRole('list', { name: '全部实际炮击记录' }).getByRole('listitem')).toHaveCount(33);
  await expect.poll(() => page.locator('.replay-event-list').evaluate(rail => {
    const row = rail.querySelector('[aria-current="step"]')!;
    const railBox = rail.getBoundingClientRect(), rowBox = row.getBoundingClientRect();
    return rowBox.top >= railBox.top - 1 && rowBox.bottom <= railBox.bottom + 1;
  })).toBe(true);
  await page.screenshot({ path: info.outputPath('replay-final-desktop.png'), fullPage: true });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page.getByRole('heading', { name: '这片海域，属于你。' })).toBeVisible(); expect(await liveBytes(page)).toBe(before);
  await page.reload(); await page.reload(); await openHistory(page);
  await expect(page.locator('.history-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '取消收藏对局' })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('history-desktop.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('active match survives imported historical playback, seek, orbit, modal pause and mobile exit', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await seed(page, game('live-isolated', false)); const before = await liveBytes(page); await openHistory(page);
  await importBackup(page, exportHistory([record('historical')])); await expect(page.locator('.history-card')).toHaveCount(1);
  await page.getByRole('button', { name: '复盘对局' }).click(); await frameReady(page);
  const slider = page.getByRole('slider', { name: '回放进度' });
  await expect(slider).toHaveValue('0'); await page.getByRole('button', { name: '下一发', exact: true }).click(); await expect(slider).toHaveValue('1');
  await expect(page.getByRole('region', { name: '当前炮击详情' })).toContainText('B2');
  await page.getByRole('button', { name: '下一发', exact: true }).click(); await expect(slider).toHaveValue('2');
  await page.getByRole('button', { name: '上一发', exact: true }).click(); await expect(slider).toHaveValue('1');
  await page.getByRole('combobox', { name: '回放速度' }).selectOption('4');
  await page.getByRole('button', { name: '自动播放', exact: true }).click();
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(1);
  await page.getByRole('button', { name: '设置', exact: true }).click(); const paused = await slider.inputValue();
  await page.waitForTimeout(800); await expect(slider).toHaveValue(paused);
  await page.getByRole('button', { name: '关闭', exact: true }).click(); await expect(page.getByRole('button', { name: '自动播放', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '跳到结局', exact: true }).click();
  const canvas = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(canvas.x + canvas.width * .7, canvas.y + canvas.height * .6); await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * .3, canvas.y + canvas.height * .5, { steps: 16 }); await page.mouse.up();
  await expect(slider).toHaveValue('32'); expect(await liveBytes(page)).toBe(before);
  await page.getByRole('button', { name: '重置回放镜头' }).click();
  await page.getByRole('button', { name: '对手视角', exact: true }).click();
  await expect(page.getByRole('grid', { name: '对手舰队布局，第 32 发之后' })).toHaveAttribute('aria-readonly', 'true');
  await page.getByRole('button', { name: '我方视角', exact: true }).click();
  await page.getByRole('button', { name: '跳到开局', exact: true }).click(); await frameReady(page);
  await page.screenshot({ path: info.outputPath('replay-opening-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await frameReady(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['下一发', '自动播放', '跳到结局']) {
    const control = page.getByRole('button', { name, exact: true }); await control.scrollIntoViewIfNeeded(); const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.getByRole('button', { name: '下一发', exact: true }).click(); await expect(slider).toHaveValue('1');
  await page.screenshot({ path: info.outputPath('replay-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '返回', exact: true }).click();
  await page.screenshot({ path: info.outputPath('history-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: '返回首页', exact: true }).click();
  await page.getByRole('button', { name: /继续上次作战/ }).click();
  await expect(page.getByRole('heading', { name: '指挥官，选择你的目标。' })).toBeVisible();
  expect(await liveBytes(page)).toBe(before); expect(errors).toEqual([]);
});

test('invalid backups are atomic and old favorites survive retention, pagination and export', async ({ page }, info) => {
  await seed(page, game('retention-live', false), [{ ...record('protected', true), completedAt: 1 }]); await openHistory(page);
  const liveBefore = await liveBytes(page), before = await historyBytes(page);
  await importBackup(page, '{broken'); await expect(page.getByRole('alert')).toContainText('导入失败'); expect(await historyBytes(page)).toBe(before);
  const conflict = record('protected'); conflict.game.aiRngState = 18;
  await importBackup(page, exportHistory([conflict])); await expect(page.getByRole('alert')).toContainText('冲突'); expect(await historyBytes(page)).toBe(before);
  const incoming = Array.from({ length: 52 }, (_, i) => ({ ...record(`recent-${i}`), completedAt: 100 + i }));
  await importBackup(page, exportHistory(incoming));
  expect((await records(page))).toHaveLength(51); expect((await records(page)).find(r => r.id === 'protected')?.favorite).toBe(true);
  await expect(page.locator('.history-card')).toHaveCount(12); await page.getByRole('button', { name: '下一页' }).click();
  await expect(page.getByRole('navigation', { name: '对战记录分页' })).toContainText('2 / 5');
  await page.getByRole('button', { name: /^已收藏 1$/ }).click(); await expect(page.locator('.history-card')).toHaveCount(1);
  const exported = await exportBackup(page, '导出全部备份', info); expect(exported.records).toHaveLength(51); expect(exported.records.find(r => r.id === 'protected')?.favorite).toBe(true);
  expect(await liveBytes(page)).toBe(liveBefore);
});

test('storage quota failure keeps pending records exportable and favorites unchanged until successful retry', async ({ page }, info) => {
  await page.addInitScript(history => {
    const original = Storage.prototype.setItem;
    (window as unknown as { failHistory: boolean }).failHistory = true;
    Storage.prototype.setItem = function (key, value) {
      if (key === history && (window as unknown as { failHistory: boolean }).failHistory && this.getItem(key)) throw new DOMException('QA storage quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  }, HISTORY_KEY);
  await seed(page, game('pending-browser'), [record('saved-favorite', true)]);
  await expect(page.getByRole('alert')).toContainText('关闭页面可能丢失'); await openHistory(page);
  const before = await historyBytes(page); await expect(page.locator('.history-card')).toHaveCount(2);
  await expect(page.getByText('尚未写入浏览器存储')).toBeVisible();
  const exported = await exportBackup(page, '导出全部备份', info); expect(exported.records).toHaveLength(2); expect(await historyBytes(page)).toBe(before);
  await page.getByRole('button', { name: '取消收藏对局' }).click();
  await expect(page.getByRole('button', { name: '取消收藏对局' })).toHaveAttribute('aria-pressed', 'true'); expect(await historyBytes(page)).toBe(before);
  await page.evaluate(() => { (window as unknown as { failHistory: boolean }).failHistory = false; });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.getByText('尚未写入浏览器存储')).toHaveCount(0);
  expect((await records(page))).toHaveLength(2); expect((await records(page)).find(r => r.id === 'saved-favorite')?.favorite).toBe(true);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
