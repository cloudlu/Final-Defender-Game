import { describe, it, expect } from 'vitest';
import { gridToPixel, pixelToGrid, distanceCells, GRID } from './GridConstants.js';

describe('GridConstants', () => {
  it('gridToPixel returns correct center of cell (0,0)', () => {
    const pos = gridToPixel(0, 0);
    expect(pos.x).toBe(GRID.OFFSET_X + GRID.CELL_SIZE / 2);
    expect(pos.y).toBe(GRID.OFFSET_Y + GRID.CELL_SIZE / 2);
  });

  it('pixelToGrid returns correct cell for center pixel', () => {
    const px = GRID.OFFSET_X + GRID.CELL_SIZE / 2;
    const py = GRID.OFFSET_Y + GRID.CELL_SIZE / 2;
    const cell = pixelToGrid(px, py);
    expect(cell.col).toBe(0);
    expect(cell.row).toBe(0);
  });

  it('distanceCells returns 0 for same cell', () => {
    expect(distanceCells(5, 5, 5, 5)).toBe(0);
  });

  it('distanceCells returns correct Euclidean distance', () => {
    expect(distanceCells(0, 0, 3, 4)).toBe(5);
  });
});
