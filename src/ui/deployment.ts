import { FLEET_SPECS, placementCells, validateFleet, type Ship, type Orientation } from '../core';

export interface PlacementPose { row: number; col: number; orientation: Orientation }
export interface DeploymentDraft extends Ship { placement: PlacementPose; valid: boolean; error: string }
export interface DeploymentState { fleet: Ship[]; selectedShipId: string | null; orientation: Orientation; draft: DeploymentDraft | null; notice: string }
export function initialDeployment(fleet: Ship[] = []): DeploymentState { return { fleet, selectedShipId: fleet.length ? null : 'carrier', orientation: 'horizontal', draft: null, notice: '' }; }
function committed(draft: DeploymentDraft): Ship { return { id: draft.id, name: draft.name, length: draft.length, cells: [...draft.cells] }; }
function commitDraft(state: DeploymentState): DeploymentState {
  if (!state.draft?.valid) return state;
  return { ...state, fleet: [...state.fleet.filter(s => s.id !== state.draft!.id), committed(state.draft)] };
}
export function deactivateDeployment(state: DeploymentState): DeploymentState {
  const next = commitDraft(state), invalid = state.draft && !state.draft.valid;
  return { ...next, selectedShipId: null, draft: null, notice: invalid ? (state.fleet.some(s => s.id === state.draft!.id) ? '已退出编辑，恢复上一个合法舰位。' : '已退出编辑，移除未完成的舰船。') : '' };
}
export function selectDeploymentShip(state: DeploymentState, id: string): DeploymentState {
  if (!FLEET_SPECS.some(s => s.id === id)) return state;
  if (state.selectedShipId === id) return state;
  const next = deactivateDeployment(state), ship = next.fleet.find(s => s.id === id);
  const orientation = ship ? (ship.cells[1] - ship.cells[0] === 10 ? 'vertical' : 'horizontal') : state.orientation;
  return { ...next, selectedShipId: id, orientation, notice: '', draft: ship ? { ...ship, cells: [...ship.cells], placement: { row: Math.floor(ship.cells[0] / 10), col: ship.cells[0] % 10, orientation }, valid: true, error: '' } : null };
}
/** Candidates may be out of bounds. Only a valid released/clicked pose reaches the committed fleet. */
export function moveDeploymentShip(state: DeploymentState, id: string, pose: PlacementPose, commitValid = true): DeploymentState {
  const spec = FLEET_SPECS.find(s => s.id === id); if (!spec) return state;
  const next = state.selectedShipId === id ? state : selectDeploymentShip(state, id);
  const inBounds = Number.isInteger(pose.row) && Number.isInteger(pose.col) && pose.row >= 0 && pose.row < 10 && pose.col >= 0 && pose.col < 10;
  const cells = inBounds ? placementCells(pose.row * 10 + pose.col, spec.length, pose.orientation) : [];
  const check = validateFleet([...next.fleet.filter(s => s.id !== id), { ...spec, cells }], false);
  const draft: DeploymentDraft = { ...spec, cells, placement: { ...pose }, valid: check.valid, error: check.errors[0] || '' };
  const result = { ...next, selectedShipId: id, orientation: pose.orientation, draft, notice: draft.valid ? '舰船保持选中：点击旋转图标、拖动移动图标，或点击空海格移动。' : `${draft.error}。红色舰船暂留此处；退出编辑时恢复或移除。` };
  return commitValid ? commitDraft(result) : result;
}
export function finishDeploymentMove(state: DeploymentState): DeploymentState { return commitDraft(state); }
export function rotateDeploymentShip(state: DeploymentState): DeploymentState {
  if (!state.selectedShipId) return state;
  const orientation = state.orientation === 'horizontal' ? 'vertical' : 'horizontal';
  const ship = state.fleet.find(s => s.id === state.selectedShipId);
  const origin = state.draft?.placement ?? (ship ? { row: Math.floor(ship.cells[0] / 10), col: ship.cells[0] % 10 } : null);
  return origin ? moveDeploymentShip(state, state.selectedShipId, { ...origin, orientation }) : { ...state, orientation };
}
export function clickDeploymentCell(state: DeploymentState, cell: number): DeploymentState {
  // The committed location of an invalid active draft is not displayed and must not intercept clicks.
  const placed = state.fleet.find(s => s.id !== state.draft?.id && s.cells.includes(cell));
  if (placed) return selectDeploymentShip(state, placed.id);
  if (state.draft?.cells.includes(cell)) return state;
  return state.selectedShipId ? moveDeploymentShip(state, state.selectedShipId, { row: Math.floor(cell / 10), col: cell % 10, orientation: state.orientation }) : state;
}
