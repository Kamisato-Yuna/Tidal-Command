// @vitest-environment jsdom
/** Component regression coverage. SeaBoard is mocked: this does not prove canvas drag/raycast behavior. */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { applyVolley, createGame, randomFleet, serializeGame, type Ship } from '../src/core';
import App from '../src/App';
import { FleetRoster } from '../src/ui/FleetRoster';

type SceneHarnessProps = {
  ships: readonly Ship[];
  tentativeShip?: (Ship & { placement?: { row: number; col: number; orientation: 'horizontal' | 'vertical' } }) | null;
  tentativeValid?: boolean;
  latestVolleyCells?: readonly number[];
  onBoardBlur?: () => void;
  onShipMoveStart?: (id: string) => void;
  onShipMove?: (id: string, origin: { row: number; col: number }) => void;
  onShipMoveEnd?: () => void;
  selectedShipId?: string;
  draggingShipId?: string | null;
  onCellClick?: (cell: number) => void;
  onRotateShip?: () => void;
  onShipDrop?: (id: string, cell: number) => void;
  onShipDragHover?: (id: string, cell: number | null) => void;
};
const scene = vi.hoisted(() => ({ props: null as SceneHarnessProps | null }));
vi.mock('../src/audio/sound', () => ({ sound: { unlock: async () => {}, play: () => {}, configure: () => {}, setAmbient: () => {} } }));
vi.mock('../src/workers/client', () => ({ requestAI: () => () => {} }));
vi.mock('../src/scene/SeaBoard', () => ({
  SeaBoard: (props: SceneHarnessProps) => {
    scene.props = props;
    return <div data-testid="revision-scene" data-deployment-interaction data-selected-ship={props.selectedShipId}>
      {Array.from({ length: 100 }, (_, cell) => <button key={cell} aria-label={`测试海格 ${cell}`} onClick={() => props.onCellClick?.(cell)} />)}
      {props.onRotateShip && props.tentativeShip && <button aria-label="旋转已选舰船" onClick={props.onRotateShip} />}
      {props.onShipMove && props.tentativeShip && <button aria-label="移动已选舰船" />}
      {props.onBoardBlur && <button aria-label="测试海域背景" onClick={props.onBoardBlur} />}
    </div>;
  },
}));
afterEach(() => { cleanup(); localStorage.clear(); scene.props = null; vi.restoreAllMocks(); });
function setupDeployment() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: '开始游戏' }));
}
const clickCell = (cell: number) => fireEvent.click(screen.getByRole('button', { name: `测试海格 ${cell}` }));
const visibleFleet = () => [...scene.props!.ships, ...(scene.props!.tentativeShip ? [scene.props!.tentativeShip] : [])];
const cellsOf = (id: string) => visibleFleet().find(ship => ship.id === id)?.cells;
const fleetSnapshot = () => JSON.stringify(visibleFleet().map(({ id, cells }) => ({ id, cells })).sort((a, b) => a.id.localeCompare(b.id)));
const blurBoard = () => fireEvent.click(screen.getByRole('button', { name: '测试海域背景' }));
const choose = (name: string) => fireEvent.click(screen.getByRole('button', { name: new RegExp(name) }));

