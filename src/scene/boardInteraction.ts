import * as THREE from 'three';

export const SHIP_DRAG_TYPE = 'application/x-tidal-ship';
const boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.025);

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
  if (bounds.width <= 0 || bounds.height <= 0 || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const x = (clientX - bounds.left) / bounds.width;
  const y = (clientY - bounds.top) / bounds.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  const raycaster = new THREE.Raycaster();
  camera.updateMatrixWorld();
  raycaster.setFromCamera(new THREE.Vector2(x * 2 - 1, 1 - y * 2), camera);
  const intersection = raycaster.ray.intersectPlane(boardPlane, new THREE.Vector3());
  return intersection ? boardCellAt(intersection.x, intersection.z) : null;
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
