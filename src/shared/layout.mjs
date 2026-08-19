/**
 * Pure n-tree layout module — Wave's flexbox layout model (spec #32, ADR-0008).
 *
 * A tab's layout is a tree where a node is either a block (a leaf holding one
 * Terminal Session, or null = empty) or an ordered list of same-direction
 * nodes. Levels alternate direction: level 1 tiles as a row, level 2 as a
 * column, level 3 as a row, and so on. Nodes carry a unitless size; the ratio
 * of sibling sizes decides displacement (CSS-flexbox semantics).
 *
 * Nodes are located by IndexArr (an array of child indexes, Wave's
 * convention). New blocks auto-place into the first-level row, rightward,
 * wrapping after five by nesting a column under the rightmost block.
 * Dragging offers 7 drop targets classified from a block's diagonals.
 *
 * The module is DOM-free and doubles as the wire schema for each tab's tree
 * under GET/PUT /ssh-hub/workspace.
 */

export const AUTO_PLACE_LIMIT = 5;

/** @typedef {Object} BlockNode
 *  @property {"block"} kind
 *  @property {string|null} sessionId
 *
 *  @typedef {Object} ListNode
 *  @property {"list"} kind
 *  @property {"row"|"col"} dir
 *  @property {number[]} sizes
 *  @property {TreeNode[]} children
 *
 *  @typedef {BlockNode|ListNode} TreeNode */

export function newBlock(sessionId = null) {
  return { kind: "block", sessionId: sessionId ?? null };
}

export function newTree() {
  return newBlock(null);
}

/** A list node with one unitless size per child (defaults to 1 each). */
export function listOf(dir, children, sizes) {
  const n = children.length;
  const s = sizes !== undefined && sizes.length === n ? [...sizes] : new Array(n).fill(1);
  return { kind: "list", dir, sizes: s, children: [...children] };
}

/** Direction for a list at depth d (level 1 = row). */
export function dirAtDepth(depth) {
  return depth % 2 === 0 ? "row" : "col";
}

/** Validate + repair arbitrary JSON into a well-formed tree. */
export function normalizeTree(input) {
  if (input === null || typeof input !== "object") return newBlock(null);
  if (input.kind === "block") {
    return newBlock(typeof input.sessionId === "string" ? input.sessionId : null);
  }
  if (input.kind === "list") {
    const dir = input.dir === "col" ? "col" : "row";
    const rawChildren = Array.isArray(input.children) ? input.children : [];
    const children = rawChildren.map(normalizeTree);
    if (children.length === 0) return newBlock(null);
    const sizes = Array.isArray(input.sizes) && input.sizes.length === children.length ? input.sizes.map(Number) : new Array(children.length).fill(1);
    return { kind: "list", dir, sizes, children };
  }
  return newBlock(null);
}

/** The node at `indexArr` (a list of child indexes), or undefined. */
export function nodeAt(tree, indexArr) {
  let node = tree;
  for (const step of indexArr) {
    if (node.kind !== "list") return undefined;
    if (step < 0 || step >= node.children.length) return undefined;
    node = node.children[step];
  }
  return node;
}

/** Replace the subtree at `indexArr`, cloning ancestors. */
export function replaceAt(tree, indexArr, replacement) {
  if (indexArr.length === 0) return replacement;
  const parentArr = indexArr.slice(0, -1);
  const parent = nodeAt(tree, parentArr);
  if (parent === undefined || parent.kind !== "list") return tree;
  const step = indexArr[indexArr.length - 1];
  const copy = { ...parent, children: [...parent.children], sizes: [...parent.sizes] };
  copy.children[step] = replacement;
  return replaceAt(tree, parentArr, copy);
}

/**
 * Auto-place a new block: fill the first-level row rightward; once the row
 * holds AUTO_PLACE_LIMIT children, nest the new block under the rightmost
 * child (a column grows downward, right-to-left per Wave's doc).
 */
export function autoPlace(tree, sessionId) {
  const nb = newBlock(sessionId);
  let root = tree;
  if (root.kind === "block") {
    if (root.sessionId === null) return nb; // first session takes the empty slot
    root = listOf("row", [root]);
  }
  if (root.kind !== "list" || root.dir !== "row") root = listOf("row", [root]);
  if (root.children.length < AUTO_PLACE_LIMIT) {
    return listOf("row", [...root.children, nb], [...root.sizes, 1]);
  }
  const last = root.children[root.children.length - 1];
  let newLast;
  if (last.kind === "list" && last.dir === "col") {
    newLast = listOf("col", [...last.children, nb], [...last.sizes, 1]);
  } else {
    newLast = listOf("col", [last, nb]);
  }
  return listOf("row", [...root.children.slice(0, -1), newLast], [...root.sizes.slice(0, -1), root.sizes[root.sizes.length - 1]]);
}

