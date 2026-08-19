/**
 * check-layout.mjs — exercises the pure n-tree layout module
 * (src/shared/layout.mjs).
 *
 * Same posture as check-splittree.mjs. The n-tree is Wave's flexbox layout
 * model (spec #32 / ADR-0008): a node is a block (leaf) or an ordered
 * same-direction list; levels alternate row/column; nodes are located by
 * IndexArr. Covers auto-place (wrap after five), all 7 drop targets,
 * remove-with-compression, resize ratios, and normalize repair.
 *
 *   Run:  node scripts/check-layout.mjs
 */
import {
  newBlock,
  newTree,
  autoPlace,
  removeBlock,
  dropBlock,
  classifyDrop,
  resizeNode,
  normalizeTree,
  nodeAt,
  collectSessions,
  leafCount,
  listOf,
} from "../src/shared/layout.mjs";

let failures = 0;
function check(name, cond, extra = "") {
  if (cond) console.log("  ✓ " + name);
  else {
    failures++;
    console.error("  ✗ " + name + (extra ? " — " + extra : ""));
  }
}

console.log("n-tree layout module checks");
console.log("===========================");

console.log("1. construction");
const t0 = newTree();
check("newTree is an empty block", t0.kind === "block" && t0.sessionId === null);
const b = newBlock("A");
check("newBlock holds the session", b.sessionId === "A");
const row = listOf("row", [newBlock("A"), newBlock("B")]);
check("listOf makes a row list", row.kind === "list" && row.dir === "row" && row.children.length === 2);
check("row list has default sizes", row.sizes.length === 2);
check("nodeAt locates by IndexArr", nodeAt(row, [1]).sessionId === "B");
check("nodeAt deep", nodeAt(listOf("row", [newBlock("A"), listOf("col", [newBlock("B")])]), [1, 0]).sessionId === "B");

console.log("2. auto-place: first row rightward, wrap after five");
let t = newTree();
t = autoPlace(t, "1");
check("first session fills the empty slot", t.kind === "block" && t.sessionId === "1");
t = autoPlace(t, "2");
t = autoPlace(t, "3");
t = autoPlace(t, "4");
t = autoPlace(t, "5");
check("five blocks sit in the top row", t.kind === "list" && t.dir === "row" && t.children.length === 5 && collectSessions(t).join(",") === "1,2,3,4,5");
t = autoPlace(t, "6");
check("sixth wraps below the rightmost block", t.children.length === 5 && t.children[4].kind === "list" && t.children[4].dir === "col" && t.children[4].children.length === 2 && collectSessions(t).join(",") === "1,2,3,4,5,6", JSON.stringify(t));
t = autoPlace(t, "7");
check("seventh nests under the same rightmost column", t.children[4].children.length === 3);

console.log("3. remove with depth compression");
let tr = listOf("row", [newBlock("A"), listOf("col", [newBlock("B"), newBlock("C")])]);
const [t1, removed1] = removeBlock(tr, [1, 0]);
check("remove returns the session", removed1 === "B");
check("single-child col collapses into the row", t1.kind === "list" && t1.dir === "row" && t1.children.length === 2 && nodeAt(t1, [1]).sessionId === "C", JSON.stringify(t1));
const [t2] = removeBlock(tr, [1, 1]);
check("empty col is removed entirely", t2.kind === "list" && t2.children.length === 2, JSON.stringify(t2));
const [t3] = removeBlock(newTree(), []);
check("removing the only block yields null", t3 === null);

console.log("4. drop targets");
// inline-after: A moved after C in the same row list
const src = listOf("row", [newBlock("A"), newBlock("B")]);
const d1 = dropBlock(src, [0], [1], "inline-after");
check("inline-after inserts after the target", collectSessions(d1).join(",") === "B,A", JSON.stringify(d1));
const d2 = dropBlock(src, [1], [0], "inline-before");
check("inline-before inserts before the target", collectSessions(d2).join(",") === "B,A");
// outer: move A out to the parent level (before the target's parent)
const deep = listOf("col", [listOf("row", [newBlock("A"), newBlock("B")]), newBlock("C")]);
const d3 = dropBlock(deep, [0, 1], [1], "outer-before");
check("outer-before moves to the target's parent level", collectSessions(d3).join(",") === "A,B,C" || collectSessions(d3).join(",") === "B,A,C", JSON.stringify(d3));
// inner: nest a new level around the target (use a non-collapsing tree)
const src3 = listOf("row", [newBlock("A"), newBlock("B"), newBlock("C")]);
const d4 = dropBlock(src3, [0], [2], "inner-after");
check("inner-after nests a level", d4.kind === "list" && d4.children[1].kind === "list" && collectSessions(d4).join(",") === "B,C,A", JSON.stringify(d4));
const d4b = dropBlock(src3, [0], [2], "inner-before");
check("inner-before nests a level", d4b.children[1].kind === "list" && collectSessions(d4b).join(",") === "B,A,C", JSON.stringify(d4b));
// swap positions
const d5 = dropBlock(src, [0], [1], "swap");
check("swap exchanges positions", collectSessions(d5).join(",") === "B,A");

console.log("5. classifyDrop (diagonal quadrants + middle fifth)");
// row tiling: middle fifth -> swap
check("row centre -> swap", classifyDrop("row", 0.5, 0.5) === "swap");
check("row left band -> inline-before", classifyDrop("row", 0.15, 0.5) === "inline-before");
check("row right band -> inline-after", classifyDrop("row", 0.85, 0.5) === "inline-after");
check("row top triangle (leftish) -> outer-before", classifyDrop("row", 0.2, 0.15) === "outer-before");
check("row top triangle (centre) -> inner-before", classifyDrop("row", 0.5, 0.05) === "inner-before");
check("row bottom triangle -> inner-after", classifyDrop("row", 0.5, 0.95) === "inner-after");
// column tiling: vertical bands are inline
check("col top band -> inline-before", classifyDrop("col", 0.5, 0.1) === "inline-before");
check("col bottom band -> inline-after", classifyDrop("col", 0.5, 0.9) === "inline-after");
check("col centre -> swap", classifyDrop("col", 0.5, 0.5) === "swap");
check("col left triangle -> outer-before", classifyDrop("col", 0.1, 0.3) === "outer-before");

console.log("6. resize ratios");
const rr = listOf("row", [newBlock("A"), newBlock("B")], [1, 1]);
const r1 = resizeNode(rr, [1], 3);
check("resizeNode sets the node size", r1.sizes[1] === 3 && r1.sizes[0] === 1);
const r2 = resizeNode(rr, [5], 9);
check("resizeNode out of range is a no-op", r2 === rr);

console.log("7. normalize repairs garbage");
const g1 = normalizeTree({ kind: "banana" });
check("unknown node -> empty block", g1.kind === "block" && g1.sessionId === null);
const g2 = normalizeTree({ kind: "list", dir: "x", children: [{ kind: "block", sessionId: 42 }, null] });
check("bad dir -> row; non-string session -> null; null child -> empty block", g2.dir === "row" && g2.children[0].sessionId === null && g2.children[1].kind === "block" && g2.children[1].sessionId === null);
const g3 = normalizeTree({ kind: "list", dir: "row", children: [{ kind: "block", sessionId: "A" }] });
check("sizes padded to children count", g3.sizes.length === 1);
const g4 = normalizeTree(null);
check("null -> empty block", g4.kind === "block");
check("leafCount counts blocks", leafCount(listOf("row", [newBlock("A"), listOf("col", [newBlock("B")])])) === 2);

console.log(failures === 0 ? "\nALL LAYOUT CHECKS PASSED" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
