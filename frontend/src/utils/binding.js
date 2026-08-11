/** Bookbinding cloths. Deliberately desaturated: these sit beside paper. */
export const CLOTHS = [
  '#3a4a9f', '#8f3a35', '#2f6b45', '#9a5a17', '#6b3f6e',
  '#3f4a52', '#2c6360', '#8a6a1f', '#4a3f7a', '#7a3f4f',
];

/** Darken a hex colour by a factor, for the board groove. */
export function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * factor)));
  const r = clamp((n >> 16) & 255);
  const g = clamp((n >> 8) & 255);
  const b = clamp(n & 255);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

/**
 * Pick a binding for a book. Deterministic on the identifier so a given volume
 * is always bound the same way — a shelf that reshuffles its colours on every
 * render would look like a rendering fault rather than a library.
 */
export function clothFor(seed) {
  const key = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) % 100000;
  }
  return CLOTHS[hash % CLOTHS.length];
}
