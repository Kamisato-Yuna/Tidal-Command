import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  axisLabelPosition, boardCellAt, cameraAxisEdges, DEFAULT_AXIS_EDGES, dispatchShipSelection,
  DEFAULT_CAMERA_POSITION, movedShipOrigin, projectBoardCell, projectBoardPoint, projectShipControlAnchor, rayHitsShip,
  shipBoardPositions, shipControlsAreCurrent, shipPlacement, shipWorldPose, type PositionedShip,
} from '../src/scene/boardInteraction';

describe('physical ship click dispatch', () => {
  it('disables stale Html controls immediately when the main UI selects a different ship', () => {
    expect(shipControlsAreCurrent('carrier', { selectedShipId: 'carrier' })).toBe(true);
    expect(shipControlsAreCurrent('carrier', { selectedShipId: 'destroyer' })).toBe(false);
    expect(shipControlsAreCurrent('carrier', {})).toBe(false);
    expect(shipControlsAreCurrent('carrier', { selectedShipId: 'carrier', interactive: false })).toBe(false);
    expect(shipControlsAreCurrent('destroyer', { selectedShipId: 'destroyer', interactive: true })).toBe(true);
  });
  it('selects once through the latest committed callback and stops the sea-plane click', () => {
    const oldCallback = vi.fn(), currentCallback = vi.fn(), event = { delta: 0, stopPropagation: vi.fn() };
    const input = { current: { interactive: true, onShipSelect: oldCallback } };
    const gesture = { current: { moved: false, moving: false } };
    input.current = { interactive: true, onShipSelect: currentCallback };
    dispatchShipSelection(event, 'carrier', input, gesture);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(oldCallback).not.toHaveBeenCalled();
    expect(currentCallback).toHaveBeenCalledExactlyOnceWith('carrier');
  });
  it.each([
    { interactive: false, moved: false, moving: false, delta: 0 },
    { interactive: true, moved: true, moving: false, delta: 0 },
    { interactive: true, moved: false, moving: true, delta: 0 },
    { interactive: true, moved: false, moving: false, delta: 6 },
  ])('never selects or propagates after an orbit, move, or disabled input: %j', state => {
    const onShipSelect = vi.fn(), stopPropagation = vi.fn();
    dispatchShipSelection({ delta: state.delta, stopPropagation }, 'carrier', { current: { interactive: state.interactive, onShipSelect } }, { current: state });
    expect(onShipSelect).not.toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });
});

describe('tentative scene geometry', () => {
  it('keeps a right-edge horizontal draft straight instead of wrapping to the next row', () => {
    const ship: PositionedShip = { length: 5, cells: [28, 29, 30, 31, 32], placement: { row: 2, col: 8, orientation: 'horizontal' } };
    expect(shipBoardPositions(ship)).toEqual([8, 9, 10, 11, 12].map(col => ({ row: 2, col })));
    expect(shipWorldPose(ship)).toEqual({ x: 5.5, z: -2.5, vertical: false });
  });

  it('keeps negative and below-board origins explicit rather than decoding them as cell IDs', () => {
    const negative: PositionedShip = { length: 3, cells: [], placement: { row: 4, col: -2, orientation: 'horizontal' } };
    expect(shipBoardPositions(negative)).toEqual([{ row: 4, col: -2 }, { row: 4, col: -1 }, { row: 4, col: 0 }]);
    expect(shipWorldPose(negative)).toEqual({ x: -5.5, z: -.5, vertical: false });
    const below: PositionedShip = { length: 4, cells: [], placement: { row: 8, col: 3, orientation: 'vertical' } };
    expect(shipBoardPositions(below)).toEqual([8, 9, 10, 11].map(row => ({ row, col: 3 })));
    expect(shipWorldPose(below)).toEqual({ x: -1.5, z: 5, vertical: true });
  });

  it('preserves existing committed-fleet placement and camera-independent coordinate decoding', () => {
    expect(shipPlacement({ length: 3, cells: [21, 31, 41] })).toEqual({ row: 2, col: 1, orientation: 'vertical' });
    expect(shipWorldPose({ length: 3, cells: [21, 31, 41] })).toEqual({ x: -3.5, z: -1.5, vertical: true });
    expect(shipWorldPose({ length: 2, cells: [53, 54] })).toEqual({ x: -1, z: .5, vertical: false });
  });

  it('moves relative to the grabbed handle without jumping the ship to that handle', () => {
    const origin = { row: 2, col: 1 }, start = { x: -.8, z: -4.1 };
    expect(movedShipOrigin(origin, start, start)).toEqual(origin);
    expect(movedShipOrigin(origin, start, { x: -.4, z: -3.7 })).toEqual(origin);
    expect(movedShipOrigin(origin, start, { x: 1.4, z: -1.3 })).toEqual({ row: 5, col: 3 });
    expect(movedShipOrigin(origin, start, { x: -4.8, z: -7.1 })).toEqual({ row: -1, col: -3 });
    expect(origin).toEqual({ row: 2, col: 1 });
  });
});