describe('tentative deployment controls with a mocked scene boundary', () => {
  it('places, rotates, selects by ship body and commits a valid click move', () => {
    setupDeployment(); clickCell(11);
    expect(cellsOf('carrier')).toEqual([11, 12, 13, 14, 15]);
    expect(scene.props!.selectedShipId).toBe('carrier');
    fireEvent.click(screen.getByRole('button', { name: '旋转已选舰船' }));
    expect(cellsOf('carrier')).toEqual([11, 21, 31, 41, 51]);
    fireEvent.keyDown(window, { key: 'r' }); clickCell(31);
    expect(cellsOf('carrier')).toEqual([31, 32, 33, 34, 35]);
    const before = fleetSnapshot(); clickCell(34);
    expect(fleetSnapshot()).toBe(before);
    blurBoard();
    expect(scene.props!.tentativeShip).toBe(null);
    expect(cellsOf('carrier')).toEqual([31, 32, 33, 34, 35]);
  });

  it('switches occupied ships without moving them or keeping the previous draft', () => {
    setupDeployment(); clickCell(11); choose('战列舰'); clickCell(71);
    const before = fleetSnapshot(); clickCell(13);
    expect(scene.props!.selectedShipId).toBe('carrier');
    expect(fleetSnapshot()).toBe(before);
    clickCell(74);
    expect(scene.props!.selectedShipId).toBe('battleship');
    expect(fleetSnapshot()).toBe(before);
  });

  it('keeps an out-of-bounds rotated model tentative until Escape restores the committed fleet', () => {
    setupDeployment(); clickCell(61);
    fireEvent.click(screen.getByRole('button', { name: '旋转已选舰船' }));
    expect(scene.props!.tentativeValid).toBe(false);
    expect(scene.props!.tentativeShip?.placement).toEqual({ row: 6, col: 1, orientation: 'vertical' });
    expect(scene.props!.selectedShipId).toBe('carrier');
    expect(screen.getByRole('status').textContent).toContain('红色舰船暂留');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(scene.props!.tentativeShip).toBe(null);
    expect(cellsOf('carrier')).toEqual([61, 62, 63, 64, 65]);
  });

  it('corrects an invalid draft with an empty-grid click instead of blurring it', () => {
    setupDeployment(); clickCell(61);
    fireEvent.keyDown(window, { key: 'r' });
    expect(scene.props!.tentativeValid).toBe(false);
    clickCell(14);
    expect(scene.props!.tentativeValid).toBe(true);
    expect(cellsOf('carrier')).toEqual([14, 24, 34, 44, 54]);
    expect(scene.props!.selectedShipId).toBe('carrier');
    blurBoard();
    expect(cellsOf('carrier')).toEqual([14, 24, 34, 44, 54]);
  });

  it('restores an invalid existing ship when selecting another ship', () => {
    setupDeployment(); clickCell(11); choose('战列舰'); clickCell(51); clickCell(11);
    fireEvent.keyDown(window, { key: 'R' });
    expect(scene.props!.tentativeValid).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('对角线');
    choose('战列舰');
    expect(cellsOf('carrier')).toEqual([11, 12, 13, 14, 15]);
    expect(scene.props!.selectedShipId).toBe('battleship');
    expect(scene.props!.tentativeValid).toBe(true);
  });

  it('removes a never-committed invalid ship on explicit finish, background click or focus blur', () => {
    setupDeployment(); clickCell(0);
    expect(scene.props!.tentativeValid).toBe(false);
    expect(scene.props!.tentativeShip?.id).toBe('carrier');
    expect(scene.props!.ships).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /结束舰船编辑/ }));
    expect(visibleFleet()).toHaveLength(0);
    choose('航空母舰'); clickCell(0); blurBoard();
    expect(visibleFleet()).toHaveLength(0);
    choose('航空母舰'); clickCell(0); fireEvent.focusIn(document.body);
    expect(visibleFleet()).toHaveLength(0);
  });

  it('preserves the draft for interactive board focus but restores it on a real outside pointerdown', () => {
    setupDeployment(); clickCell(11); clickCell(0);
    fireEvent.pointerDown(screen.getByTestId('revision-scene'));
    fireEvent.focusIn(screen.getByTestId('revision-scene'));
    expect(scene.props!.tentativeValid).toBe(false);
    fireEvent.pointerDown(document.body);
    expect(scene.props!.tentativeShip).toBe(null);
    expect(cellsOf('carrier')).toEqual([11, 12, 13, 14, 15]);
  });

  it('exports native fleet drag identity and keeps invalid drops tentative until blur', () => {
    setupDeployment();
    const transfer = { setData: vi.fn(), effectAllowed: '' };
    const carrier = screen.getByRole('button', { name: /航空母舰/ });
    fireEvent.dragStart(carrier, { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith('application/x-tidal-ship', 'carrier');
    expect(scene.props!.draggingShipId).toBe('carrier');
    act(() => scene.props!.onShipDrop?.('carrier', 11));
    expect(cellsOf('carrier')).toEqual([11, 12, 13, 14, 15]);
    expect(scene.props!.draggingShipId).toBe(null);
    act(() => scene.props!.onShipDrop?.('carrier', 99));
    expect(scene.props!.tentativeValid).toBe(false);
    fireEvent.dragEnd(carrier);
    expect(scene.props!.tentativeValid).toBe(false);
    blurBoard();
    expect(cellsOf('carrier')).toEqual([11, 12, 13, 14, 15]);
  });

  it('routes handle drag synchronously and retains an invalid release until blur', () => {
    setupDeployment(); clickCell(11);
    act(() => { scene.props!.onShipMoveStart?.('carrier'); scene.props!.onShipMove?.('carrier', { row: 3, col: 1 }); scene.props!.onShipMoveEnd?.(); });
    expect(cellsOf('carrier')).toEqual([31, 32, 33, 34, 35]);
    expect(scene.props!.draggingShipId).toBe(null);
    act(() => { scene.props!.onShipMoveStart?.('carrier'); scene.props!.onShipMove?.('carrier', { row: 8, col: 9 }); scene.props!.onShipMoveEnd?.(); });
    expect(scene.props!.tentativeValid).toBe(false);
    expect(scene.props!.tentativeShip?.placement).toEqual({ row: 8, col: 9, orientation: 'horizontal' });
    blurBoard();
    expect(cellsOf('carrier')).toEqual([31, 32, 33, 34, 35]);
  });

  it('blocks launch and save of an invalid draft even when five valid ships were committed', () => {
    setupDeployment();
    fireEvent.click(screen.getByRole('button', { name: '随机布阵' }));
    const committed = scene.props!.ships.map(ship => ({ ...ship, cells: [...ship.cells] }));
    choose('航空母舰');
    act(() => scene.props!.onShipMove?.('carrier', { row: 11, col: 11 }));
    const start = screen.getByRole('button', { name: '开始战斗' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.pointerDown(start); fireEvent.click(start);
    expect(scene.props!.tentativeValid).toBe(false);
    expect(localStorage.getItem('tidal-command:match:v1')).toBe(null);
    blurBoard();
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    const saved = JSON.parse(localStorage.getItem('tidal-command:match:v1')!);
    expect(saved.fleets.player).toEqual(committed);
  });

  it('keeps one perpendicular boundary contact valid and an along-edge rotation red until deselect', () => {
    setupDeployment(); fireEvent.keyDown(window, { key: 'r' }); clickCell(1);
    expect(cellsOf('carrier')).toEqual([1, 11, 21, 31, 41]);
    fireEvent.click(screen.getByRole('button', { name: '旋转已选舰船' }));
    expect(scene.props!.tentativeValid).toBe(false);
    expect(screen.getByRole('status').textContent).toContain('边界');
    blurBoard();
    expect(cellsOf('carrier')).toEqual([1, 11, 21, 31, 41]);
  });

  it('clear and random replace invalid drafts with clean legal setup state', () => {
    setupDeployment(); clickCell(0);
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(visibleFleet()).toHaveLength(0);
    expect(scene.props!.tentativeShip).toBe(null);
    clickCell(0);
    fireEvent.click(screen.getByRole('button', { name: '随机布阵' }));
    expect(scene.props!.tentativeShip).toBe(null);
    expect(scene.props!.ships).toHaveLength(5);
    expect(new Set(scene.props!.ships.flatMap(ship => ship.cells)).size).toBe(17);
  });
});

describe('expandable public fleet roster', () => {
  it('opens, switches sides and toggles closed with truthful public alive/sunk counts', () => {
    render(<FleetRoster ownSunkIds={['battleship']} enemySunkIds={['cruiser']} />);
    const own = screen.getByRole('button', { name: '我方舰队清单，4艘在航，1艘已沉没' });
    const enemy = screen.getByRole('button', { name: '敌方舰队清单，4艘在航，1艘已沉没' });
    expect(own.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(own);
    expect(own.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('region', { name: '我方舰队状态' })).toBeTruthy();
    fireEvent.click(enemy);
    expect(own.getAttribute('aria-expanded')).toBe('false');
    expect(enemy.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('region', { name: '我方舰队状态' })).toBe(null);
    const roster = within(screen.getByRole('region', { name: '敌方舰队状态' }));
    expect(roster.getAllByText('在航', { exact: true })).toHaveLength(4);
    expect(roster.getAllByText('已沉没', { exact: true })).toHaveLength(1);
    expect(roster.getByText('巡洋舰').closest('.roster-ship')?.textContent).toContain('已沉没');
    expect(roster.getByText('潜艇').closest('.roster-ship')?.textContent).toContain('在航');
    fireEvent.click(enemy);
    expect(screen.queryByRole('region', { name: '敌方舰队状态' })).toBe(null);
  });

  it('reveals only public specifications and sunk status, with no cell or partial-damage data', () => {
    const { rerender } = render(<FleetRoster ownSunkIds={[]} enemySunkIds={[]} />);
    fireEvent.click(screen.getByRole('button', { name: '敌方舰队清单，5艘在航，0艘已沉没' }));
    const region = screen.getByRole('region', { name: '敌方舰队状态' });
    const initial = region.innerHTML;
    expect(within(region).getAllByText('在航', { exact: true })).toHaveLength(5);
    expect(region.textContent).not.toMatch(/\b[A-J](?:10|[1-9])\b|剩余血量|已受损|命中.*格/);
    expect(region.querySelector('[data-cells],[data-health],[data-damage],[data-position]')).toBe(null);
    // Changes to friendly damage cannot alter enemy status or reveal a hidden enemy fact.
    rerender(<FleetRoster ownSunkIds={['carrier', 'destroyer']} enemySunkIds={[]} />);
    expect(screen.getByRole('region', { name: '敌方舰队状态' }).innerHTML).toBe(initial);
    rerender(<FleetRoster ownSunkIds={[]} enemySunkIds={['submarine']} />);
    const after = within(screen.getByRole('region', { name: '敌方舰队状态' }));
    expect(after.getByText('潜艇').closest('.roster-ship')?.textContent).toContain('已沉没');
    expect(after.getByText('巡洋舰').closest('.roster-ship')?.textContent).toContain('在航');
  });

  it('closes on Escape, its close button or an outside pointer action', () => {
    render(<FleetRoster ownSunkIds={[]} enemySunkIds={[]} />);
    const toggle = screen.getByRole('button', { name: '敌方舰队清单，5艘在航，0艘已沉没' });
    fireEvent.click(toggle);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: '收起舰队清单' }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
});

const saveKey = 'tidal-command:match:v1';
const savedGame = () => JSON.parse(localStorage.getItem(saveKey)!);
function setupBattle(shells = 1, instant = false) {
  localStorage.setItem('tidal-command:settings:v1', JSON.stringify({ shellsPerTurn: shells, noConfirm: instant, fast: true, muted: true, ambient: false }));
  setupDeployment();
  fireEvent.click(screen.getByRole('button', { name: '随机布阵' }));
  fireEvent.click(screen.getByRole('button', { name: '开始战斗' }));
}
describe('explicit single-shot and atomic salvo App controls', () => {
  it('defaults to one shell with confirmation and exposes all five round sizes', () => {
    render(<App />);
    const instant = screen.getByRole('checkbox', { name: '无需确认' }) as HTMLInputElement;
    expect(instant.checked).toBe(false);
    const sizes = screen.getByRole('combobox', { name: '每回合炮弹数量' }) as HTMLSelectElement;
    expect(sizes.value).toBe('1');
    expect(within(sizes).getAllByRole('option').map(option => (option as HTMLOptionElement).value)).toEqual(['1', '2', '3', '4', '5']);
    fireEvent.change(sizes, { target: { value: '3' } });
    expect(screen.queryByRole('checkbox', { name: '无需确认' })).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: '开始游戏' }));
    fireEvent.click(screen.getByRole('button', { name: '随机布阵' }));
    fireEvent.click(screen.getByRole('button', { name: '开始战斗' }));
    expect(savedGame().rules).toEqual({ shellsPerTurn: 3, placement: 'classic' });
  });

  it('toggles the same single target off and commits only after explicit confirmation', () => {
    setupBattle();
    const fire = screen.getByRole('button', { name: /开火/ }) as HTMLButtonElement;
    clickCell(44);
    expect(savedGame().events).toHaveLength(0);
    expect(fire.disabled).toBe(false);
    clickCell(44);
    expect(fire.disabled).toBe(true);
    expect(savedGame().events).toHaveLength(0);
    clickCell(45);
    fireEvent.click(fire);
    expect(savedGame().shots.player).toEqual([45]);
    expect(savedGame().volleys).toEqual([{ attacker: 'player', coords: [45] }]);
    fireEvent.keyDown(window, { key: 'Enter' });
    clickCell(46);
    expect(savedGame().events).toHaveLength(1);
  });

  it('fires immediately only after the opt-in checkbox and guards duplicate clicks', () => {
    setupBattle();
    fireEvent.click(screen.getByRole('checkbox', { name: '无需确认' }));
    clickCell(44);
    clickCell(45);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(savedGame().shots.player).toEqual([44]);
    expect(savedGame().events).toHaveLength(1);
    expect(savedGame().turn).toBe('ai');
  });

  it('toggles multi-targets, enforces the exact quota and commits one complete plan', () => {
    setupBattle(3, true);
    expect(screen.queryByRole('checkbox', { name: '无需确认' })).toBe(null);
    const fire = screen.getByRole('button', { name: /齐射 3 发/ }) as HTMLButtonElement;
    clickCell(11); clickCell(22); clickCell(33);
    expect(savedGame().events).toHaveLength(0);
    expect(fire.disabled).toBe(false);
    clickCell(33);
    expect(fire.disabled).toBe(true);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(savedGame().events).toHaveLength(0);
    clickCell(44); clickCell(55); // A fourth target must not replace the locked three.
    fireEvent.click(fire);
    expect(savedGame().shots.player).toEqual([11, 22, 44]);
    expect(savedGame().volleys).toEqual([{ attacker: 'player', coords: [11, 22, 44] }]);
    expect(savedGame().events).toHaveLength(3);
    fireEvent.click(fire);
    expect(savedGame().events).toHaveLength(3);
  });

  it('uses arrows for focus, Space for multi-selection and Enter for the volley', () => {
    setupBattle(2);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: ' ' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: ' ' });
    expect(savedGame().events).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(savedGame().shots.player).toEqual([45, 55]);
    expect(savedGame().volleys).toHaveLength(1);
  });
});

