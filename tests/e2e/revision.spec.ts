import { test, expect, type Page } from '@playwright/test';
import { PerspectiveCamera, Vector3 } from 'three';
import { DEFAULT_CAMERA_POSITION } from '../../src/scene/boardInteraction';
const saveKey = 'tidal-command:match:v1';
const read = (page: Page) => page.evaluate(k => JSON.parse(localStorage.getItem(k)!), saveKey);
async function boot(page: Page, shells = 1, normal = false) {
  await page.addInitScript(() => { if (!localStorage.getItem('tidal-command:settings:v1')) localStorage.setItem('tidal-command:settings:v1', JSON.stringify({ fast: true, muted: true, quality: 'medium', reducedMotion: true, ambient: false, guide: true })); });
  await page.goto('./');
  await page.getByRole('combobox', { name: '每回合炮弹数量' }).selectOption(String(shells));
  if (normal) await page.getByRole('button', { name: /普通 高强度/ }).click();
  await page.getByRole('button', { name: '开始游戏', exact: true }).click();
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(700);
}
// Project only visible board coordinates from the documented default camera;
// these helpers do not inspect hidden game state or invoke React handlers.
async function point(page: Page, cell: number) {
  const box = (await page.locator('canvas').boundingBox())!;
  const camera = new PerspectiveCamera(39, box.width / box.height, .1, 100);
  camera.position.set(...DEFAULT_CAMERA_POSITION); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const v = new Vector3(cell % 10 - 4.5, .025, Math.floor(cell / 10) - 4.5).project(camera);
  return { x: box.x + (v.x + 1) * box.width / 2, y: box.y + (1 - v.y) * box.height / 2 };
}
async function clickCell(page: Page, cell: number) { const p = await point(page, cell); await page.mouse.click(p.x, p.y); }
async function battle(page: Page) {
  await page.getByRole('button', { name: '随机布阵', exact: true }).click();
  await page.getByRole('button', { name: '开始战斗', exact: true }).click();
  await page.getByRole('heading', { name: '指挥官，选择你的目标。' }).waitFor();
  await page.waitForTimeout(500);
}
async function ready(page: Page, events: number) {
  await expect.poll(async () => (await read(page)).events.length, { timeout: 25000 }).toBe(events);
  await expect(page.getByRole('heading', { name: '指挥官，选择你的目标。' })).toBeVisible();
}

test('real pointer drag, placed-ship selection, board rotation, classic rejection and upright orbit axes', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page);
  const ship = page.locator('.ship-choice').first();
  const from = (await ship.boundingBox())!; const to = await point(page, 11);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down(); await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 15 }); await page.mouse.move(to.x + 1, to.y + 1); await page.mouse.up();
  await expect(page.locator('.fleet-panel .panel-title')).toContainText('1 / 5');
  await page.getByRole('button', { name: '旋转已选舰船', exact: true }).click(); await page.waitForTimeout(150);
  await expect(page.getByRole('status')).toContainText('舰船保持选中');
  await clickCell(page, 14); await page.waitForTimeout(150);
  await page.getByRole('button', { name: '旋转已选舰船', exact: true }).click(); await page.waitForTimeout(150);
  await clickCell(page, 16); await page.waitForTimeout(150); await clickCell(page, 11); await page.waitForTimeout(150);
  await clickCell(page, 0);
  await expect(page.getByRole('status')).toContainText('边界');
  await expect(page.getByRole('status')).toContainText('红色舰船暂留');
  await page.locator('.ship-choice').nth(1).click(); await clickCell(page, 26);
  await expect(page.getByRole('status')).toContainText('对角线');
  await page.screenshot({ path: 'screenshots/revision-e2e-rule-rejection.png', fullPage: true });
  for (const [index, cell] of [[1, 31], [2, 51], [3, 71], [4, 77]]) {
    await page.locator('.ship-choice').nth(index).click(); await clickCell(page, cell);
  }
  await expect(page.locator('.fleet-panel .panel-title')).toContainText('5 / 5');
  await page.screenshot({ path: 'screenshots/revision-e2e-placement.png', fullPage: true });
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width * .7, box.y + box.height * .5); await page.mouse.down();
  await page.mouse.move(box.x + box.width * .45, box.y + box.height * .4, { steps: 25 }); await page.mouse.up(); await page.waitForTimeout(500);
  await expect(page.locator('.fleet-panel .panel-title')).toContainText('5 / 5');
  await page.screenshot({ path: 'screenshots/revision-e2e-orbit-axes.png', fullPage: true });
  await page.getByRole('button', { name: '开始战斗', exact: true }).click();
  expect((await read(page)).fleets.player.map((s: any) => s.cells)).toEqual([[11, 12, 13, 14, 15], [31, 32, 33, 34], [51, 52, 53], [71, 72, 73], [77, 78]]);
  expect(errors).toEqual([]);
});