/**
 * Remove the block at `indexArr`, compressing depth: a list that loses all
 * but one child is collapsed (its remaining child promoted); an empty list is
 * removed. Returns [newTree|null, removedSessionId].
 */
export function removeBlock(tree, indexArr) {
  const target = nodeAt(tree, indexArr);
  if (target === undefined || target.kind !== "block") return [tree, null];
  if (indexArr.length === 0) return [null, target.sessionId];
  const parentArr = indexArr.slice(0, -1);
  const parent = nodeAt(tree, parentArr);
  if (parent === undefined || parent.kind !== "list") return [tree, null];
  const step = indexArr[indexArr.length - 1];
  const siblings = parent.children.filter((_, i) => i !== step);
  const sizes = parent.sizes.filter((_, i) => i !== step);
  let replacement;
  if (siblings.length === 0) {
    replacement = null; // the list itself disappears
  } else if (siblings.length === 1) {
    replacement = siblings[0]; // collapse: promote the remaining child
  } else {
    replacement = { ...parent, children: siblings, sizes };
  }
  const tree2 = replacement === null ? removeListAt(tree, parentArr) : replaceAt(tree, parentArr, replacement);
  return [tree2, target.sessionId];
}

/** Remove the list node at `arr`, collapsing upwards when it empties. */
function removeListAt(tree, arr) {
  if (arr.length === 0) return null;
  const parentArr = arr.slice(0, -1);
  const parent = nodeAt(tree, parentArr);
  if (parent === undefined || parent.kind !== "list") return tree;
  const step = arr[arr.length - 1];
  const siblings = parent.children.filter((_, i) => i !== step);
  const sizes = parent.sizes.filter((_, i) => i !== step);
  if (siblings.length === 0) return removeListAt(tree, parentArr);
  if (siblings.length === 1) return replaceAt(tree, parentArr, siblings[0]);
  return replaceAt(tree, parentArr, { ...parent, children: siblings, sizes });
}

/**
 * Drop the block at `fromArr` relative to the block at `toArr` using one of
 * the 7 Wave targets. All movements except swap shift the layout.
 */
export function dropBlock(tree, fromArr, toArr, target) {
  const from = nodeAt(tree, fromArr);
  const to = nodeAt(tree, toArr);
  if (from === undefined || from.kind !== "block" || to === undefined || to.kind !== "block") return tree;
  if (fromArr.join(".") === toArr.join(".")) return tree;

  if (target === "swap") {
    const t1 = replaceAt(tree, fromArr, to);
    return replaceAt(t1, toArr, from);
  }

  // remove `from` (compressing), then relocate the target by its session id
  // (the old IndexArr may have shifted after the removal).
  const toSession = to.sessionId;
  const [withoutFrom, removedSession] = removeBlock(tree, fromArr);
  if (withoutFrom === null || removedSession === null) return tree;
  const moved = newBlock(removedSession);
  const toArr2 = findArr(withoutFrom, toSession);
  if (toArr2 === null) return withoutFrom;
  const to2 = nodeAt(withoutFrom, toArr2);
  if (to2 === undefined || to2.kind !== "block") return withoutFrom;

  if (target === "inline-before" || target === "inline-after") {
    const parentArr = toArr2.slice(0, -1);
    const parent = nodeAt(withoutFrom, parentArr);
    if (parent === undefined || parent.kind !== "list") {
      // the target is the root block: wrap it in a same-direction list
      const dir = dirAtDepth(toArr2.length - 1);
      return target === "inline-before" ? listOf(dir, [moved, to2]) : listOf(dir, [to2, moved]);
    }
    const step = toArr2[toArr2.length - 1];
    const at = target === "inline-before" ? step : step + 1;
    const children = [...parent.children];
    const sizes = [...parent.sizes];
    children.splice(at, 0, moved);
    sizes.splice(at, 0, 1);
    return replaceAt(withoutFrom, parentArr, { ...parent, children, sizes });
  }

  if (target === "outer-before" || target === "outer-after") {
    // insert at the level of the target's parent node: before/after it
    const insertListArr = toArr2.length >= 2 ? toArr2.slice(0, -2) : [];
    const insertList = nodeAt(withoutFrom, insertListArr);
    if (insertList === undefined || insertList.kind !== "list") return withoutFrom;
    const parentStep = toArr2.length >= 2 ? toArr2[toArr2.length - 2] : toArr2[0];
    const at = target === "outer-before" ? parentStep : parentStep + 1;
    const children = [...insertList.children];
    const sizes = [...insertList.sizes];
    children.splice(at, 0, moved);
    sizes.splice(at, 0, 1);
    return replaceAt(withoutFrom, insertListArr, { ...insertList, children, sizes });
  }

  if (target === "inner-before" || target === "inner-after") {
    // nest a new level of the opposite direction around the target block
    const parentDir = toArr2.length === 1 ? dirAtDepth(0) : dirAtDepth(toArr2.length - 1);
    const innerDir = oppositeDir(parentDir);
    const newLevel = target === "inner-before" ? listOf(innerDir, [moved, to2]) : listOf(innerDir, [to2, moved]);
    return replaceAt(withoutFrom, toArr2, newLevel);
  }

  return withoutFrom;
}

