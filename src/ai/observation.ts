import { FLEET_SPECS, type AIObservation, type KnownCell } from '../core/types';
import { isCoord, isStraightShip } from '../core/placement';
export function validateObservation(observation: AIObservation): void {
  if (!observation || observation.width !== 10 || observation.height !== 10 || !Array.isArray(observation.knownEnemyBoard) || observation.knownEnemyBoard.length !== 100 || observation.knownEnemyBoard.some(c => !(['unknown', 'miss', 'hit', 'sunk'] as KnownCell[]).includes(c))) throw new Error('公开棋盘格式无效');
  if (!Array.isArray(observation.remainingEnemyLengths) || !Array.isArray(observation.publicSunkShips) || !Number.isInteger(observation.turnIndex) || observation.turnIndex < 1 || observation.turnIndex > 200) throw new Error('公开舰队格式无效');
  const lengths = FLEET_SPECS.map(s => s.length), sunk = new Set<number>();
  for (const cells of observation.publicSunkShips) {
    if (!Array.isArray(cells) || !isStraightShip(cells)) throw new Error('公开沉船无效');
    const i = lengths.indexOf(cells.length); if (i < 0) throw new Error('公开沉船数量无效'); lengths.splice(i, 1);
    for (const c of cells) { if (!isCoord(c) || sunk.has(c) || observation.knownEnemyBoard[c] !== 'sunk') throw new Error('公开沉船占格无效'); sunk.add(c); }
  }
  if (observation.knownEnemyBoard.some((c, i) => c === 'sunk' && !sunk.has(i)) || JSON.stringify([...lengths].sort()) !== JSON.stringify([...observation.remainingEnemyLengths].sort())) throw new Error('公开剩余舰长无效');
}
export function neighbors(coord: number): number[] {
  const result: number[] = []; if (coord % 10 > 0) result.push(coord - 1); if (coord % 10 < 9) result.push(coord + 1); if (coord >= 10) result.push(coord - 10); if (coord < 90) result.push(coord + 10); return result;
}
export function unknownCells(observation: AIObservation): number[] { return observation.knownEnemyBoard.flatMap((c, i) => c === 'unknown' ? [i] : []); }
