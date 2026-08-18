# Server Defaults via DSH Settings Card

## Problem Statement

The plugin hardcodes its connection defaults — ready timeout (15s), keepalive interval (30s), host-key verification (off) — and its Terminal Theme starts from `auto` on every browser. A user who runs servers that consistently need a longer timeout must repeat the same value into every Server Config, and there is no way to change the fallback for Servers that left a field blank. Separately, the DSH settings page (rc.7) now lets plugins register their own settings cards, but dsh-ssh-hub has no presence there, so a user looking for the plugin's configuration in the central settings surface finds nothing.

## Solution

dsh-ssh-hub registers a settings namespace `ssh-hub` with the DSH settings service and ships a settings card under 设置 → 插件 → 插件配置. The card edits four global defaults — **Server Defaults** — that act as the middle layer of a three-layer resolution: a Server's own field wins; when blank, the Server Default applies; when no default is configured, the hardcoded constant stands. Changing a Server Default immediately affects every new connection of every Server that left the field blank (existing Terminal Sessions are untouched). The card also carries a 「管理服务器」 button that opens the bottom panel's server drawer, so the settings page has a path into list management without moving the list itself.

The Theme Override stays per browser; the new `defaultTerminalTheme` only answers when the browser-local override is `auto`.

## User Stories

1. As a user with slow remote servers, I want to raise the default ready timeout once, so that every Server that left the field blank connects with the new timeout.
2. As a user, I want a Server's explicitly set timeout to win over the global default, so that exceptions stay possible.
3. As a user, I want existing Terminal Sessions to keep running undisturbed when I change a Server Default, so that I don't lose work in open tabs.
4. As a user, I want the add/edit server form to show the currently effective global default as placeholder text, so that I know what a blank field will resolve to before I save.
5. As a user, I want to set a default keepalive interval globally, so that idle sessions across all my Servers survive NAT timeouts without per-server setup.
6. As a user, I want keepalive 0 to mean disabled, so that I can turn keepalive off globally.
7. As a security-conscious user, I want to turn on host-key verification by default, so that Servers I haven't individually configured still get verified.
8. As a user enabling global host-key verification, I want a warning that blank-field Servers will now require a known-hosts entry, so that I'm not surprised by new connection failures.
9. As a user, I want invalid values (out-of-range timeout, garbled text) to block the save rather than being silently dropped, so that I can correct my input.
10. As a user, I want to discard my unsaved edits in the settings card, so that I can abandon a half-typed change.
11. As a user, I want to reset a single field back to the composed default, so that I don't have to remember what the default was.
12. As a user, I want the card header to show when it holds unsaved edits, so that I don't navigate away thinking I saved.
13. As a user, I want the card's save to be refused when the settings document moved since I opened it, so that I don't overwrite a change made from another surface.
14. As a user, I want a 「管理服务器」 button on the settings card, so that I can jump from the settings page straight into server management.
15. As a user, I want clicking that button to expand the bottom panel and open the server drawer, so that I land exactly where servers are managed.
16. As a user, I want to set a default Terminal Theme (auto/dark/light) globally, so that a fresh browser starts from my preference instead of always following the GUI.
17. As a user, I want my browser-local Theme Override (dark/light via the toolbar cycle button) to keep winning over the global default, so that a dark room laptop can differ from a bright office desktop.
18. As a user, I want the chain 本地覆盖 > 全局默认 > 跟随界面 to be predictable, so that `auto` always means "ask the layer above".
19. As a power user, I want to edit the Server Defaults by hand in `settings.yaml`, so that I can version-control or bulk-edit my configuration.
20. As a user reading `settings.yaml`, I want timeout fields named and valued in seconds, so that I don't have to count millisecond zeros.
21. As a user on a pre-rc.7 DSH, I want the plugin to keep working without the settings card, so that upgrading DSH stays my choice.
22. As a user on a pre-rc.7 DSH, I want the absence of the settings service to be silent, so that the panel shows no errors.
23. As a user, I want server list management (add/edit/delete/test/import/export) to stay in the bottom panel drawer, so that immediate-effect operations aren't forced through a stage-then-save form.
24. As a user, I want the settings card's copy in Chinese consistent with the panel UI, so that the plugin reads as one product.

## Implementation Decisions

