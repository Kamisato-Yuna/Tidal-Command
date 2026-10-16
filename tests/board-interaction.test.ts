import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { boardCellAt, isShipDrag, projectBoardCell, SHIP_DRAG_TYPE, shipDragId } from '../src/scene/boardInteraction';

const bounds = { left: 173, top: 92, width: 960, height: 640 };
function makeCamera(position: [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(39, bounds.width / bounds.height, .1, 100);
  camera.position.set(...position);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}
function screenPoint(camera: THREE.Camera, x: number, z: number) {
  const projected = new THREE.Vector3(x, .025, z).project(camera);
  return { x: bounds.left + (projected.x + 1) / 2 * bounds.width, y: bounds.top + (1 - projected.y) / 2 * bounds.height };
}

describe('board drag projection', () => {
  it('maps stable board boundaries without wrapping or clamping off-board drops', () => {
    expect(boardCellAt(-5, -5)).toBe(0);
    expect(boardCellAt(4.999, 4.999)).toBe(99);
    expect(boardCellAt(-4.5, 4.5)).toBe(90);
    expect(boardCellAt(5, 0)).toBeNull();
    expect(boardCellAt(0, 5)).toBeNull();
    expect(boardCellAt(-5.001, 0)).toBeNull();
    expect(boardCellAt(0, -5.001)).toBeNull();
    expect(boardCellAt(NaN, 0)).toBeNull();
  });
  it.each<[number, number, number]>([[10, 13, 14], [-4, 18, 14], [16, 13, 0], [6, 18, 16]])('projects every cell correctly after a camera orbit (%s, %s, %s)', (x, y, z) => {
    const camera = makeCamera([x, y, z]);
    for (let cell = 0; cell < 100; cell++) {
      const point = screenPoint(camera, cell % 10 - 4.5, Math.floor(cell / 10) - 4.5);
      expect(projectBoardCell(camera, bounds, point.x, point.y)).toBe(cell);
    }
  });
  it('rejects points outside the canvas or board and unmeasurable canvases', () => {
    const camera = makeCamera([10, 13, 14]);
    const outside = screenPoint(camera, -5.5, 0);
    expect(projectBoardCell(camera, bounds, outside.x, outside.y)).toBeNull();
    expect(projectBoardCell(camera, bounds, bounds.left - 1, bounds.top)).toBeNull();
    expect(projectBoardCell(camera, { ...bounds, width: 0 }, 200, 200)).toBeNull();
    expect(projectBoardCell(camera, bounds, NaN, 200)).toBeNull();
  });
  it('requires the ship MIME type and supports protected dragover data', () => {
    const readable = { types: [SHIP_DRAG_TYPE, 'text/plain'], getData: (type: string) => type === SHIP_DRAG_TYPE ? 'carrier' : '' };
    const protectedData = { types: [SHIP_DRAG_TYPE, 'text/plain'], getData: () => '' };
    const otherData = { types: ['text/plain'], getData: () => 'carrier' };
    expect(isShipDrag(readable)).toBe(true);
    expect(shipDragId(readable)).toBe('carrier');
    expect(shipDragId(protectedData, 'cruiser')).toBe('cruiser');
    expect(shipDragId(protectedData)).toBeNull();
    expect(shipDragId(otherData, 'carrier')).toBeNull();
    expect(isShipDrag(null)).toBe(false);
  });
});
