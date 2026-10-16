import * as THREE from 'three';

export const SHIP_DRAG_TYPE = 'application/x-tidal-ship';
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.025);

export interface BoardOrigin { row: number; col: number }
export interface ShipPlacement extends BoardOrigin { orientation: 'horizontal' | 'vertical' }
export interface PositionedShip { length: number; cells: readonly number[]; placement?: ShipPlacement }
export type AxisEdge = -1 | 1;
export interface AxisEdges { letters: AxisEdge; numbers: AxisEdge }
export const DEFAULT_CAMERA_POSITION: [number, number, number] = [-10, 13, -14];
export const DEFAULT_AXIS_EDGES: AxisEdges = { letters: -1, numbers: -1 };

/** Html controls can commit later than the main UI; never let an old ship intercept input. */
export function shipControlsAreCurrent(shipId: string, input: { selectedShipId?: string; interactive?: boolean }): boolean {
  return input.interactive !== false && input.selectedShipId === shipId;
}

/** Read committed callbacks at click time, since the canvas React root may render later. */
export function dispatchShipSelection(
  event: { delta: number; stopPropagation: () => void },
  shipId: string,
  input: { current: { interactive?: boolean; onShipSelect?: (id: string) => void } },
  gesture: { current: { moved: boolean; moving: boolean } },
): void {
  // A physical hull click must never continue through to a sea-plane placement.
  event.stopPropagation();
  const current = input.current;
  if (current.interactive === false || gesture.current.moved || gesture.current.moving || event.delta > 5) return;
  current.onShipSelect?.(shipId);
}

/** An explicit origin is essential for invalid ships extending past a row boundary. */
export function shipPlacement(ship: PositionedShip): ShipPlacement {
  if (ship.placement) return ship.placement;
  const first = ship.cells[0] ?? 0;
  return { row: Math.floor(first / 10), col: first % 10, orientation: ship.cells.length > 1 && ship.cells[1] - first === 10 ? 'vertical' : 'horizontal' };
}

/** Never derive invalid draft geometry by decoding row * 10 + col. It can wrap. */
export function shipBoardPositions(ship: PositionedShip): BoardOrigin[] {
  const origin = shipPlacement(ship);
  return Array.from({ length: ship.length }, (_, index) => ({
    row: origin.row + (origin.orientation === 'vertical' ? index : 0),
    col: origin.col + (origin.orientation === 'horizontal' ? index : 0),
  }));
}

export function shipWorldPose(ship: PositionedShip): { x: number; z: number; vertical: boolean } {
  const origin = shipPlacement(ship), vertical = origin.orientation === 'vertical';
  return { x: origin.col - 4.5 + (vertical ? 0 : (ship.length - 1) / 2), z: origin.row - 4.5 + (vertical ? (ship.length - 1) / 2 : 0), vertical };
}

/** Match Drei Html's canvas-local transform without waiting for its next animation frame. */
export function projectShipControlAnchor(ship: PositionedShip, camera: THREE.Camera, size: { width: number; height: number }): [number, number] {
  const { x, z } = shipWorldPose(ship);
  camera.updateMatrixWorld();
  const projected = new THREE.Vector3(x, 1.6, z).project(camera);
  return [(projected.x + 1) * size.width / 2, (1 - projected.y) * size.height / 2];
}

/** Snap a handle drag relative to its grab point, preserving the ship's original anchor. */
export function movedShipOrigin(origin: BoardOrigin, start: { x: number; z: number }, current: { x: number; z: number }): BoardOrigin {
  return { row: origin.row + Math.round(current.z - start.z), col: origin.col + Math.round(current.x - start.x) };
}

/** Keep labels on camera-near logical edges, with a dead zone around each side crossing. */
export function cameraAxisEdges(x: number, z: number, previous: AxisEdges = DEFAULT_AXIS_EDGES): AxisEdges {
  const distance = Math.hypot(x, z);
  if (!Number.isFinite(distance) || distance < .001) return previous;
  const edge = (component: number, old: AxisEdge): AxisEdge => component / distance > .22 ? 1 : component / distance < -.22 ? -1 : old;
  return { letters: edge(z, previous.letters), numbers: edge(x, previous.numbers) };
}

export function axisLabelPosition(axis: 'letters' | 'numbers', index: number, edges: AxisEdges): [number, number, number] {
  return axis === 'letters' ? [index - 4.5, .17, edges.letters * 5.48] : [edges.numbers * 5.48, .17, index - 4.5];
}

/** Use a stable plane rather than the animated ocean or the ship geometry. */
export function boardCellAt(x: number, z: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(z) || x < -5 || x >= 5 || z < -5 || z >= 5) return null;
  return Math.floor(z + 5) * 10 + Math.floor(x + 5);
}

export function projectBoardCell(
  camera: THREE.Camera,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
): number | null {
  const intersection = projectBoardPoint(camera, bounds, clientX, clientY);
  return intersection ? boardCellAt(intersection.x, intersection.z) : null;
}

/** Project to the infinite board plane; drafts may remain visibly outside the legal grid. */
export function projectBoardPoint(
  camera: THREE.Camera,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
): { x: number; z: number } | null {
  const raycaster = boardRay(camera, bounds, clientX, clientY);
  if (!raycaster) return null;
  const intersection = raycaster.ray.intersectPlane(boardPlane, new THREE.Vector3());
  return intersection ? { x: intersection.x, z: intersection.z } : null;
}

function boardRay(
  camera: THREE.Camera,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
): THREE.Raycaster | null {
  if (bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const x = (clientX - bounds.left) / bounds.width;
  const y = (clientY - bounds.top) / bounds.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const raycaster = new THREE.Raycaster();
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
  return raycaster;
}

/** A raised, offboard hull is still the active ship, rather than empty sea to blur. */
export function rayHitsShip(
  scene: THREE.Scene,
  camera: THREE.Camera,
  bounds: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number,
  shipId: string,
): boolean {
  const raycaster = boardRay(camera, bounds, clientX, clientY);
  if (!raycaster) return false;
  scene.updateMatrixWorld(true);
  const shipRoots: THREE.Object3D[] = [];
  scene.traverseVisible(object => { if (object.userData.shipId === shipId) shipRoots.push(object); });
  return shipRoots.some(root => raycaster.intersectObject(root, true).length > 0);
}

export function isShipDrag(data: Pick<DataTransfer, 'types'> | null): boolean {
  return !!data && Array.from(data.types).includes(SHIP_DRAG_TYPE);
}

export function shipDragId(data: Pick<DataTransfer, 'types' | 'getData'> | null, fallback: string | null = null): string | null {
  if (!isShipDrag(data)) return null;
  // Dragover data is protected in browsers; capture the ID during dragstart.
  const id = data!.getData(SHIP_DRAG_TYPE).trim();
  return id || fallback;
}
