/**
 * Pure SplitTree module — the Wave-aligned window model (ADR-0006).
 *
 * Blocks (pane = one Terminal Session) are arranged by a recursive binary
 * split tree. Every node is either a Leaf (a slot holding one session, or
 * null = empty slot) or a Split (dir "h" = left/right, dir "v" = top/bottom,
 * with a draggable ratio). The tree is plain JSON and doubles as the wire
 * schema for GET/PUT /ssh-hub/tree and the /tree/events pushes; the host is
 * authoritative and the floating window and the full-screen view are two
 * viewports over the same tree.
 *
 * The module is DOM-free: geometry checks (canSplit) take the container size
 * as arguments; the UI supplies them from the window's real size.
 */

/** A block needs at least this many pixels to be usable. */
export const MIN_BLOCK_W = 360;
export const MIN_BLOCK_H = 200;
/** Ratio clamp for a split divider. */
export const RATIO_MIN = 0.15;
export const RATIO_MAX = 0.85;
/** Default ratio for a fresh split. */
export const RATIO_DEFAULT = 0.5;

/**
 * @typedef {Object} LeafNode
 * @property {"leaf"} kind
 * @property {string|null} sessionId - the Terminal Session in this block
 *
 * @typedef {Object} SplitNode
 * @property {"split"} kind
 * @property {"h"|"v"} dir - "h": a left / b right; "v": a top / b bottom
 * @property {number} ratio - divider position in [RATIO_MIN, RATIO_MAX]
 * @property {TreeNode} a
 * @property {TreeNode} b
 *
 * @typedef {LeafNode|SplitNode} TreeNode
 */

export function newTree(sessionId = null) {
  return { kind: "leaf", sessionId: sessionId ?? null };
}

/** A fresh split node with default ratio. */
function makeSplit(dir, a, b) {
  return { kind: "split", dir, ratio: RATIO_DEFAULT, a, b };
}

/**
 * Split the leaf at `path` in `dir`, placing a new leaf holding `sessionId`
 * first (true) or second (false) — i.e. newFirst=true opens left/top,
 * false opens right/bottom. Returns the same tree when `path` is not a leaf.
 */
export function split(tree, path, dir, sessionId, newFirst) {
  const target = nodeAt(tree, path);
  if (target === undefined || target.kind !== "leaf") return tree;
  const fresh = newTree(sessionId);
  const replacement = newFirst ? makeSplit(dir, fresh, target) : makeSplit(dir, target, fresh);
  return replaceAt(tree, path, replacement);
}

/**
 * Remove the leaf at `path`, collapsing a split whose other child is a leaf.
 * Returns [newTree|null, removedSessionId]. Removing the only leaf yields null.
 */
export function removeLeaf(tree, path) {
  const target = nodeAt(tree, path);
  if (target === undefined || target.kind !== "leaf") return [tree, null];
  if (path.length === 0) return [null, target.sessionId];
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(tree, parentPath);
  if (parent === undefined || parent.kind !== "split") return [tree, null];
  const side = path[path.length - 1];
  const sibling = side === 0 ? parent.b : parent.a;
  const replacement = sibling; // collapse: the sibling takes the split's place
  const next = replaceAt(tree, parentPath, replacement);
  return [next, target.sessionId];
}

/** Put a session into the leaf at `path` (empty slot or replacement). */
export function setSession(tree, path, sessionId) {
  const target = nodeAt(tree, path);
  if (target === undefined || target.kind !== "leaf") return tree;
  return replaceAt(tree, path, { kind: "leaf", sessionId: sessionId ?? null });
}

/** Exchange the sessions held by the two leaves at `p1` and `p2`. */
export function swapSessions(tree, p1, p2) {
  const n1 = nodeAt(tree, p1);
  const n2 = nodeAt(tree, p2);
  if (n1 === undefined || n1.kind !== "leaf" || n2 === undefined || n2.kind !== "leaf") return tree;
  let next = replaceAt(tree, p1, { kind: "leaf", sessionId: n2.sessionId });
  next = replaceAt(next, p2, { kind: "leaf", sessionId: n1.sessionId });
  return next;
}

/** Set a split's ratio (clamped); a no-op when `path` is not a split. */
export function setRatio(tree, path, ratio) {
  const target = nodeAt(tree, path);
  if (target === undefined || target.kind !== "split") return tree;
  const clamped = Math.min(RATIO_MAX, Math.max(RATIO_MIN, Number(ratio) || RATIO_DEFAULT));
  const copy = { ...target, ratio: clamped };
  return replaceAt(tree, path, copy);
}

