/**
 * dsh-ssh-hub — settings card (设置 → 插件 → 插件配置).
 *
 * Owns the `ssh-hub` settings namespace's card: staged drafts, save /
 * discard, per-field reset, dirty marker, and save-refusal with drafts kept
 * when the namespace moved underneath us. The built-in cards' form model
 * cannot be imported (client bundle-purity gate), so this card carries its
 * own staging and revision fencing — but it speaks the same interaction
 * language: what you see staged is what a save stores, and 放弃 drops it.
 *
 * The bound scope is injected by the host bundle wrapper (build.mjs) through
 * setSettingsScope(); the panel reuses the same scope for the Terminal Theme
 * default (see getSettingsScope in #15).
 */
import React from "react";
import {
  parseBinding,
  KNOWN_DSH_KEYS,
  loadKeys,
  saveKeys,
  DEFAULT_KEYS,
} from "../shared/keybind.mjs";

/* ---------------- bound settings scope (injected by the wrapper) -------- */

export interface SettingsScopeSnapshot {
  status: string;
  value?: Record<string, unknown>;
  base?: Record<string, unknown>;
  user?: Record<string, unknown>;
  revision?: number;
  writable?: boolean;
}

export interface BoundSettingsScope {
  getSnapshot: () => SettingsScopeSnapshot;
  subscribe: (cb: () => void) => () => void;
  set: (field: string, value: unknown) => Promise<unknown>;
  unset: (field: string) => Promise<unknown>;
}

let boundScope: BoundSettingsScope | null = null;

export function setSettingsScope(scope: BoundSettingsScope | null) {
  boundScope = scope;
}

export function getSettingsScope(): BoundSettingsScope | null {
  return boundScope;
}

/* ---------------- field metadata ---------------------------------------- */

/** Mirror of the host schema defaults — only used to show what a reset means. */
const SCHEMA_DEFAULTS: Record<string, number | boolean | string> = {
  defaultReadyTimeoutSec: 15,
  defaultKeepaliveIntervalSec: 30,
  defaultStrictHostKey: false,
  defaultTerminalTheme: "auto",
};

const RANGES: Record<string, { min: number; max: number }> = {
  defaultReadyTimeoutSec: { min: 3, max: 120 },
  defaultKeepaliveIntervalSec: { min: 0, max: 300 },
};

const THEME_OPTIONS = ["auto", "dark", "light"] as const;

const FIELD_LABELS: Record<string, string> = {
  defaultReadyTimeoutSec: "默认连接超时（秒）",
  defaultKeepaliveIntervalSec: "Keepalive 间隔（秒）",
  defaultStrictHostKey: "严格主机密钥校验",
  defaultTerminalTheme: "默认终端主题",
};

const FIELD_HINTS: Record<string, string> = {
  defaultReadyTimeoutSec: "服务器未单独设置时使用的连接超时（3–120 秒）。",
  defaultKeepaliveIntervalSec: "0 表示禁用。服务器未单独设置时使用。",
  defaultStrictHostKey: "开启后，未单独设置的服务器将要求 known-hosts 条目，没有条目的服务器将无法连接。",
  defaultTerminalTheme: "浏览器本地主题覆盖为「跟随界面」时使用的终端主题；本地深色/浅色优先于此处。",
};

/* ---------------- styles ------------------------------------------------ */

