/**
 * Pure keybinding helpers for the Terminal Window shortcuts (ADR-0006).
 *
 * Bindings are stored per browser in localStorage under KEYS_KEY as a JSON
 * map of action -> binding string, e.g. `{ "toggleWindow": "Ctrl+Shift+`" }`.
 * A binding is modifier keys joined by "+" plus one key/code (Backquote,
 * KeyA, Digit1, F5, or a literal character). Parsing tolerates both event.code
 * and event.key spellings so users can type either.
 */

export const KEYS_KEY = "dsh-ssh-hub.keys";

/** All configurable actions. */
export const ACTIONS = [
  "toggleWindow",
  "maximizeWindow",
  "newTab",
  "closeBlock",
  "closeTab",
  "magnify",
];

/** Wave-style defaults, Alt-based to dodge browser Ctrl+t/w capture. */
export const DEFAULT_KEYS = {
  toggleWindow: "Ctrl+Shift+`",
  maximizeWindow: "Ctrl+Alt+`",
  newTab: "Alt+t",
  closeBlock: "Alt+w",
  closeTab: "Alt+Shift+w",
  magnify: "Alt+m",
};

/** DSH's own known shortcuts — a conflict here is warned, not blocked. */
export const KNOWN_DSH_KEYS = [
  "Ctrl+K",
  "Ctrl+Shift+K",
  "Ctrl+Shift+P",
  "Ctrl+Shift+`",
  "Ctrl+1",
  "Ctrl+2",
  "Ctrl+3",
  "Ctrl+4",
  "Ctrl+5",
  "Ctrl+6",
  "Ctrl+7",
  "Ctrl+8",
  "Ctrl+9",
  "Ctrl+[",
  "Ctrl+]",
  "Ctrl+Shift+A",
];

/**
 * @typedef {Object} KeyBinding
 * @property {boolean} ctrl
 * @property {boolean} shift
 * @property {boolean} alt
 * @property {boolean} meta
 * @property {string} code - event.code or key spelling
 */

/** Parse a binding string; null when malformed. At least one modifier needed. */
export function parseBinding(text) {
  const parts = text.split("+").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length < 2) return null;
  const b = { ctrl: false, shift: false, alt: false, meta: false, code: "" };
  for (const part of parts) {
    const low = part.toLowerCase();
    if (low === "ctrl" || low === "control") b.ctrl = true;
    else if (low === "shift") b.shift = true;
    else if (low === "alt" || low === "option") b.alt = true;
    else if (low === "meta" || low === "cmd" || low === "win" || low === "super") b.meta = true;
    else {
      if (b.code !== "") return null; // two non-modifier parts
      b.code = part;
    }
  }
  if (b.code === "") return null;
  if (!b.ctrl && !b.alt && !b.meta && !b.shift) return null;
  return b;
}

/** Does an event match a parsed binding? Compares modifiers + code/key. */
export function eventMatches(e, binding) {
  if (binding === null) return false;
  if (
    e.ctrlKey !== binding.ctrl ||
    e.shiftKey !== binding.shift ||
    e.altKey !== binding.alt ||
    e.metaKey !== binding.meta
  ) {
    return false;
  }
  if (e.code === binding.code) return true;
  if (e.key === binding.code || e.key.toLowerCase() === binding.code.toLowerCase()) return true;
  return false;
}

export function loadKeys() {
  try {
    const raw = localStorage.getItem(KEYS_KEY);
    if (raw === null) return { ...DEFAULT_KEYS };
    const parsed = JSON.parse(raw);
    const out = { ...DEFAULT_KEYS };
    for (const action of Object.keys(DEFAULT_KEYS)) {
      if (typeof parsed[action] === "string" && parsed[action].length > 0) {
        out[action] = parsed[action];
      }
    }
    return out;
  } catch {
    return { ...DEFAULT_KEYS };
  }
}

export function saveKeys(keys) {
  try {
    localStorage.setItem(KEYS_KEY, JSON.stringify(keys));
    return true;
  } catch {
    return false;
  }
}
