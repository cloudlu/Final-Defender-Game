export const GRID = {
  COLS: 8,
  ROWS: 12, // 敌人活动区 12 行；城墙在 row 12（GRID.ROWS）
  CELL_SIZE: 56,
  OFFSET_X: 46,
  OFFSET_Y: 160,
};

export const GAME_WIDTH = 540;
export const GAME_HEIGHT = 960;

export function gridToPixel(col, row) {
  return {
    x: GRID.OFFSET_X + col * GRID.CELL_SIZE + GRID.CELL_SIZE / 2,
    y: GRID.OFFSET_Y + row * GRID.CELL_SIZE + GRID.CELL_SIZE / 2,
  };
}

export function pixelToGrid(x, y) {
  return {
    col: Math.floor((x - GRID.OFFSET_X) / GRID.CELL_SIZE),
    row: Math.floor((y - GRID.OFFSET_Y) / GRID.CELL_SIZE),
  };
}

export function distanceCells(c1, r1, c2, r2) {
  return Math.sqrt((c1 - c2) ** 2 + (r1 - r2) ** 2);
}