const STYLE_TAG = "dsh-ssh-hub-settings-card";
if (typeof document !== "undefined" && document.getElementById(STYLE_TAG) === null) {
  const style = document.createElement("style");
  style.id = STYLE_TAG;
  style.textContent = `
.dmsc{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;color:var(--dsw-alias-label-primary);transition:border-color .16s,background .16s}
.dmsc:hover{border-color:var(--dsw-alias-label-dimmed)}
.dmsc.open{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
.dmscHeader{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}
.dmscHeader:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dmscHeadText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}
.dmscName{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
.dmscDesc{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
.dmscDirty{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;flex:none;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dmscChevron{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s;display:flex}
.dmscChevron.open{transform:rotate(180deg)}
.dmscBody{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px}
.dmscFields{flex-direction:column;display:flex}
.dmscField{flex-direction:column;gap:6px;padding:12px 0;display:flex}
.dmscField+.dmscField{border-top:1px solid var(--dsw-alias-border-l2)}
.dmscHead{align-items:center;gap:8px;display:flex}
.dmscLabel{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}
.dmscBadge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}
.dmscReset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}
.dmscReset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}
.dmscInput{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:min(280px,100%)}
.dmscInput:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}
.dmscInput:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}
.dmscInputInvalid{border-color:var(--dsw-alias-label-error)}
.dmscErr{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}
.dmscHint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}
.dmscCheck{align-items:flex-start;gap:8px;display:flex}
.dmscCheck input{margin:3px 0 0;accent-color:var(--dsw-alias-brand-primary)}
.dmscFoot{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}
.dmscFail{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}
.dmscBtn{appearance:none;font:inherit;cursor:pointer;border:1px solid #0000;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}
.dmscBtnDiscard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}
.dmscBtnDiscard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}
.dmscBtnSave{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}
.dmscBtn:disabled{opacity:.4;cursor:default}
.dmscBtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dmscManage{margin-right:auto}
.dmscKeyRow{flex-direction:column;gap:6px;padding:8px 0 4px;display:flex}
.dmscKeyLine{display:flex;align-items:center;gap:8px}
.dmscKeyLabel{flex:none;min-width:110px;color:var(--dsw-alias-label-secondary);font-size:12.5px}
.dmscKeyInput{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
`;
  document.head.appendChild(style);
}

/* ---------------- the card ---------------------------------------------- */

type Stage = { kind: "edit"; text: string } | { kind: "clear" };

const EMPTY_SNAPSHOT: SettingsScopeSnapshot = { status: "unavailable" };

/** One configurable shortcut: local draft, validation, conflict warning. */
function KeyBindingRow({ label, action, hint }: { label: string; action: string; hint: string }) {
  const [text, setText] = React.useState<string>(() => (loadKeys()[action] ?? DEFAULT_KEYS[action] ?? ""));
  const [saved, setSaved] = React.useState(false);
  const parsed = parseBinding(text);
  const conflict =
    parsed !== null &&
    (KNOWN_DSH_KEYS.some(
      (k) =>
        k.toLowerCase().replace(/\s/g, "") ===
        text.toLowerCase().replace(/\s/g, ""),
    ) ||
      false);
  const save = () => {
    if (parsed === null) return;
    const keys = loadKeys();
    keys[action] = text;
    if (saveKeys(keys)) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  };
  return (
    <div className="dmscKeyRow">
      <div className="dmscKeyLine">
        <span className="dmscKeyLabel">{label}</span>
        <input
          className={"dmscInput dmscKeyInput" + (parsed === null ? " dmscInputInvalid" : "")}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          aria-label={label}
        />
        <button
          type="button"
          className="dmscBtn dmscBtnDiscard"
          onClick={save}
          disabled={parsed === null}
        >
          {saved ? "已保存" : "保存"}
        </button>
      </div>
      {parsed === null ? (
        <p className="dmscErr">格式应为 修饰键+键位，如 Ctrl+Shift+Backquote，且至少一个修饰键。</p>
      ) : conflict ? (
        <p className="dmscErr">与 DSH 自带快捷键接近，可能冲突（不阻止保存）。</p>
      ) : (
        <p className="dmscHint">{hint}</p>
      )}
    </div>
  );
}