describe('logical axes through unrestricted orbit', () => {
  it('places A and 1 at the same logical origin corner in the default view', () => {
    expect(DEFAULT_CAMERA_POSITION).toEqual([-10, 13, -14]);
    expect(cameraAxisEdges(DEFAULT_CAMERA_POSITION[0], DEFAULT_CAMERA_POSITION[2])).toEqual(DEFAULT_AXIS_EDGES);
    expect(axisLabelPosition('letters', 0, DEFAULT_AXIS_EDGES)).toEqual([-4.5, .17, -5.48]);
    expect(axisLabelPosition('numbers', 0, DEFAULT_AXIS_EDGES)).toEqual([-5.48, .17, -4.5]);
    expect(boardCellAt(-4.5, -4.5)).toBe(0);
  });

  it.each([-1, 1])('anchors both axes to logical indices on edge %s without reversing them', sign => {
    const edges = cameraAxisEdges(sign * 10, sign * 14);
    for (let index = 0; index < 10; index++) {
      expect(axisLabelPosition('letters', index, edges)).toEqual([index - 4.5, .17, sign * 5.48]);
      expect(axisLabelPosition('numbers', index, edges)).toEqual([sign * 5.48, .17, index - 4.5]);
    }
  });

  it('switches near edges only beyond the hysteresis band', () => {
    let edges = DEFAULT_AXIS_EDGES;
    for (const x of [-1, .1, -.2, 1, 2]) {
      edges = cameraAxisEdges(x, -12, edges);
      expect(edges.numbers).toBe(-1);
    }
    edges = cameraAxisEdges(4, -12, edges);
    expect(edges).toEqual({ letters: -1, numbers: 1 });
    for (const x of [2, -.1, 1, -2]) {
      edges = cameraAxisEdges(x, -12, edges);
      expect(edges.numbers).toBe(1);
    }
    expect(cameraAxisEdges(-4, -12, edges).numbers).toBe(-1);
    expect(cameraAxisEdges(NaN, 12, edges)).toBe(edges);
    expect(cameraAxisEdges(0, 0, edges)).toBe(edges);
  });
});

