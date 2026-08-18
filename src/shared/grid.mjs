/**
 * Pure Grid module — Layout Template geometry, pinning, and degradation.
 *
 * The Grid shows multiple Terminal Sessions at once in Tiles. Users pick a
 * preset Layout Template and Pin sessions into Tiles; arbitrary manual
 * splitting is deliberately not supported (ADR-0005). This module is
 * DOM-free and shared by both surfaces: the Dock caps the visible count at
 * two, the Focus View at four. The host keeps the authoritative GridState;
 * these functions are pure transforms over it.
 *
 * Degradation rule: Tiles are positional. When the viewport cannot hold the
 * whole template, the LEADING tiles keep their pins and the trailing ones
 * degrade back to the tab strip (in order), sessions untouched — the caller
 * renders only the leading `fitCount(...)` tiles.
 */

/** The shipped Layout Templates (ADR-0005). */
export const TEMPLATES = ["single", "split-h", "split-v", "grid-4", "main-2"];

/** A Tile needs at least this many pixels to be usable. */
export const MIN_TILE_W = 360;
export const MIN_TILE_H = 200;
export const GRID_GAP = 4;

/** Tiles per template. */
export const TILE_COUNT = {
  single: 1,
  "split-h": 2,
  "split-v": 2,
  "grid-4": 4,
  "main-2": 3,
};

/**
 * Grid areas per template, index order == visual order == degradation order.
 * Letters spell the CSS grid-template-areas rows; "main-2" spans the main
 * tile across both rows ("a" in row 0 and row 1).
 */
export const TEMPLATE_AREAS = {
  single: [["a"]],
  "split-h": [["a", "b"]],
  "split-v": [["a"], ["b"]],
  "grid-4": [
    ["a", "b"],
    ["c", "d"],
  ],
  "main-2": [
    ["a", "b"],
    ["a", "c"],
  ],
};

/** Cell fractions (x, y, w, h) matching TEMPLATE_AREAS, for fitCount. */
const CELLS = {
  single: [[0, 0, 1, 1]],
  "split-h": [
    [0, 0, 0.5, 1],
    [0.5, 0, 0.5, 1],
  ],
  "split-v": [
    [0, 0, 1, 0.5],
    [0, 0.5, 1, 0.5],
  ],
  "grid-4": [
    [0, 0, 0.5, 0.5],
    [0.5, 0, 0.5, 0.5],
    [0, 0.5, 0.5, 0.5],
    [0.5, 0.5, 0.5, 0.5],
  ],
  "main-2": [
    [0, 0, 0.62, 1],
    [0.62, 0, 0.38, 0.5],
    [0.62, 0.5, 0.38, 0.5],
  ],
};

/** Unknown template -> single (safe default). */
export function normalizeTemplate(v) {
  return TEMPLATES.includes(v) ? v : "single";
}

export function tileCount(template) {
  return TILE_COUNT[normalizeTemplate(template)];
}

/** CSS grid-template-areas string for a template. */
export function gridAreas(template) {
  return TEMPLATE_AREAS[normalizeTemplate(template)].map((row) => `"${row.join(" ")}"`).join(" ");
}

/** Letter assigned to tile index i in the areas grid. */
export function tileLetter(template, index) {
  const areas = TEMPLATE_AREAS[normalizeTemplate(template)];
  const flat = areas.flat();
  return flat[Math.max(0, Math.min(flat.length - 1, index))];
}

/**
 * Switch template, keeping the leading pins that still fit and padding with
 * nulls. Trailing pins are dropped (their sessions return to the tab strip).
 */
export function withTemplate(state, template) {
  const n = tileCount(template);
  const tiles = new Array(n).fill(null);
  for (let i = 0; i < Math.min(state.tiles.length, n); i++) tiles[i] = state.tiles[i] ?? null;
  return { template: normalizeTemplate(template), tiles };
}

/** Pin a session into a Tile (clamped to range); moves it if pinned elsewhere. */
export function pin(state, sessionId, tileIndex) {
  const n = tileCount(state.template);
  const idx = Math.max(0, Math.min(n - 1, Math.round(tileIndex)));
  const tiles = [...state.tiles];
  for (let i = 0; i < n; i++) if (tiles[i] === sessionId && i !== idx) tiles[i] = null;
  tiles[idx] = sessionId;
  return { template: state.template, tiles };
}

export function unpin(state, tileIndex) {
  const tiles = [...state.tiles];
  if (tileIndex >= 0 && tileIndex < tiles.length) tiles[tileIndex] = null;
  return { template: state.template, tiles };
}

/** Move a Tile's content from `from` to `to` (swap-free splice, like a tab move). */
export function reorder(state, from, to) {
  const n = state.tiles.length;
  if (from === to || from < 0 || from >= n || to < 0 || to >= n) return state;
  const tiles = [...state.tiles];
  const [moved] = tiles.splice(from, 1);
  tiles.splice(to, 0, moved);
  return { template: state.template, tiles };
}

/**
 * How many LEADING Tiles fit at viewport (w, h), capped at `cap`.
 * Trailing Tiles beyond this count degrade to the tab strip.
 */
export function fitCount(template, w, h, cap = 4) {
  const cells = CELLS[normalizeTemplate(template)];
  let n = 0;
  for (const [, , cw, ch] of cells) {
    if (w * cw < MIN_TILE_W || h * ch < MIN_TILE_H) break;
    n++;
  }
  const c = Math.max(0, Math.round(cap));
  return Math.min(n, c);
}