export function SettingsCard() {
  const scope = boundScope;
  const snap = React.useSyncExternalStore(
    React.useCallback(
      (cb: () => void) => (scope ? scope.subscribe(cb) : () => {}),
      [scope],
    ),
    React.useCallback(() => (scope ? scope.getSnapshot() : EMPTY_SNAPSHOT), [scope]),
    // getServerSnapshot: only used by server-side rendering/hydration paths.
    React.useCallback(() => (scope ? scope.getSnapshot() : EMPTY_SNAPSHOT), [scope]),
  );
  const [staged, setStaged] = React.useState<Record<string, Stage>>({});
  const [saving, setSaving] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  if (scope === null || snap.status !== "ready") {
    // Namespace unavailable (pre-rc.7 DSH or not yet read): render nothing.
    return null;
  }

  const value = snap.value ?? {};
  const base = snap.base ?? {};
  const user = snap.user ?? {};
  const writable = snap.writable !== false;

  const composed = (field: string) => base[field] ?? SCHEMA_DEFAULTS[field];
  const overridden = (field: string) => Object.prototype.hasOwnProperty.call(user, field);
  const dirty = (field: string) => staged[field] !== undefined;
  const anyDirty = Object.keys(staged).length > 0;

  /** The text a field shows: staged edit, staged reset, or the section value. */
  const fieldText = (field: string) => {
    const st = staged[field];
    if (st?.kind === "clear") return String(composed(field));
    if (st?.kind === "edit") return st.text;
    return String(value[field] ?? composed(field));
  };

  /** Parse one number field; undefined = the staged draft is invalid. */
  const parseNumber = (field: string): number | undefined => {
    const st = staged[field];
    if (st === undefined || st.kind !== "edit") return undefined;
    const n = Number(st.text);
    const range = RANGES[field];
    if (!Number.isInteger(n) || n < range.min || n > range.max) return undefined;
    return n;
  };

  const invalidField = (field: string) => {
    const st = staged[field];
    if (st === undefined || st.kind !== "edit") return false;
    if (field === "defaultStrictHostKey") return st.text !== "true" && st.text !== "false";
    if (field === "defaultTerminalTheme") return !THEME_OPTIONS.includes(st.text as any);
    return parseNumber(field) === undefined;
  };

  const checkboxChecked = (field: string) => {
    const st = staged[field];
    if (st?.kind === "edit") return st.text === "true";
    if (st?.kind === "clear") return composed(field) === true;
    return value[field] === true;
  };

  const edit = (field: string, text: string) =>
    setStaged((prev) => ({ ...prev, [field]: { kind: "edit", text } }));
  const resetField = (field: string) =>
    setStaged((prev) => ({ ...prev, [field]: { kind: "clear" } }));

  const discard = () => {
    setStaged({});
    setFailed(false);
  };

  const save = async () => {
    if (!scope || !anyDirty || saving) return;
    // A field whose draft the section cannot accept blocks the save.
    const dirtyFields = Object.keys(staged);
    if (dirtyFields.some((f) => invalidField(f))) {
      setFailed(true);
      return;
    }
    setSaving(true);
    try {
      for (const field of dirtyFields) {
        const st = staged[field];
        if (st?.kind === "clear") await scope.unset(field);
        else if (st?.kind === "edit") {
          if (field === "defaultStrictHostKey") await scope.set(field, st.text === "true");
          else if (field === "defaultTerminalTheme") await scope.set(field, st.text);
          else await scope.set(field, parseNumber(field));
        }
      }
      // The Host is the only authority on whether a value landed: read the
      // section back and keep the drafts when a write did not take.
      const fresh = scope.getSnapshot();
      const landed = dirtyFields.every((field) => {
        if (staged[field]?.kind === "clear") {
          return !Object.prototype.hasOwnProperty.call(fresh.user ?? {}, field);
        }
        const expected = staged[field]?.kind === "edit"
          ? field === "defaultStrictHostKey"
            ? staged[field].text === "true"
            : field === "defaultTerminalTheme"
              ? staged[field].text
              : parseNumber(field)
          : undefined;
        return fresh.value?.[field] === expected;
      });
      if (landed) {
        setStaged({});
        setFailed(false);
      } else {
        setFailed(true); // drafts stay for the user to correct
      }
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const anyInvalid = Object.keys(staged).some((f) => invalidField(f));
  const [open, setOpen] = React.useState(false);

  return (
    <li className={"dmsc" + (open ? " open" : "")}>
      <button
        type="button"
        className="dmscHeader"
        aria-expanded={open}
        aria-label={(open ? "收起" : "展开") + " DSH-SSH-HUB"}
        onClick={() => setOpen(!open)}
      >
        <span className="dmscHeadText">
          <span className="dmscName">DSH-SSH-HUB</span>
          <span className="dmscDesc">连接参数与终端主题。</span>
        </span>
        {anyDirty && <span className="dmscDirty">有未保存的修改</span>}
        <span className={"dmscChevron" + (open ? " open" : "")} aria-hidden="true">
          <svg width={14} height={14} viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
              fill="currentColor"
            />
          </svg>
        </span>
      </button>

      {open && (
        <div className="dmscBody">
          <div className="dmscFields">
        {(["defaultReadyTimeoutSec", "defaultKeepaliveIntervalSec"] as const).map((field) => (
          <div className="dmscField" key={field}>
            <div className="dmscHead">
              <div className="dmscLabel">{FIELD_LABELS[field]}</div>
              {overridden(field) && !dirty(field) && (
                <>
                  <span className="dmscBadge">已覆盖</span>
                  <button className="dmscReset" onClick={() => resetField(field)}>
                    重置
                  </button>
                </>
              )}
            </div>
            <input
              className={"dmscInput" + (invalidField(field) ? " dmscInputInvalid" : "")}
              type="text"
              inputMode="numeric"
              value={fieldText(field)}
              onChange={(e) => edit(field, e.target.value)}
              disabled={!writable}
              aria-label={FIELD_LABELS[field]}
            />
            {invalidField(field) ? (
              <p className="dmscErr">
                {field === "defaultReadyTimeoutSec"
                  ? "请输入 3–120 的整数（秒）。"
                  : "请输入 0–300 的整数（秒），0 为禁用。"}
              </p>
            ) : (
              <p className="dmscHint">{FIELD_HINTS[field]}</p>
            )}
          </div>
        ))}

        <div className="dmscField">
          <div className="dmscHead">
            <div className="dmscLabel">{FIELD_LABELS.defaultStrictHostKey}</div>
            {overridden("defaultStrictHostKey") && !dirty("defaultStrictHostKey") && (
              <>
                <span className="dmscBadge">已覆盖</span>
                <button className="dmscReset" onClick={() => resetField("defaultStrictHostKey")}>
                  重置
                </button>
              </>
            )}
          </div>
          <div className="dmscCheck">
            <input
              type="checkbox"
              checked={checkboxChecked("defaultStrictHostKey")}
              onChange={(e) => edit("defaultStrictHostKey", e.target.checked ? "true" : "false")}
              disabled={!writable}
              aria-label={FIELD_LABELS.defaultStrictHostKey}
            />
            <p className="dmscHint">{FIELD_HINTS.defaultStrictHostKey}</p>
          </div>
        </div>

        <div className="dmscField">
          <div className="dmscHead">
            <div className="dmscLabel">{FIELD_LABELS.defaultTerminalTheme}</div>
            {overridden("defaultTerminalTheme") && !dirty("defaultTerminalTheme") && (
              <>
                <span className="dmscBadge">已覆盖</span>
                <button className="dmscReset" onClick={() => resetField("defaultTerminalTheme")}>
                  重置
                </button>
              </>
            )}
          </div>
          <select
            className="dmscInput"
            value={fieldText("defaultTerminalTheme")}
            onChange={(e) => edit("defaultTerminalTheme", e.target.value)}
            disabled={!writable}
            aria-label={FIELD_LABELS.defaultTerminalTheme}
          >
            <option value="auto">跟随界面</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
          <p className="dmscHint">{FIELD_HINTS.defaultTerminalTheme}</p>
        </div>
      </div>

      <div className="dmscField">
        <div className="dmscHead">
          <div className="dmscLabel">快捷键（浏览器本地，立即生效）</div>
        </div>
        <KeyBindingRow
          label="开关终端窗口"
          action="toggleWindow"
          hint="例如 Ctrl+Shift+`（输入时用 + 连接修饰键与键位）"
        />
        <KeyBindingRow
          label="最大化 / 还原"
          action="maximizeWindow"
          hint="例如 Ctrl+Alt+`；Esc 在窗口内另有行为"
        />
      </div>

      <div className="dmscFoot">
        <div className="dmscManage">
          <button
            type="button"
            className="dmscBtn dmscBtnDiscard"
            onClick={() => {
              // The panel lives under the settings modal's overlay (z-index
              // 1000); close the modal through its documented Escape close
              // path first, then ask the panel to open the server drawer.
              document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
              window.dispatchEvent(new CustomEvent("dsh-ssh-hub:open-servers"));
            }}
          >
            管理服务器…
          </button>
        </div>
        {failed && anyDirty && (
          <p className="dmscFail">
            {anyInvalid ? "有字段无法接受，请修正后保存。" : "保存未生效，请重试。"}
          </p>
        )}
        <button className="dmscBtn dmscBtnDiscard" onClick={discard} disabled={!anyDirty || saving}>
          放弃
        </button>
        <button className="dmscBtn dmscBtnSave" onClick={save} disabled={!anyDirty || anyInvalid || saving}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
        </div>
      )}
    </li>
  );
}

export default SettingsCard;