describe('public previous-round markers in both fleet views', () => {
  function roundSave(includeNextPlayer = false) {
    let game = createGame(randomFleet(31), 'easy', { enemyFleet: randomFleet(32), shellsPerTurn: 3, matchId: 'markers-ui' });
    game = applyVolley(game, 'player', [0, 2, 4]).state;
    game = applyVolley(game, 'ai', [90, 92, 94]).state;
    if (includeNextPlayer) game = applyVolley(game, 'player', [1, 3, 5]).state;
    localStorage.setItem('tidal-command:match:v1', serializeGame(game));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /继续上次作战/ }));
    return game;
  }
  it('passes separate full-salvo markers to enemy, own and miniature boards after reload', () => {
    roundSave();
    expect(scene.props!.latestVolleyCells).toEqual([0, 2, 4]);
    expect(scene.props!.ships).toHaveLength(0);
    expect(document.querySelectorAll('.tactical-cell.recent-shot')).toHaveLength(3);
    expect(screen.getByText(/方框标记第 1 回合炮击/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '我方海域' }));
    expect(scene.props!.latestVolleyCells).toEqual([90, 92, 94]);
    expect(scene.props!.ships).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /敌方海域/ }));
    expect(scene.props!.latestVolleyCells).toEqual([0, 2, 4]);
  });
  it('retains the completed round while an AI response to the next player salvo is pending', () => {
    roundSave(true);
    expect(scene.props!.latestVolleyCells).toEqual([0, 2, 4]);
    expect(scene.props!.latestVolleyCells).not.toEqual([1, 3, 5]);
    fireEvent.click(screen.getByRole('button', { name: '我方海域' }));
    expect(scene.props!.latestVolleyCells).toEqual([90, 92, 94]);
  });
});