test('single confirmation toggle and opt-in instant fire survive refresh without duplicate shots', async ({ page }) => {
  await boot(page); await battle(page);
  await expect(page.getByRole('checkbox', { name: '无需确认' })).not.toBeChecked();
  await clickCell(page, 44); await expect(page.getByRole('button', { name: /^开火/ })).toBeEnabled();
  await clickCell(page, 44); await expect(page.getByRole('button', { name: /^开火/ })).toBeDisabled();
  expect((await read(page)).events).toHaveLength(0);
  await page.getByRole('checkbox', { name: '无需确认' }).check();
  await clickCell(page, 45); await clickCell(page, 46); await ready(page, 2);
  expect((await read(page)).shots.player).toEqual([45]);
  await clickCell(page, 45); expect((await read(page)).events).toHaveLength(2);
  await page.reload(); await page.getByRole('button', { name: /继续上次作战/ }).click();
  await expect(page.getByRole('checkbox', { name: '无需确认' })).toBeChecked();
  await page.getByRole('checkbox', { name: '无需确认' }).uncheck();
  await page.waitForTimeout(500); await clickCell(page, 46); await page.keyboard.press('Enter'); await ready(page, 4);
  expect((await read(page)).shots.player).toEqual([45, 46]);
});

test('normal three-shell plan toggles, atomically resumes, and shows private-safe responsive rosters', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await boot(page, 3, true); await battle(page);
  expect((await read(page)).rules).toEqual({ shellsPerTurn: 3, placement: 'classic' });
  await expect(page.getByRole('checkbox', { name: '无需确认' })).toHaveCount(0);
  await clickCell(page, 11); await clickCell(page, 22); await clickCell(page, 33); await clickCell(page, 33);
  await expect(page.getByRole('button', { name: /齐射 3 发/ })).toBeDisabled();
  await clickCell(page, 44); await clickCell(page, 55);
  await expect(page.locator('.target-readout strong')).toHaveText('3 / 3');
  await page.getByRole('button', { name: '敌方舰队清单，5艘在航，0艘已沉没' }).click();
  const roster = page.getByRole('region', { name: '敌方舰队状态' });
  await expect(roster).toBeVisible();
  expect(await roster.innerText()).not.toMatch(/\b[A-J](?:10|[1-9])\b|剩余血量|已受损/);
  await page.screenshot({ path: 'screenshots/revision-e2e-salvo-roster.png', fullPage: true });
  await page.getByRole('button', { name: '收起舰队清单' }).click();
  await page.getByRole('button', { name: /齐射 3 发/ }).click();
  expect((await read(page)).shots.player).toEqual([11, 22, 44]);
  await page.reload(); await page.getByRole('button', { name: /继续上次作战/ }).click(); await ready(page, 6);
  const state = await read(page);
  expect(state.volleys).toHaveLength(2); expect(state.shots.ai).toHaveLength(3); expect(new Set(state.shots.ai).size).toBe(3);
  expect(state.events[3].aiDiagnostics.strategy).toBe('normal');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: /敌方舰队清单/ }).click();
  await expect(page.getByRole('region', { name: '敌方舰队状态' })).toBeVisible();
  const fire = (await page.getByRole('button', { name: /齐射 3 发/ }).boundingBox())!;
  expect(fire.x).toBeGreaterThanOrEqual(0); expect(fire.x + fire.width).toBeLessThanOrEqual(390); expect(fire.y + fire.height).toBeLessThanOrEqual(844);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'screenshots/revision-e2e-mobile-roster.png', fullPage: true });
  expect(errors).toEqual([]);
});
