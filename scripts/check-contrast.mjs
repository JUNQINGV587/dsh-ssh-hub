/**
 * dsh-ssh-hub - Terminal Theme contrast guard.
 *
 * Validates every Terminal Theme variant against the WCAG contrast floors
 * defined in the spec (Issue #6):
 *   - foreground vs background >= 7:1
 *   - each of the 16 ANSI colors vs background >= 4.5:1
 *     (explicit per-color exemptions may lower a color to 3:1; the exemption
 *     list lives HERE, never silently in the palette)
 *
 * Usage: node scripts/check-contrast.mjs
 * Exits non-zero on any violation. Wired into `npm test`.
 */

import { TERMINAL_THEMES } from "../src/shared/terminal-themes.mjs";

/** Named floors for informational pairs that are not enforced. */
const INFO_PAIRS = {
  "cursor vs background": ["cursor", "background"],
  "cursorAccent vs cursor": ["cursorAccent", "cursor"],
};

/**
 * Optional relaxations: { [variant]: { [colorName]: minRatio } }
 * dark.black: ANSI black on a dark background cannot reach 4.5:1 without
 * repainting it mid-gray; it is tuned to the darkest shade meeting the 3:1
 * dimmed-text floor so it never blends into the background. brightBlack stays
 * the fully-legible gray slot.
 */
const EXEMPTIONS = {
  dark: { black: 3.0 },
};

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function channelLum(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(channelLum);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const ANSI_COLORS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

let failures = 0;

function check(pair, ratio, min, enforced, variant) {
  const pass = ratio >= min - 1e-9;
  const flag = pass ? "ok " : "FAIL";
  if (!pass && enforced) failures += 1;
  console.log(
    `  [${flag}] ${pair.padEnd(34)} ${ratio.toFixed(2).padStart(5)}  (min ${min})`,
  );
}

console.log("Terminal Theme contrast check");
console.log("==============================");

for (const [variantId, theme] of Object.entries(TERMINAL_THEMES)) {
  const bg = theme.xterm.background;
  const ex = EXEMPTIONS[variantId] ?? {};
  console.log(`\n${variantId} (background ${bg})`);

  check(
    "foreground vs background",
    contrastRatio(theme.xterm.foreground, bg),
    7.0,
    true,
    variantId,
  );

  for (const name of ANSI_COLORS) {
    check(
      `${name} vs background`,
      contrastRatio(theme.xterm[name], bg),
      ex[name] ?? 4.5,
      true,
      variantId,
    );
  }

  for (const [label, [a, b]] of Object.entries(INFO_PAIRS)) {
    check(
      label,
      contrastRatio(theme.xterm[a], theme.xterm[b]),
      ex[b] ?? 0,
      false,
      variantId,
    );
  }
}

console.log("\n==============================");
if (failures > 0) {
  console.error(`FAILED: ${failures} contrast violation(s)`);
  process.exit(1);
}
console.log("All Terminal Theme variants meet the contrast floors.");