/**
 * Can the leaf at `path` be split in `dir` inside a container of (w, h)?
 * A fresh split is 50/50, so a horizontal split needs each half >=
 * MIN_BLOCK_W wide; a vertical split needs each half >= MIN_BLOCK_H tall.
 * The target's own geometry is computed by unfolding the tree from the root.
 */
export function canSplit(tree, path, dir, w, h) {
  const target = nodeAt(tree, path);
  if (target === undefined || target.kind !== "leaf") return false;
  const geo = leafGeometry(tree, path, w, h);
  if (geo === null) return false;
  if (dir === "h") return geo.w / 2 >= MIN_BLOCK_W && geo.h >= MIN_BLOCK_H;
  return geo.w >= MIN_BLOCK_W && geo.h / 2 >= MIN_BLOCK_H;
}

/** Sessions in leaf order (empty leaves skipped). */
export function collectSessions(tree) {
  const out = [];
  visit(tree, (node) => {
    if (node.kind === "leaf" && node.sessionId !== null) out.push(node.sessionId);
  });
  return out;
}

export function leafCount(tree) {
  let n = 0;
  visit(tree, () => n++);
  return n;
}

/** Path (array of 0/1) to the leaf holding `sessionId`, or null. */
export function findPath(tree, sessionId) {
  let found = null;
  const walk = (node, path) => {
    if (found !== null) return;
    if (node.kind === "leaf") {
      if (node.sessionId === sessionId) found = [...path];
      return;
    }
    walk(node.a, [...path, 0]);
    walk(node.b, [...path, 1]);
  };
  walk(tree, []);
  return found;
}

/**
 * Validate + repair arbitrary JSON into a well-formed tree: unknown dirs ->
 * "h", ratios clamped, non-string sessions -> null, missing children -> empty
 * leaves, unknown nodes -> empty leaf, null -> empty leaf.
 */
export function normalizeTree(input) {
  if (input === null || typeof input !== "object") return newTree(null);
  if (input.kind === "split") {
    const dir = input.dir === "v" ? "v" : "h";
    const ratio = Math.min(RATIO_MAX, Math.max(RATIO_MIN, Number(input.ratio) || RATIO_DEFAULT));
    return {
      kind: "split",
      dir,
      ratio,
      a: normalizeTree(input.a),
      b: normalizeTree(input.b),
    };
  }
  const sessionId = typeof input.sessionId === "string" ? input.sessionId : null;
  return { kind: "leaf", sessionId };
}

/* ---------------- internals ---------------- */

function visit(node, cb) {
  if (node.kind === "leaf") cb(node);
  else {
    visit(node.a, cb);
    visit(node.b, cb);
  }
}

function nodeAt(tree, path) {
  let node = tree;
  for (const step of path) {
    if (node.kind !== "split") return undefined;
    node = step === 0 ? node.a : node.b;
  }
  return node;
}

function replaceAt(tree, path, replacement) {
  return rebuild(tree, path, replacement);
}

function rebuild(tree, path, newNode) {
  // Replace the subtree at `path` with newNode, cloning the ancestors.
  // Bottom-up: swap the direct child at `path`, then rebuild the parent
  // path with the modified parent — never descend into the child itself.
  if (path.length === 0) return newNode;
  const parentPath = path.slice(0, -1);
  const parent = nodeAt(tree, parentPath);
  if (parent === undefined || parent.kind !== "split") return tree;
  const side = path[path.length - 1];
  const copy = { ...parent };
  if (side === 0) copy.a = newNode;
  else copy.b = newNode;
  return rebuild(tree, parentPath, copy);
}

/** Unfold the container geometry of the leaf at `path` (50/50 per split). */
function leafGeometry(tree, path, w, h) {
  let node = tree;
  let cw = w;
  let ch = h;
  for (const step of path) {
    if (node.kind !== "split") return null;
    const ratio = node.ratio;
    const child = step === 0 ? node.a : node.b;
    if (node.dir === "h") {
      cw = step === 0 ? cw * ratio : cw * (1 - ratio);
    } else {
      ch = step === 0 ? ch * ratio : ch * (1 - ratio);
    }
    node = child;
  }
  return node.kind === "leaf" ? { w: cw, h: ch } : null;
}