describe('board projections across all camera quadrants', () => {
  const bounds = { left: 100, top: 60, width: 1100, height: 800 };
  const cameraAt = (position: [number, number, number]) => {
    const camera = new THREE.PerspectiveCamera(39, bounds.width / bounds.height, .1, 100);
    camera.position.set(...position); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    return camera;
  };
  const screen = (camera: THREE.Camera, x: number, z: number) => {
    const p = new THREE.Vector3(x, .025, z).project(camera);
    return { x: bounds.left + (p.x + 1) / 2 * bounds.width, y: bounds.top + (1 - p.y) / 2 * bounds.height };
  };
  it('projects current same-ship move and rotation anchors immediately rather than reusing an old Html transform', () => {
    const camera = cameraAt(DEFAULT_CAMERA_POSITION);
    const oldShip: PositionedShip = { length: 5, cells: [], placement: { row: 1, col: 1, orientation: 'horizontal' } };
    const movedShip: PositionedShip = { ...oldShip, placement: { row: 7, col: 1, orientation: 'horizontal' } };
    const rotatedShip: PositionedShip = { ...oldShip, placement: { row: 1, col: 1, orientation: 'vertical' } };
    const anchors = [oldShip, movedShip, rotatedShip].map(ship => projectShipControlAnchor(ship, camera, bounds));
    expect(anchors[0]).not.toEqual(anchors[1]);
    expect(anchors[0]).not.toEqual(anchors[2]);
    [oldShip, movedShip, rotatedShip].forEach((ship, i) => {
      const pose = shipWorldPose(ship), expected = new THREE.Vector3(pose.x, 1.6, pose.z).project(camera);
      expect(anchors[i][0]).toBeCloseTo((expected.x + 1) * bounds.width / 2, 8);
      expect(anchors[i][1]).toBeCloseTo((1 - expected.y) * bounds.height / 2, 8);
    });
  });
  it.each<[number, number, number]>([[-10, 13, -14], [10, 13, -14], [10, 13, 14], [-10, 13, 14], [0, 18, 16], [16, 18, 0]])('keeps every public coordinate stable at camera (%s,%s,%s)', (x, y, z) => {
    const camera = cameraAt([x, y, z]);
    for (let cell = 0; cell < 100; cell++) {
      const p = screen(camera, cell % 10 - 4.5, Math.floor(cell / 10) - 4.5);
      expect(projectBoardCell(camera, bounds, p.x, p.y)).toBe(cell);
    }
  });
  it('distinguishes an offboard plane position from a legal cell and rejects outside-canvas input', () => {
    const camera = cameraAt(DEFAULT_CAMERA_POSITION), p = screen(camera, -5.5, 0);
    const projected = projectBoardPoint(camera, bounds, p.x, p.y);
    expect(projected?.x).toBeCloseTo(-5.5, 5);
    expect(projected?.z).toBeCloseTo(0, 5);
    expect(projectBoardCell(camera, bounds, p.x, p.y)).toBeNull();
    expect(projectBoardPoint(camera, bounds, bounds.left - 1, bounds.top)).toBeNull();
  });
  it('recognizes a raised offboard active hull without treating empty sea or another ship as focused', () => {
    const camera = cameraAt(DEFAULT_CAMERA_POSITION), scene = new THREE.Scene();
    const ship = new THREE.Group(); ship.userData.shipId = 'carrier';
    const hull = new THREE.Mesh(new THREE.BoxGeometry(.7, .6, 2), new THREE.MeshBasicMaterial());
    hull.position.set(-5.8, .8, 0); ship.add(hull); scene.add(ship);
    const center = new THREE.Vector3(-5.8, .8, 0).project(camera);
    const x = bounds.left + (center.x + 1) / 2 * bounds.width, y = bounds.top + (1 - center.y) / 2 * bounds.height;
    expect(projectBoardCell(camera, bounds, x, y)).toBeNull();
    expect(rayHitsShip(scene, camera, bounds, x, y, 'carrier')).toBe(true);
    expect(rayHitsShip(scene, camera, bounds, x, y, 'destroyer')).toBe(false);
    const empty = screen(camera, -6, 3);
    expect(rayHitsShip(scene, camera, bounds, empty.x, empty.y, 'carrier')).toBe(false);
    ship.visible = false;
    expect(rayHitsShip(scene, camera, bounds, x, y, 'carrier')).toBe(false);
    hull.geometry.dispose(); (hull.material as THREE.Material).dispose();
  });
});