/** Path (IndexArr) to the first block holding `sessionId`, or null. */
export function findArr(tree, sessionId) {
  let found = null;
  const walk = (node, arr) => {
    if (found !== null) return;
    if (node.kind === "block") {
      if (node.sessionId === sessionId) found = [...arr];
      return;
    }
    node.children.forEach((c, i) => walk(c, [...arr, i]));
  };
  walk(tree, []);
  return found;
}

function oppositeDir(dir) {
  return dir === "row" ? "col" : "row";
}

/**
 * Classify a pointer position inside a target block into one of the 7 drop
 * targets, given the block's tiling direction. The block is divided along its
 * diagonals; the middle fifth is the swap zone. For a row tiling the left/
 * right bands are inline (before/after) and the top/bottom triangles are
 * out-of-line (inner near the centre, outer near the outside). Column tiling
 * mirrors this.
 */
export function classifyDrop(dir, rx, ry) {
  // middle fifth -> swap
  if (Math.abs(rx - 0.5) < 0.1 && Math.abs(ry - 0.5) < 0.1) return "swap";

  if (dir === "row") {
    const inLeftBand = rx < 0.5 - 0.1 && ry > rx - 0.05 && ry < 1 - rx + 0.05;
    const inRightBand = rx > 0.5 + 0.1 && ry > 1 - rx - 0.05 && ry < rx + 0.05;
    if (inLeftBand) return "inline-before";
    if (inRightBand) return "inline-after";
    // top triangle (above both diagonals): before
    if (ry < rx && ry < 1 - rx) {
      return rx > 0.35 && rx < 0.65 ? "inner-before" : "outer-before";
    }
    // bottom triangle: after
    return rx > 0.35 && rx < 0.65 ? "inner-after" : "outer-after";
  }
  // column tiling
  const inTopBand = ry < 0.5 - 0.1 && rx > ry - 0.05 && rx < 1 - ry + 0.05;
  const inBottomBand = ry > 0.5 + 0.1 && rx > 1 - ry - 0.05 && rx < ry + 0.05;
  if (inTopBand) return "inline-before";
  if (inBottomBand) return "inline-after";
  if (rx < ry && rx < 1 - ry) {
    return ry > 0.35 && ry < 0.65 ? "inner-before" : "outer-before";
  }
  return ry > 0.35 && ry < 0.65 ? "inner-after" : "outer-after";
}

/** Set a list node's size at `indexArr` (unitless; ratios follow). */
export function resizeNode(tree, indexArr, size) {
  if (indexArr.length === 0) return tree;
  const parentArr = indexArr.slice(0, -1);
  const parent = nodeAt(tree, parentArr);
  if (parent === undefined || parent.kind !== "list") return tree;
  const step = indexArr[indexArr.length - 1];
  if (step < 0 || step >= parent.sizes.length) return tree;
  const n = Math.max(0.1, Number(size) || 1);
  const copy = { ...parent, sizes: parent.sizes.map((s, i) => (i === step ? n : s)) };
  return replaceAt(tree, parentArr, copy);
}

/** Set the session of the block at `indexArr`. */
export function setSession(tree, indexArr, sessionId) {
  const target = nodeAt(tree, indexArr);
  if (target === undefined || target.kind !== "block") return tree;
  return replaceAt(tree, indexArr, newBlock(sessionId));
}

/** All session ids in leaf order (empty blocks skipped). */
export function collectSessions(tree) {
  const out = [];
  const walk = (node) => {
    if (node.kind === "block") {
      if (node.sessionId !== null) out.push(node.sessionId);
      return;
    }
    for (const c of node.children) walk(c);
  };
  walk(tree);
  return out;
}

export function leafCount(tree) {
  let n = 0;
  const walk = (node) => {
    if (node.kind === "block") n++;
    else for (const c of node.children) walk(c);
  };
  walk(tree);
  return n;
}

/** Alias for replaceAt — used by the magnified-view write-back. */
export const layoutReplaceAt = replaceAt;