- **Settings namespace**: `ssh-hub`, registered from the host half via `installSettingsSection` from `@deepseek-ai/dsh-settings`. Four fields: `defaultReadyTimeoutSec` (int 3–120, default 15), `defaultKeepaliveIntervalSec` (int 0–300, 0 = disabled, default 30), `defaultStrictHostKey` (bool, default false), `defaultTerminalTheme` (`auto`/`dark`/`light`, default `auto`).
- **Seconds at the boundary, milliseconds inside**: the settings schema and `settings.yaml` speak seconds; the host converts to milliseconds at the read layer. Internal types are unchanged.
- **Three-layer resolution at connect time**: `Server field > Server Default > hardcoded constant`. Resolution happens per connection attempt, so a changed default reaches the next connection of every blank-field Server without touching stored Server Configs. The composition base stays empty — schema defaults plus the user layer are the whole document.
- **Theme chain**: browser-local Theme Override `dark`/`light` wins; when it is `auto`, `defaultTerminalTheme` answers; when that is also `auto`, the Terminal Area follows the DSH GUI theme (with the existing `prefers-color-scheme` fallback). Per-browser localStorage persistence is unchanged (ADR-0002 stands).
- **Form placeholders**: the add/edit server form shows the currently effective Server Default as placeholder text on the timeout and keepalive inputs. The host exposes the resolved defaults through a new read-only REST route under the existing `/ssh-hub` prefix; Server Views and Secrets are untouched by it.
- **Settings card**: registered into the keyed slot `settings.plugin.item` under key `ssh-hub` from the client half. The card owns its chrome, staging, and revision fencing (the built-in cards' form model cannot be imported — bundle-purity gate): staged drafts, save/discard, per-field reset, dirty marker on the collapsed header, save refused on namespace revision drift with drafts kept. Writes go through `ctx.settingsScope.bind({ namespace: 'ssh-hub' })` (`getSnapshot` / `subscribe` / `set` / `unset`).
- **「管理服务器」 button**: dispatches a `dsh-ssh-hub:open-servers` window event; the panel listens, expands, and opens the server drawer. The card and the panel stay decoupled across their two slot registration points.
- **Graceful degradation on pre-rc.7 DSH**: the host skips namespace registration when the `settings` service is absent; the client skips card registration when `settingsScope` is absent (read via optional `ctx.get`, never a hard `inject` dependency). All other functionality is unchanged. The README minimum-version claim does not move.
- **The server list does NOT move into the settings namespace.** The settings model is a layered config document (defaults → composition → user layer, per-key override/reset, revision-fenced whole-document writes) — a poor fit for a dynamic CRUD list with immediate-effect operations (test, delete-kills-sessions, import/export) and per-entry Secrets. The existing store (`plugin-data/ssh-hub/servers.json`, mode 0600, Secrets never served) remains the system of record. Recorded in ADR-0003.
- **Docs**: ADR-0003 (Server Defaults via dsh-settings namespace, including the rejected list-in-settings alternative); CONTEXT.md gains **Server Defaults** and a revised **Theme Override** definition (per-browser override, taking precedence over the `defaultTerminalTheme` Server Default).
- **Card copy**: Chinese, matching the panel UI.

## Testing Decisions

Good tests here assert externally observable behavior, not internal wiring: which timeout a connection actually used, whether a placeholder shows the effective default — never "was function X called".

- **Seam**: the existing host-half integration harness — mock `ctx` + real HTTP routes + a real sshd. One seam, extended: the mock ctx gains a minimal `settings` service stub so the host registers its namespace against it. No new seams.
- **New case**: with a Server whose timeout field is blank and a Server Default set via the stub, a connectivity test against a non-routable target observes the Server Default's timing, not the hardcoded 15s; a Server with an explicit timeout observes its own value (the layering, from outside).
- **Prior art**: the existing integration suite's test-connection and session cases against the test sshd.
- **Manual verification** (no automated browser harness exists): card renders under 设置 → 插件, staging/save/reset/dirty semantics, revision-conflict refusal, 「管理服务器」 jump, theme chain, pre-rc.7 degradation.
- The contrast-check script is unaffected.

## Out of Scope

- Moving the server list, Secrets, import/export, or test-connection into the settings surface.
- Terminal scrollback configuration (would require rebuilding live xterm instances; near-zero demand).
- Migrating Secrets into the DSH credentials domain.
- Cross-browser Theme Override sync; per-browser persistence is deliberate (ADR-0002).
- Per-Server override/reset semantics inside the settings document.
- Changing the panel's height/open-state persistence (browser-local UI state, not a Server Default).

## Further Notes

- Requires DSH ≥ 0.1.0-rc.7 for the card to appear; older versions run the plugin unchanged minus the settings presence.
- `defaultStrictHostKey: true` is the one default with a breaking flavor: blank-field Servers will start requiring a known-hosts entry. The card warns in place; the setting defaults to `false`.
- Namespaces registered after the settings tab's first read join the list on the next document commit or reconnect (platform limitation) — a profile plugin registers at boot, so this never bites in practice.
