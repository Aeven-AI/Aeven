/**
 * Page scripts that read, inside the page, what a send-like browser action
 * would publish, so the approval names it ("Post this reply") and shows the
 * text going out.
 *
 * The probe finds the control a click lands on (the nearest button-like
 * ancestor of the target), the publishing verb its label opens with (see
 * {@link PUBLISH_VERB_SOURCES}), and the text in the nearest composer: the
 * first ancestor of the control that contains an editable field (a
 * `textarea` or `contenteditable`) supplies it, and the search stops at the
 * article, dialog, or form that holds the control. Reply, comment, and Save
 * controls publish only when that composer holds text, so the "Reply" that
 * opens an empty reply box does not count; Send, Post, Repost, Invite, and
 * Submit always do.
 *
 * The script guard stops a page script from publishing at all: while armed it
 * refuses programmatic clicks, synthetic click and Enter events, and form
 * submissions that the probe classifies as publishing, marks the control with
 * `data-aeven-send`, and throws an error that tells the model to click it with
 * `preview_click`, which asks the person. A trusted pointer or key event (the
 * person's own input, or a click the browser tools dispatch through the
 * debugger) disarms it. The guard confines the agent's scripts; a page that
 * keeps its own references to the native methods is not confined by it.
 *
 * @module @aeven/browser-chromium/outbound-probe
 */

import { PUBLISH_VERB_SOURCES } from './send-gate.ts'

/** What a send-like action publishes, as the probe classifies it. */
export type PageOutboundKind = 'reply' | 'comment' | 'message' | 'email' | 'post' | 'edit' | 'form' | 'repost' | 'invite'

/** What one send-like action publishes, read from the page. */
export interface PageOutbound {
  readonly kind: PageOutboundKind
  /** The clicked control's accessible name, at most 80 characters; `Enter` for a key press. */
  readonly label: string
  /** Text in the composer the action sends, or the filled fields of a submitted form; at most 4000 characters. */
  readonly text?: string
  /** Recipients of an email composer. */
  readonly to?: string
  /** Subject of an email composer. */
  readonly subject?: string
}

/** The probe's answer. */
export interface OutboundProbe {
  /** Address of the document the target lives in. */
  readonly url: string
  /** False when the selector is not plain CSS or does not match exactly one element; the caller then decides without the page. */
  readonly found: boolean
  /** What the action publishes, or null when it publishes nothing. */
  readonly outbound: PageOutbound | null
}

