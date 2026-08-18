/**
 * dsh-ssh-hub - shared Terminal Theme definitions (single source of truth).
 *
 * Imported by:
 *   - the client bundle (src/client/client-main.tsx) for xterm options.theme
 *     and the Terminal Area CSS variables,
 *   - scripts/check-contrast.mjs for WCAG contrast enforcement in `npm test`.
 *
 * Each variant carries two blocks:
 *   - `xterm`: the xterm.js theme (foreground, background, cursor, selection
 *     and the full 16-color ANSI palette),
 *   - `surface`: the CSS variable values of the Terminal Area (canvas/pane
 *     background, empty state, error surface, server picker).
 *
 * Contrast floors (enforced by scripts/check-contrast.mjs):
 *   - foreground vs background >= 7:1
 *   - every ANSI color vs background >= 4.5:1 (explicit 3:1 exemptions only)
 */

export const TERMINAL_THEMES = {
  dark: {
    id: "dark",
    xterm: {
      foreground: "#d7dae0",
      background: "#1e2128",
      cursor: "#d7dae0",
      cursorAccent: "#1e2128",
      selectionBackground: "#3b4252aa",
      black: "#6b6b6b",
      red: "#ee4f5d",
      green: "#16c60c",
      yellow: "#c19c00",
      blue: "#4582ff",
      magenta: "#db54ad",
      cyan: "#3a96dd",
      white: "#cccccc",
      brightBlack: "#8a8a8a",
      brightRed: "#ff6b6b",
      brightGreen: "#2ee62e",
      brightYellow: "#f9f1a5",
      brightBlue: "#7aa2ff",
      brightMagenta: "#f27fd8",
      brightCyan: "#61d6d6",
      brightWhite: "#f2f2f2",
    },
    surface: {
      bg: "#1e2128",
      emptyFg: "#8b90a0",
      emptyBtnBg: "#2a2e38",
      emptyBtnFg: "#e6e8ee",
      emptyBtnBgHover: "#343946",
      errFg: "#e6b0b0",
      pickerBg: "#262a33",
      pickerBorder: "#3a3f4b",
      pickerFootBorder: "#333947",
      pickerLabelFg: "#8b90a0",
      pickerItemFg: "#e6e8ee",
      pickerItemBgHover: "#2e333d",
    },
  },
  light: {
    id: "light",
    xterm: {
      foreground: "#1f2328",
      background: "#f5f6f8",
      cursor: "#1f2328",
      cursorAccent: "#f5f6f8",
      selectionBackground: "#0451a533",
      black: "#0c0c0c",
      red: "#cd3131",
      green: "#008000",
      yellow: "#727500",
      blue: "#0451a5",
      magenta: "#bc05bc",
      cyan: "#047b98",
      white: "#383a42",
      brightBlack: "#6b7075",
      brightRed: "#e01400",
      brightGreen: "#008000",
      brightYellow: "#777400",
      brightBlue: "#0451a5",
      brightMagenta: "#bc05bc",
      brightCyan: "#047b98",
      brightWhite: "#383a42",
    },
    surface: {
      bg: "#f5f6f8",
      emptyFg: "#6b7075",
      emptyBtnBg: "#e8eaed",
      emptyBtnFg: "#1f2328",
      emptyBtnBgHover: "#dfe2e6",
      errFg: "#b3261e",
      pickerBg: "#ffffff",
      pickerBorder: "#d0d3d9",
      pickerFootBorder: "#e2e4e8",
      pickerLabelFg: "#6b7075",
      pickerItemFg: "#1f2328",
      pickerItemBgHover: "#eef0f3",
    },
  },
};
