/**
 * check-splittree.mjs — exercises the pure SplitTree module
 * (src/shared/splittree.mjs).
 *
 * Same posture as check-grid.mjs: a node script driving a shared DOM-free
 * module directly. The SplitTree replaces the preset-template Grid (ADR-0006,
 * Wave-aligned): blocks (pane = one Terminal Session) arranged by a recursive
 * binary split tree, split in four directions, draggable/swap-able, with
 * ratios and a "can this block still split at this container size" rule.
 *
 *   Run:  node scripts/check-splittree.mjs
 */
import {
  newTree,
  split,
  removeLeaf,
  setSession,
  swapSessions,
  setRatio,
  canSplit,
  collectSessions,
  findPath,
  leafCount,
  normalizeTree,
  MIN_BLOCK_W,
  MIN_BLOCK_H,
} from "../src/shared/splittree.mjs";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ✓ " + name);
  else {
    failures++;
    console.error("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

console.log("SplitTree module checks");
console.log("=======================");

console.log("1. construction");
const t0 = newTree("A");
check("newTree makes a leaf holding the session", t0.kind === "leaf" && t0.sessionId === "A");
const t0b = newTree(null);
check("newTree(null) makes an empty leaf", t0b.kind === "leaf" && t0b.sessionId === null);

console.log("2. four-direction splits");
// split into the right side: new block on the right of the target
const tr = split(t0, [], "h", "B", false);
check("split right keeps A left", tr.kind === "split" && tr.dir === "h" && tr.a.sessionId === "A");
check("split right puts B right", tr.b.sessionId === "B");
// split into the left side
const tl = split(t0, [], "h", "B", true);
check("split left puts B left", tl.kind === "split" && tl.dir === "h" && tl.a.sessionId === "B" && tl.b.sessionId === "A");
// vertical: top / bottom
const tv = split(t0, [], "v", "B", true);
check("split top puts B above A", tv.kind === "split" && tv.dir === "v" && tv.a.sessionId === "B" && tv.b.sessionId === "A");
const tv2 = split(t0, [], "v", "B", false);
check("split bottom puts B below A", tv2.a.sessionId === "A" && tv2.b.sessionId === "B");
// recursive: split the inner block B of tr
const tdeep = split(tr, [1], "v", "C", false);
check("recursive split lands on the target leaf", tdeep.b.kind === "split" && tdeep.b.a.sessionId === "B" && tdeep.b.b.sessionId === "C");
// splitting a split node is rejected
const tbad = split(tdeep, [], "h", "X", false);
check("splitting a non-leaf is a no-op", tbad === tdeep);

console.log("3. removeLeaf collapses the tree");
const tdel = split(split(t0, [], "h", "B", false), [1], "v", "C", false);
// delete C (path [1,1]): B's parent split collapses to B
const [tcoll, removed] = removeLeaf(tdel, [1, 1]);
check("removeLeaf returns the removed session", removed === "C");
check("collapsed tree promotes the remaining sibling", tcoll.kind === "split" && tcoll.dir === "h" && tcoll.b.kind === "leaf" && tcoll.b.sessionId === "B", JSON.stringify(tcoll));
// delete the last leaf: empty tree
const [tempty] = removeLeaf(t0, []);
check("removing the only leaf yields null tree", tempty === null);
// deleting a split node is rejected
const [tnoop] = removeLeaf(tdel, [1]);
check("removeLeaf on a non-leaf is a no-op", tnoop === tdel);

console.log("4. setSession / swapSessions");
const tset = setSession(t0, [], "B");
check("setSession replaces the leaf's session", tset.sessionId === "B");
const tswap = swapSessions(tr, [0], [1]);
check("swapSessions exchanges A and B", tswap.a.sessionId === "B" && tswap.b.sessionId === "A");
const tswap2 = swapSessions(tdeep, [0], [1, 1]);
check("swap works across depth (A <-> C)", tswap2.a.sessionId === "C" && tswap2.b.b.sessionId === "A", JSON.stringify(tswap2));

console.log("5. ratios");
const tr2 = split(t0, [], "h", "B", false);
const trat = setRatio(tr2, [], 0.7);
check("setRatio stores the ratio", Math.abs(trat.ratio - 0.7) < 1e-9);
const tclamp = setRatio(tr2, [], 0.05);
check("setRatio clamps to the legal range", tclamp.ratio >= 0.15 && tclamp.ratio <= 0.85, `ratio=${tclamp.ratio}`);
check("setRatio on a leaf is a no-op", setRatio(t0, [], 0.5) === t0);

console.log("6. canSplit (min block size vs container)");
// Wide container: horizontal split of a single block needs 2*MIN_BLOCK_W.
check("canSplit h at wide container", canSplit(t0, [], "h", 2 * MIN_BLOCK_W + 8, 600) === true);
check("canSplit h fails at narrow container", canSplit(t0, [], "h", 2 * MIN_BLOCK_W - 8, 600) === false);
check("canSplit v at tall container", canSplit(t0, [], "v", 800, 2 * MIN_BLOCK_H + 8) === true);
check("canSplit v fails at short container", canSplit(t0, [], "v", 800, 2 * MIN_BLOCK_H - 8) === false);
// Depth: the inner leaf of a horizontal split gets half width.
const ttwo = split(t0, [], "h", "B", false);
check("inner leaf of h split can split vertically", canSplit(ttwo, [1], "v", 800, 2 * MIN_BLOCK_H + 8) === true);
check("inner leaf of h split cannot split horizontally (half width)", canSplit(ttwo, [1], "h", 800, 600) === false, `needs ${2 * MIN_BLOCK_W}`);
// A leaf that itself is the only block can always hold a session; canSplit
// only guards new splits, empty leaf at tiny container still cannot split.
const tnarrow = canSplit(t0, [], "v", 800, MIN_BLOCK_H - 1);
check("canSplit v fails below min height", tnarrow === false);

console.log("7. traversal helpers");
check("collectSessions lists leaves in order", collectSessions(ttwo).join(",") === "A,B");
check("collectSessions skips empty leaves", collectSessions(setSession(t0, [], null)).length === 0);
check("leafCount counts leaves", leafCount(tdeep) === 3);
check("findPath locates a session", findPath(tdeep, "C").join(",") === "1,1");
check("findPath returns null when absent", findPath(tdeep, "Z") === null);

console.log("8. normalizeTree repairs bad shapes");
const good = normalizeTree(tdeep);
check("valid tree passes through", JSON.stringify(good) === JSON.stringify(tdeep), JSON.stringify(good));
const bad1 = normalizeTree({ kind: "split", dir: "x", ratio: 2, a: { kind: "leaf", sessionId: "A" }, b: { kind: "leaf", sessionId: "B" } });
check("unknown dir -> h", bad1.dir === "h");
check("out-of-range ratio clamped", bad1.ratio >= 0.15 && bad1.ratio <= 0.85);
const bad2 = normalizeTree({ kind: "split", dir: "v", a: { kind: "leaf", sessionId: 42 }, b: null });
check("non-string session -> null", bad2.a.sessionId === null);
check("null child becomes empty leaf", bad2.b.kind === "leaf" && bad2.b.sessionId === null);
const bad3 = normalizeTree({ kind: "banana" });
check("unknown node -> empty leaf", bad3.kind === "leaf" && bad3.sessionId === null);
const bad4 = normalizeTree(null);
check("null tree -> empty leaf", bad4.kind === "leaf" && bad4.sessionId === null);

console.log(failures === 0 ? "\nALL SPLITTREE CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