/** Library expression evaluating to `{ describe(element), describeKey() }`; each probe and guard embeds its own copy. */
const LIBRARY = `(() => {
  const VERBS = Object.entries(${JSON.stringify(PUBLISH_VERB_SOURCES)}).map(([verb, source]) => [verb, new RegExp(source, "iu")]);
  const SEARCH = /search|zoek|buscar|busca|such|recherche|搜索|搜尋/i;
  const SUBJECT = /subject|onderwerp|asunto|betreff|objet|主题|主旨/i;
  const CONTROL = 'button, [role="button"], [role="menuitem"], input[type="submit"], input[type="button"], input[type="image"]';
  const EDITABLE = 'textarea, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]';
  const OWNER = 'article, [role="article"], [role="dialog"], dialog, form';
  const MAX = 4000;
  const norm = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const cap = (text) => text.length > MAX ? text.slice(0, MAX) + "…" : text;
  const up = (node) => node.parentElement ?? (node.getRootNode() instanceof ShadowRoot ? node.getRootNode().host : null);
  const verbOf = (label) => VERBS.find(([, pattern]) => pattern.test(label))?.[0];
  const labelOf = (element) => norm(element.getAttribute("aria-label") || (element.tagName === "INPUT" ? element.value || element.alt : "") || element.innerText || element.textContent || element.title).slice(0, 80);
  const textOf = (element) => String(element.tagName === "TEXTAREA" || element.tagName === "INPUT" ? element.value : element.innerText ?? element.textContent ?? "").trim();
  const editablesIn = (root) => [...root.querySelectorAll(EDITABLE)].filter((element) => !element.parentElement?.closest(EDITABLE));
  const composerOf = (control) => {
    for (let node = up(control); node; node = up(node)) {
      const editables = editablesIn(node);
      if (editables.length > 0) return { root: node, editor: editables.find((element) => textOf(element) !== "") };
      if (node.matches(OWNER)) return undefined;
    }
    return undefined;
  };
  const recipientsIn = (scope) => {
    const chips = [...scope.querySelectorAll("[email]")].map((element) => element.getAttribute("email"));
    const inputs = [...scope.querySelectorAll('input[type="email"], input[name="to"]')].map((element) => element.value.trim());
    return [...new Set([...chips, ...inputs].filter(Boolean))].join(", ");
  };
  const subjectIn = (scope) => [...scope.querySelectorAll("input")].find((element) => SUBJECT.test([element.name, element.getAttribute("aria-label"), element.placeholder].join(" ")))?.value.trim() ?? "";
  const fieldsOf = (form) => [...form.elements].filter((element) =>
    (element.tagName === "INPUT" && !["hidden", "password", "submit", "button", "image", "reset", "checkbox", "radio", "file"].includes(element.type)) || element.tagName === "TEXTAREA" || element.tagName === "SELECT",
  ).map((element) => {
    const value = (element.tagName === "SELECT" ? element.selectedOptions[0]?.text ?? "" : element.value).trim();
    const name = norm(element.labels?.[0]?.innerText || element.getAttribute("aria-label") || element.placeholder || element.name);
    return value === "" ? "" : (name === "" ? value : name + ": " + value);
  }).filter(Boolean).join("\\n");
  const describe = (target) => {
    const control = target instanceof Element ? target.closest(CONTROL) : null;
    if (!control) return null;
    const label = labelOf(control);
    const verb = verbOf(label);
    const composer = composerOf(control);
    const text = composer?.editor ? textOf(composer.editor) : "";
    const form = control.form ?? control.closest("form");
    const submits = form !== null && ((control.tagName === "BUTTON" && (control.getAttribute("type") ?? "submit").toLowerCase() === "submit") || (control.tagName === "INPUT" && control.type === "submit"));
    const withText = text === "" ? { label } : { label, text: cap(text) };
    switch (verb) {
      case "repost": return { label, kind: "repost" };
      case "invite": return { label, kind: "invite" };
      case "post": return { ...withText, kind: "post" };
      case "send": {
        const scope = control.closest('[role="dialog"], form') ?? composer?.root ?? null;
        const to = scope === null ? "" : recipientsIn(scope);
        const subject = scope === null ? "" : subjectIn(scope);
        return { ...withText, kind: to !== "" || subject !== "" ? "email" : "message", ...(to === "" ? {} : { to }), ...(subject === "" ? {} : { subject }) };
      }
      case "reply":
      case "comment": return text === "" ? null : { ...withText, kind: verb };
      case "commit": return text === "" ? null : { ...withText, kind: "edit" };
      case "submit": {
        const fields = text === "" && form !== null ? fieldsOf(form) : "";
        return fields === "" ? { ...withText, kind: "form" } : { label, text: cap(fields), kind: "form" };
      }
      default: return submits && text !== "" ? { ...withText, kind: "form" } : null;
    }
  };
  const focused = () => {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  };
  const describeKey = () => {
    const element = focused();
    if (!element || element === document.body || element === document.documentElement) return null;
    if (element.closest(CONTROL)) return describe(element);
    const editor = element.closest(EDITABLE) ?? (element.tagName === "INPUT" ? element : null);
    if (!editor) return null;
    if (editor.tagName === "INPUT") {
      const type = (editor.getAttribute("type") ?? "text").toLowerCase();
      if (!["text", "email", "url", "tel"].includes(type) || editor.closest('[role="search"], [role="combobox"], [role="searchbox"]')
        || SEARCH.test([editor.name, editor.id, editor.getAttribute("aria-label"), editor.placeholder].join(" "))) return null;
    }
    const text = textOf(editor);
    return text === "" ? null : { kind: "message", label: "Enter", text: cap(text) };
  };
  return { describe, describeKey, CONTROL, EDITABLE, textOf };
})()`

