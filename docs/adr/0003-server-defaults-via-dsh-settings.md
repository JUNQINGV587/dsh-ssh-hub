# Server Defaults via the dsh-settings Namespace

Connection tunables that used to be hardcoded — ready timeout (15 s), keepalive interval (30 s), host-key verification (off) — and the terminal theme's starting point (`auto`) are now Server Defaults: a plugin-level settings namespace (`ssh-hub`) editable from 设置 → 插件 → 插件配置 on DSH ≥ 0.1.0-rc.7. Each connection attempt resolves them as **Server field > Server Default > hardcoded constant**, so changing a default immediately affects every new connection of every Server whose field is blank, without rewriting stored Server Configs and without disturbing live Terminal Sessions.

## Considered Options

- **Keep the constants hardcoded.** Rejected: the panel shipped for a while with no per-Server or per-deployment knobs, and users with uniformly slow networks or aggressive NAT timeouts had to accept fixed values.
- **Per-Server fields only, no global layer.** Rejected: the Server Config already carries optional `readyTimeout` / `keepaliveInterval` / `strictHostKey`; a global layer is the natural middle of a three-layer chain, and the client form had never even exposed the per-Server fields (this ADR's work adds those inputs too).
- **Store the defaults in the plugin's own `plugin-data/ssh-hub/servers.json` store.** Rejected: that file is the Server Config system of record (mode 0600, Secrets never served, ADR 0001). Mixing plugin-level configuration into the same store duplicates what the rc.7 settings service provides (layered defaults → composition base → user document, revision fencing, per-key override/reset, `settings.yaml` hand-editing).
- **Move the whole server list into the settings namespace.** Rejected — recorded explicitly because a future reader will otherwise ask why not:
  - *Model mismatch.* `ctx.settings` is a layered configuration document (schema defaults → composition base → user layer, per-key override/reset, revision-fenced whole-document writes). A server list is dynamic CRUD data — an array can only be written whole, so two concurrent editors collide at array granularity and "which server did the user override" has no meaning.
  - *Secrets.* Secret-role settings fields write through the credentials domain, not the settings document; every Server's password/key would need to become a per-Server credential reference, re-architecting the 0600 store that already solves this (ADR 0001).
  - *Interaction contract.* The settings card is stage-then-save; server management is immediate-effect (test connection, delete kills live sessions, import/export are file-level). Forcing the list through staged drafts would confuse "why do I need to save after deleting".
  - *`settings.yaml` is for humans to hand-edit.* Global scalars fit; dozens of host entries do not.
  The list stays in the store; the settings card carries only a 「管理服务器…」 entry that opens the panel's drawer.

## Decisions

- **Namespace and schema.** `ssh-hub`, with `defaultReadyTimeoutSec` (3–120, default 15), `defaultKeepaliveIntervalSec` (0–300, default 30, 0 = disabled), `defaultStrictHostKey` (bool, default false), `defaultTerminalTheme` (`auto`/`dark`/`light`, default `auto`). Registered via `installSettingsSection` with an empty composition base, so the effective document is schema defaults + user layer.
- **Seconds at the boundary.** The settings schema and `settings.yaml` speak seconds (`...Sec` field names); the host converts to milliseconds at the read layer. Internal types (ServerConfig, ssh2 options) stay millisecond-based.
- **Blank means inherit.** `normalizeServer` no longer clamps absent tunables into hardcoded values: `readyTimeout`, `keepaliveInterval`, and `strictHostKey` stay `undefined` when the payload omits them, so the connection layer can see "blank" and walk the chain. Stored Servers written before this change carry explicit old defaults — they behave like explicitly-set fields until edited, which is the honest migration story.
- **Resolution at connect time, per attempt.** `resolveConnTunables(server, defaults)` runs on every connection (shell session and both test-connection routes), so a changed Server Default reaches the next connection without touching stored records or live sessions.
- **Theme chain.** Browser-local Theme Override (`dark`/`light`) wins; when it is `auto`, `defaultTerminalTheme` answers; when that is `auto` too, the Terminal Area follows the DSH GUI theme (with the `prefers-color-scheme` fallback when the theme service is absent). Per-browser localStorage persistence is unchanged (ADR 0002).
- **Graceful degradation.** Host registration uses dynamic `import("@deepseek-ai/dsh-settings")` + catch — a static import would crash the whole plugin on pre-rc.7 profiles that lack the package. `installSettingsSection` waits on `ctx.inject(["settings"])`, so an absent service leaves the hardcoded constants authoritative. The client registers the card only when the `settingsScope` service exists (`ctx.get`, never a hard inject) and skips it otherwise.
- **Form placeholders.** The add/edit Server form gained the previously-missing tunable inputs; blank inputs show the effective Server Default as placeholder text (served by `GET /ssh-hub/defaults`), making the inheritance visible before saving.

## Consequences

- The settings card and the server form both describe the same three-layer chain; the host route `GET /ssh-hub/defaults` is the single source the form's placeholders read.
- `defaultStrictHostKey: true` is the one default with a breaking flavor: blank-field Servers start requiring a known-hosts entry. The card warns in place; the default stays `false`.
- The plugin now depends (softly) on `@deepseek-ai/dsh-settings` and `@deepseek-ai/schemastery`; both ship with dsh-base on rc.7 and resolve at runtime from the profile's node_modules (marked external in the bundle).
- Live Terminal Sessions are never affected by default changes; only the next connection attempt is.
