/**
 * Clamp a value between min and max.
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linear interpolation between a and b.
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Distance between two points.
 */
export function distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Manhattan distance between two grid cells.
 */
export function manhattanDistance(x1, y1, x2, y2) {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

/**
 * Round to nearest integer.
 */
export function roundToInt(value) {
  return Math.round(value);
}