/**
 * Build the expression that reports what a click on a CSS selector's element,
 * or Enter in the focused element, would publish.
 * @param selector - the click target's selector, or null for Enter pressed in the focused element.
 * @returns an expression evaluating to an {@link OutboundProbe}.
 */
export function outboundProbe(selector: string | null): string {
  return `(() => {
  const lib = ${LIBRARY};
  if (${JSON.stringify(selector)} === null) return { url: location.href, found: true, outbound: lib.describeKey() };
  const all = (root, css) => {
    const found = [...root.querySelectorAll(css)];
    for (const element of root.querySelectorAll("*")) if (element.shadowRoot) found.push(...all(element.shadowRoot, css));
    return found;
  };
  let matches;
  try {
    matches = [...new Set(all(document, ${JSON.stringify(selector)}))];
  } catch {
    // Not plain CSS (a text=, role=, or xpath= locator): the caller decides without the page.
    return { url: location.href, found: false, outbound: null };
  }
  if (matches.length !== 1) return { url: location.href, found: false, outbound: null };
  return { url: location.href, found: true, outbound: lib.describe(matches[0]) };
})()`
}

/**
 * Prefix a page script with the guard that stops it from publishing.
 * @param expression - the model's page script, unchanged after the prefix so its completion value stays the result.
 * @param armMs - how long the guard stays armed when no trusted input disarms it first.
 * @returns the guarded script.
 */
export function guardScript(expression: string, armMs: number): string {
  return `(() => {
  const KEY = Symbol.for("aeven.outboundGuard");
  const installed = HTMLElement.prototype.click[KEY];
  if (installed) { installed.arm(${String(armMs)}); return; }
  const lib = ${LIBRARY};
  let armedUntil = 0;
  let marks = 0;
  const armed = () => Date.now() < armedUntil;
  const refuse = (control, outbound) => {
    marks += 1;
    control.setAttribute("data-aeven-send", String(marks));
    throw new Error("Page scripts cannot post or send. This script tried to click \\"" + outbound.label + "\\", which publishes; nothing was clicked. Call preview_click with selector [data-aeven-send=\\"" + String(marks) + "\\"] so the person can approve what it posts.");
  };
  const check = (target) => {
    if (!armed() || !(target instanceof Element)) return;
    const outbound = lib.describe(target);
    if (outbound) refuse(target.closest(lib.CONTROL) ?? target, outbound);
  };
  const native = {
    click: HTMLElement.prototype.click,
    dispatchEvent: EventTarget.prototype.dispatchEvent,
    submit: HTMLFormElement.prototype.submit,
    requestSubmit: HTMLFormElement.prototype.requestSubmit,
  };
  const click = function () { check(this); return native.click.call(this); };
  click[KEY] = { arm: (ms) => { armedUntil = Date.now() + ms; } };
  HTMLElement.prototype.click = click;
  EventTarget.prototype.dispatchEvent = function (event) {
    if (armed() && this instanceof Element && !event.isTrusted) {
      if (/^(?:click|mousedown|mouseup|pointerdown|pointerup)$/.test(event.type)) check(this);
      else if ((event.type === "keydown" || event.type === "keypress") && event.key === "Enter" && !event.shiftKey) {
        const editor = this.closest(lib.EDITABLE) ?? (this.tagName === "INPUT" ? this : null);
        if (editor && lib.textOf(editor) !== "") throw new Error("Page scripts cannot press Enter in a text field, which may send it; nothing was pressed. Focus the field and call preview_press with key Enter so the person can approve what it sends.");
      }
    }
    return native.dispatchEvent.call(this, event);
  };
  const refuseForm = () => { throw new Error("Page scripts cannot submit forms; nothing was submitted. Call preview_click on the form's submit button so the person can approve what it sends."); };
  HTMLFormElement.prototype.submit = function () { if (armed()) refuseForm(); return native.submit.call(this); };
  HTMLFormElement.prototype.requestSubmit = function (submitter) { if (armed()) refuseForm(); return native.requestSubmit.call(this, submitter); };
  const disarm = (event) => { if (event.isTrusted) armedUntil = 0; };
  addEventListener("pointerdown", disarm, true);
  addEventListener("keydown", disarm, true);
  click[KEY].arm(${String(armMs)});
})();
${expression}`
}
