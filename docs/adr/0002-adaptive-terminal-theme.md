# Adaptive Terminal Theme

The Terminal Area no longer has a single always-dark palette. It follows the DSH GUI theme (light/dark), with a per-browser Theme Override (`auto` / `dark` / `light`) as an explicit escape hatch, and every palette color is held to a WCAG contrast floor enforced by `scripts/check-contrast.mjs` in `npm test`.

The original design comment — "the terminal surface is always dark (Campbell palette) so ANSI colors stay readable in both themes" — is superseded. Keeping the terminal permanently dark made the panel read as a foreign dark block in light GUI mode, and it did not actually guarantee readability: the shipped palette's dark red, blue, magenta and black all failed a 4.5:1 floor against the dark background.

## Considered Options

- **Keep the terminal always dark.** Rejected: clashed with light GUI mode, and the old palette was demonstrably below any contrast floor anyway. The manual override preserves this look for the users who want it.
- **Only swap foreground/background, keep the ANSI palette.** Rejected: the Campbell bright colors (e.g. `#f9f1a5` bright yellow) are near-invisible on a light background; a light theme needs a complete re-tuned 16-color palette.
- **Follow the browser `prefers-color-scheme` only.** Rejected: the GUI has its own manual light/dark/system appearance preference, and the panel chrome already follows it via `--dsw-*` tokens. A terminal that ignored the GUI preference and followed the OS would produce chrome/terminal mismatches. We follow the DSH theme service (which itself tracks `prefers-color-scheme` when the preference is `system`) and fall back to `prefers-color-scheme` only when the service is unavailable.
- **No user override.** Rejected during design review: "light GUI + dark terminal" is a real preference (it was the old behavior); the toolbar cycle button keeps it one click away.

## Decisions

- **Single source of truth.** Both palettes (xterm theme + Terminal Area surface colors) live in one shared, dependency-free module imported by the client bundle and the contrast script. The client applies surface colors by writing `--dmst-*` CSS variables from that module — no hard-coded color duplicates remain inside the Terminal Area.
- **Scope boundary.** The Terminal Theme governs the Terminal Area only (canvas, pane backgrounds, empty state, error surface, server picker). Panel chrome (tab bar, toolbar, status dots, drawer) always follows the GUI theme.
- **Hot-swap.** Theme changes apply to every open terminal via xterm's runtime theme option; sessions are never torn down or reconnected.
- **Signal precedence.** Theme Override > DSH theme service resolved scheme > `prefers-color-scheme`.
- **Contrast floors.** Foreground vs background ≥ 7:1; each ANSI color vs background ≥ 4.5:1. Explicit per-color exemptions live in the contrast script: `dark.black` is tuned to the darkest shade meeting the 3:1 dimmed-text floor (`#6b6b6b`) — ANSI black on a dark background cannot reach 4.5:1 without repainting it mid-gray, and `brightBlack` remains the fully-legible gray slot. The dark variant's red/blue/magenta were brightened minimally (hue-preserving) to meet 4.5:1.

## Consequences

- The dark variant is very slightly brighter than the old Campbell palette in red/blue/magenta, and ANSI black renders as a legible dark gray instead of near-invisible.
- The light variant is a full 16-color palette tuned against a light background (`#f5f6f8`); colors that cannot meet 4.5:1 on light without desaturating (dark yellow/cyan) were darkened rather than exempted.
- A future palette change must keep `npm test` green — the contrast script runs ahead of the integration suite.
- Theme adaptation depends on the DSH theme service; where it is absent, adaptation degrades to `prefers-color-scheme` and still works.
