/**
 * check-grid.mjs — exercises the pure Grid module (src/shared/grid.mjs).
 *
 * Same posture as scripts/check-contrast.mjs: a node script driving a shared
 * DOM-free module directly. The Grid module owns Layout Template geometry,
 * pin/unpin/reorder semantics, and width-based degradation — every rule the
 * Dock and Focus View consume (ADR-0005).
 *
 *   Run:  node scripts/check-grid.mjs
 */
import {
  TEMPLATES,
  tileCount,
  normalizeTemplate,
  withTemplate,
  pin,
  unpin,
  reorder,
  fitCount,
  MIN_TILE_W,
  MIN_TILE_H,
} from "../src/shared/grid.mjs";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ✓ " + name);
  else {
    failures++;
    console.error("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

console.log("Grid module checks");
console.log("==================");

console.log("1. templates and counts");
check("exactly five templates ship", TEMPLATES.join(",") === "single,split-h,split-v,grid-4,main-2");
check("single = 1 tile", tileCount("single") === 1);
check("split-h = 2 tiles", tileCount("split-h") === 2);
check("split-v = 2 tiles", tileCount("split-v") === 2);
check("grid-4 = 4 tiles", tileCount("grid-4") === 4);
check("main-2 = 3 tiles", tileCount("main-2") === 3);
check("unknown template normalizes to single", normalizeTemplate("banana") === "single");
check("valid template passes through", normalizeTemplate("grid-4") === "grid-4");

console.log("2. withTemplate reshapes, preserving leading pins");
const g4 = { template: "grid-4", tiles: ["A", "B", "C", "D"] };
const g4toSplit = withTemplate(g4, "split-h");
check("grid-4 -> split-h keeps first two pins", g4toSplit.template === "split-h" && g4toSplit.tiles.join(",") === "A,B");
const g4toMain = withTemplate(g4, "main-2");
check("grid-4 -> main-2 keeps first three pins", g4toMain.template === "main-2" && g4toMain.tiles.join(",") === "A,B,C");
const singleUp = withTemplate({ template: "single", tiles: ["A"] }, "grid-4");
check("single -> grid-4 pads with nulls", singleUp.tiles.length === 4 && singleUp.tiles[0] === "A" && singleUp.tiles[1] === null && singleUp.tiles[3] === null);

console.log("3. pin / unpin / reorder");
const st = { template: "split-h", tiles: [null, null] };
const p1 = pin(st, "A", 0);
check("pin fills an empty tile", p1.tiles.join(",") === "A,");
const p2 = pin(p1, "B", 1);
check("pin fills the second tile", p2.tiles.join(",") === "A,B");
const p3 = pin(p2, "C", 1);
check("pin overwrites an occupied tile", p3.tiles.join(",") === "A,C");
const moved = pin(p3, "A", 1);
check("pinning an already-pinned session moves it (no duplicate)", moved.tiles.join(",") === ",A");
const u1 = unpin(moved, 1);
check("unpin empties the tile", u1.tiles.join(",") === ",");
const r1 = reorder({ template: "grid-4", tiles: ["A", "B", "C", "D"] }, 0, 3);
check("reorder moves A to the end", r1.tiles.join(",") === "B,C,D,A");
const r2 = reorder({ template: "grid-4", tiles: ["A", "B", "C", "D"] }, 3, 0);
check("reorder moves D to the front", r2.tiles.join(",") === "D,A,B,C");
const r3 = reorder({ template: "grid-4", tiles: ["A", "B", "C", "D"] }, 1, 1);
check("reorder same index is a no-op", r3.tiles.join(",") === "A,B,C,D");
check("reorder out of range is a no-op", reorder({ template: "split-h", tiles: ["A", "B"] }, 0, 5).tiles.join(",") === "A,B");

console.log("4. fitCount — degradation by trailing tiles");
// Wide, tall viewport: everything fits.
check("grid-4 fits fully on a wide viewport", fitCount("grid-4", 1600, 900) === 4);
check("split-h fits on a wide viewport", fitCount("split-h", 1600, 900) === 2);
check("split-v fits on a tall viewport", fitCount("split-v", 1600, 900) === 2);
check("main-2 fits on a wide viewport", fitCount("main-2", 1600, 900) === 3);
// grid-4 cells are uniform, so geometry is all-or-nothing; the intermediate
// "2 tiles in the Dock" state comes from the cap, not from geometry.
check("short grid-4 degrades to 0 (rows need full height)", fitCount("grid-4", 2 * MIN_TILE_W + 8, 2 * MIN_TILE_H - 1) === 0);
check("tall grid-4 fits both rows", fitCount("grid-4", 2 * MIN_TILE_W + 8, 2 * MIN_TILE_H + 8) === 4);
// Too narrow for any cell: 0 visible, everything returns to the tab strip.
check("narrow viewport degrades grid-4 to 0", fitCount("grid-4", MIN_TILE_W - 1, 900) === 0);
check("narrow viewport degrades split-h to 0", fitCount("split-h", MIN_TILE_W - 1, 900) === 0);
// split-v cells are uniform height, so it is all-or-nothing on height.
check("short viewport degrades split-v to 0", fitCount("split-v", 1600, 2 * MIN_TILE_H - 1) === 0);
check("tall viewport fits split-v fully", fitCount("split-v", 1600, 2 * MIN_TILE_H) === 2);
// Cap: the Dock allows at most two Tiles even when four would fit.
check("cap 2 clamps grid-4 to 2 (Dock rule)", fitCount("grid-4", 1600, 900, 2) === 2);
check("cap 2 leaves split-h at 2", fitCount("split-h", 1600, 900, 2) === 2);
check("cap 1 clamps main-2 to 1", fitCount("main-2", 1600, 900, 1) === 1);
check("cap 0 means no tiles", fitCount("grid-4", 1600, 900, 0) === 0);

console.log("5. degradation order is positional (leading tiles win)");
// main-2 at a width where only the wide main cell fits: the main tile keeps
// its pin and the right column degrades — index order decides.
check("main-2 narrow keeps 1 leading tile", fitCount("main-2", 600, 900) === 1);
check("main-2 narrower still keeps nothing", fitCount("main-2", 580, 900) === 0);
check("main-2 wide fits all three", fitCount("main-2", 1600, 900) === 3);

console.log(failures === 0 ? "\nALL GRID CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
