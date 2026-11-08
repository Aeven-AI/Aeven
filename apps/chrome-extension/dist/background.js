//#region ../../packages/web/browser-engine/src/page-scripts.ts
/**
* Page-side JavaScript the sidebar browser's agent actions evaluate in a guest.
*
* Every constant here is source text, evaluated by CDP in the page (or in an
* isolated world of one of its frames); nothing in this module runs in the main
* process.
*/
/**
* Locator engine, evaluated as a prelude that defines `__aevenLocate`.
*
* A selector is one or more parts joined by `>>`; each part searches inside the
* elements the previous part matched. A part is CSS (the default, piercing open
* shadow roots), or `engine=body` with one of these engines:
* - `text=Save` matches the innermost visible elements whose text contains `Save`
*   ignoring case; `text="Save"` matches the whole normalized text exactly; `text=/re/i` is a regular expression.
* - `role=button[name="Save"]` matches the ARIA role, explicit or implicit, with optional
*   `name`, `checked`, `disabled`, `expanded`, `pressed`, `selected`, and `level` filters;
*   `name` matches like `text=`.
* - `label=`, `placeholder=`, `alt=`, `title=` match the control's label, placeholder,
*   alt text, or title like `text=`; `testid=x` matches `data-testid="x"` exactly.
* - `xpath=//button` evaluates XPath.
* - `nth=0` keeps one match by index (negative counts from the end); `visible=true` keeps visible ones.
*
* `__aevenLocate.all(selector)` returns every match; `.one(selector)` returns the
* single match or null and throws when several match.
*/
const LOCATOR_PRELUDE = `const __aevenLocate = (() => {
  const norm = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const deepAll = (root, css) => {
    const found = [];
    const walk = (node) => {
      for (const element of node.querySelectorAll(css)) found.push(element);
      for (const element of node.querySelectorAll("*")) if (element.shadowRoot) walk(element.shadowRoot);
    };
    walk(root);
    return [...new Set(found)];
  };
  const matcher = (wanted) => {
    const raw = String(wanted).trim();
    const regex = /^\\/(.*)\\/([a-z]*)$/s.exec(raw);
    if (regex) { const pattern = new RegExp(regex[1], regex[2]); return (value) => pattern.test(norm(value)); }
    if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'") && raw.at(-1) === raw[0]) {
      const exact = norm(raw.slice(1, -1));
      return (value) => norm(value) === exact;
    }
    const needle = norm(raw).toLowerCase();
    return (value) => norm(value).toLowerCase().includes(needle);
  };
  const roleOf = (element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit.trim().split(/\\s+/)[0].toLowerCase();
    const tag = element.tagName.toLowerCase();
    if (tag === "a" || tag === "area") return element.hasAttribute("href") ? "link" : null;
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return element.multiple || element.size > 1 ? "listbox" : "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (element.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      if (type === "number") return "spinbutton";
      if (type === "search") return element.hasAttribute("list") ? "combobox" : "searchbox";
      if (["email", "tel", "text", "url", "password"].includes(type)) return element.hasAttribute("list") ? "combobox" : "textbox";
      return null;
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return element.getAttribute("alt") === "" ? "presentation" : "img";
    const implicit = { li: "listitem", ul: "list", ol: "list", option: "option", nav: "navigation", main: "main",
      dialog: "dialog", table: "table", tr: "row", td: "cell", th: "columnheader", form: "form", article: "article",
      aside: "complementary", footer: "contentinfo", header: "banner", progress: "progressbar", hr: "separator",
      fieldset: "group", output: "status", menu: "list", dd: "definition", dt: "term" };
    if (implicit[tag]) return implicit[tag];
    if (element.isContentEditable) return "textbox";
    return null;
  };
  const labelOf = (element) => {
    const by = element.getAttribute("aria-labelledby");
    if (by) {
      const root = element.getRootNode();
      const text = by.split(/\\s+/).map((id) => (root.getElementById ? root.getElementById(id) : document.getElementById(id))?.textContent ?? "").join(" ");
      if (norm(text)) return norm(text);
    }
    const aria = element.getAttribute("aria-label");
    if (aria && norm(aria)) return norm(aria);
    if (element.labels && element.labels.length > 0) return norm([...element.labels].map((label) => label.innerText).join(" "));
    return "";
  };
  const nameOf = (element) => {
    const label = labelOf(element);
    if (label) return label;
    const tag = element.tagName.toLowerCase();
    if (tag === "input") {
      const type = (element.type || "").toLowerCase();
      if (["button", "submit", "reset"].includes(type)) return norm(element.value || (type === "submit" ? "Submit" : type === "reset" ? "Reset" : ""));
      if (type === "image") return norm(element.alt);
      return norm(element.placeholder || element.title);
    }
    if (tag === "img") return norm(element.alt || element.title);
    if (tag === "textarea" || tag === "select") return norm(element.placeholder || element.title);
    return norm(element.innerText || element.textContent || element.title);
  };
  const state = (element, name) => {
    switch (name) {
      case "checked": return element.checked === true || element.getAttribute("aria-checked") === "true" ? "true" : element.indeterminate || element.getAttribute("aria-checked") === "mixed" ? "mixed" : "false";
      case "disabled": return String(element.disabled === true || element.getAttribute("aria-disabled") === "true");
      case "expanded": return String(element.getAttribute("aria-expanded") === "true" || (element.tagName === "DETAILS" && element.open));
      case "pressed": return String(element.getAttribute("aria-pressed") === "true");
      case "selected": return String(element.selected === true || element.getAttribute("aria-selected") === "true");
      case "level": { const heading = /^H([1-6])$/.exec(element.tagName); return heading ? heading[1] : element.getAttribute("aria-level") ?? ""; }
      default: return undefined;
    }
  };
  const innermost = (matches) => matches.filter((element) => !matches.some((other) => other !== element && element.contains(other)));
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "HEAD", "TITLE", "META", "LINK"]);
  const engines = {
    css: (root, body) => deepAll(root, body),
    xpath: (root, body) => {
      const result = document.evaluate(body, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      const found = [];
      for (let index = 0; index < result.snapshotLength; index++) found.push(result.snapshotItem(index));
      return found.filter((node) => node instanceof Element);
    },
    text: (root, body) => {
      const match = matcher(body);
      return innermost(deepAll(root, "*").filter((element) => !SKIP.has(element.tagName) && match(element.textContent) && visible(element) && match(element.innerText ?? element.textContent)));
    },
    role: (root, body) => {
      const parsed = /^([a-z-]+)((?:\\[[^\\]]*\\])*)$/i.exec(body.trim());
      if (!parsed) throw new Error("invalid role selector: role=" + body);
      const role = parsed[1].toLowerCase();
      const filters = [...parsed[2].matchAll(/\\[\\s*([a-z-]+)\\s*(?:=\\s*("[^"]*"|'[^']*'|\\/.*?\\/[a-z]*|[^\\]]*))?\\s*\\]/gi)]
        .map((filter) => ({ name: filter[1].toLowerCase(), value: filter[2] === undefined ? "true" : filter[2] }));
      return deepAll(root, "*").filter((element) => {
        if (roleOf(element) !== role || !visible(element)) return false;
        return filters.every((filter) => {
          if (filter.name === "name") return matcher(filter.value)(nameOf(element));
          const actual = state(element, filter.name);
          if (actual === undefined) throw new Error("unsupported role filter: " + filter.name);
          return actual === filter.value.replace(/^["']|["']$/g, "");
        });
      });
    },
    label: (root, body) => {
      const match = matcher(body);
      return deepAll(root, "*").filter((element) => (element.labels || element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby")) && match(labelOf(element)));
    },
    placeholder: (root, body) => { const match = matcher(body); return deepAll(root, "[placeholder]").filter((element) => match(element.getAttribute("placeholder"))); },
    alt: (root, body) => { const match = matcher(body); return deepAll(root, "[alt]").filter((element) => match(element.getAttribute("alt"))); },
    title: (root, body) => { const match = matcher(body); return deepAll(root, "[title]").filter((element) => match(element.getAttribute("title"))); },
    testid: (root, body) => deepAll(root, "[data-testid]").filter((element) => element.getAttribute("data-testid") === body.trim().replace(/^["']|["']$/g, "")),
  };
  const splitParts = (selector) => {
    const parts = [];
    let current = "";
    let quote = null;
    for (let index = 0; index < selector.length; index++) {
      const char = selector[index];
      if (quote) { if (char === quote) quote = null; current += char; continue; }
      if (char === '"' || char === "'") { quote = char; current += char; continue; }
      if (char === ">" && selector[index + 1] === ">") { parts.push(current.trim()); current = ""; index++; continue; }
      current += char;
    }
    parts.push(current.trim());
    if (parts.some((part) => part === "")) throw new Error("invalid selector: " + selector);
    return parts;
  };
  const all = (selector) => {
    let current = [document];
    for (const part of splitParts(String(selector))) {
      const nth = /^nth=(-?\\d+)$/.exec(part);
      if (nth) {
        const index = Number(nth[1]);
        const picked = current.at(index);
        current = picked === undefined ? [] : [picked];
        continue;
      }
      if (part === "visible=true") { current = current.filter(visible); continue; }
      if (part === "visible=false") { current = current.filter((element) => !visible(element)); continue; }
      const engine = /^(css|xpath|text|role|label|placeholder|alt|title|testid)=([\\s\\S]*)$/.exec(part);
      const run = engine ? engines[engine[1]] : engines.css;
      const body = engine ? engine[2] : part;
      const next = [];
      for (const root of current) for (const element of run(root, body)) if (!next.includes(element)) next.push(element);
      current = next;
    }
    return current.filter((node) => node instanceof Element);
  };
  const one = (selector) => {
    const matches = all(selector);
    if (matches.length > 1) throw new Error(matches.length + " elements match " + selector + "; refine the selector or append >> nth=0");
    return matches[0] ?? null;
  };
  return { all, one, visible, nameOf, roleOf };
})();`;
/** Characters of exported page content returned to the model. */
const MAX_CONTENT_LENGTH = 1e5;
/**
* The page's visible content as Markdown: headings, paragraphs, links, emphasis,
* code, lists, tables, quotes, and images with alt text. Hidden elements are skipped.
*/
const PAGE_MARKDOWN = `(() => {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "HEAD", "BUTTON", "SELECT", "INPUT", "TEXTAREA"]);
  const BLOCK = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "NAV", "ASIDE", "FORM", "FIGURE", "FIGCAPTION", "DETAILS", "SUMMARY", "DL", "DT", "DD"]);
  const clean = (text) => text.replace(/[ \\t]+/g, " ");
  const render = (node, depth) => {
    if (node.nodeType === Node.TEXT_NODE) return clean(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node;
    if (SKIP.has(element.tagName)) return "";
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") return "";
    const children = () => [...element.childNodes].map((child) => render(child, depth)).join("");
    const tag = element.tagName;
    const heading = /^H([1-6])$/.exec(tag);
    if (heading) return "\\n\\n" + "#".repeat(Number(heading[1])) + " " + children().trim() + "\\n\\n";
    switch (tag) {
      case "P": return "\\n\\n" + children().trim() + "\\n\\n";
      case "BR": return "\\n";
      case "HR": return "\\n\\n---\\n\\n";
      case "A": { const text = children().trim(); return text && element.href && !element.href.startsWith("javascript:") ? "[" + text + "](" + element.href + ")" : text; }
      case "STRONG": case "B": { const text = children().trim(); return text ? "**" + text + "**" : ""; }
      case "EM": case "I": { const text = children().trim(); return text ? "*" + text + "*" : ""; }
      case "CODE": return element.closest("pre") ? element.textContent : "\`" + element.textContent + "\`";
      case "PRE": return "\\n\\n\`\`\`\\n" + element.innerText.replace(/\\n$/, "") + "\\n\`\`\`\\n\\n";
      case "IMG": return element.alt ? "![" + element.alt + "](" + element.src + ")" : "";
      case "BLOCKQUOTE": return "\\n\\n" + children().trim().split("\\n").map((line) => "> " + line).join("\\n") + "\\n\\n";
      case "UL": case "OL": {
        const items = [...element.children].filter((child) => child.tagName === "LI");
        const indent = "  ".repeat(depth);
        return "\\n\\n" + items.map((item, index) => {
          const body = [...item.childNodes].map((child) => render(child, depth + 1)).join("").trim().replace(/\\n{2,}/g, "\\n");
          return indent + (tag === "OL" ? (index + 1) + ". " : "- ") + body;
        }).join("\\n") + "\\n\\n";
      }
      case "TABLE": {
        const rows = [...element.rows].map((row) => "| " + [...row.cells].map((cell) => cell.innerText.replace(/\\s+/g, " ").trim().replace(/\\|/g, "\\\\|")).join(" | ") + " |");
        if (rows.length === 0) return "";
        const columns = element.rows[0].cells.length;
        rows.splice(1, 0, "| " + Array(columns).fill("---").join(" | ") + " |");
        return "\\n\\n" + rows.join("\\n") + "\\n\\n";
      }
      default: return BLOCK.has(tag) ? "\\n" + children() + "\\n" : children();
    }
  };
  const title = document.title ? "# " + document.title + "\\n\\n" : "";
  return (title + render(document.body ?? document.documentElement, 0)).replace(/[ \\t]+\\n/g, "\\n").replace(/\\n{3,}/g, "\\n\\n").trim();
})()`;
/**
* The open YouTube video's captions as timed lines, from the player's caption
* track or, when that track cannot be fetched, the transcript panel the page shows.
*/
const YOUTUBE_TRANSCRIPT = `(async () => {
  if (!/(^|\\.)youtube\\.com$/.test(location.hostname)) throw new Error("the page is not a YouTube video");
  const player = document.querySelector("#movie_player");
  const response = (player && typeof player.getPlayerResponse === "function" ? player.getPlayerResponse() : null) ?? window.ytInitialPlayerResponse;
  const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  const title = response?.videoDetails?.title ?? document.title;
  const track = tracks.find((candidate) => candidate.kind !== "asr") ?? tracks[0];
  if (track) {
    try {
      const reply = await fetch(track.baseUrl + "&fmt=json3", { credentials: "include" });
      const data = await reply.json();
      const lines = (data.events ?? []).filter((event) => Array.isArray(event.segs)).map((event) => ({
        seconds: Math.floor((event.tStartMs ?? 0) / 1000),
        text: event.segs.map((segment) => segment.utf8 ?? "").join("").replace(/\\s+/g, " ").trim(),
      })).filter((line) => line.text !== "");
      if (lines.length > 0) return { title, language: track.languageCode ?? null, lines };
    } catch {}
  }
  const segments = [...document.querySelectorAll("ytd-transcript-segment-renderer")];
  if (segments.length > 0) {
    return { title, language: null, lines: segments.map((segment) => {
      const stamp = (segment.querySelector(".segment-timestamp")?.textContent ?? "0:00").trim().split(":").map(Number);
      return { seconds: stamp.reduce((total, part) => total * 60 + (Number.isFinite(part) ? part : 0), 0), text: (segment.querySelector(".segment-text")?.textContent ?? "").replace(/\\s+/g, " ").trim() };
    }) };
  }
  throw new Error(tracks.length === 0 ? "this video has no captions" : "the captions could not be read; open the transcript panel and try again");
})()`;
//#endregion
//#region ../../packages/web/browser-engine/src/engine.ts
/**
* Agent actions on the sidebar guest. Native guest input preserves the app composer's focus;
* visible cursor arrival precedes discrete input.
*
* Action timing follows ChatGPT's browser agent: a pointer action moves the drawn
* cursor and waits up to {@link CURSOR_ARRIVAL_TIMEOUT_MS} for it to arrive, then
* moves the page's mouse there and presses. A click watches for a navigation it
* starts for {@link NAVIGATION_CLASSIFICATION_MS} from the moment the action begins, and
* waits up to {@link NAVIGATION_TIMEOUT_MS} for that navigation's document to load.
* A drag waits for the cursor only at its first point. A scroll waits for the cursor,
* then sends one native wheel event (ChatGPT's `mouseWheel` scroll method: an Electron
* guest acknowledges `Input.synthesizeScrollGesture` without scrolling), and returns
* once the scrolled position has settled.
*/
/** Whether a path is absolute on any platform the engine runs on. */
function isAbsolutePath(path) {
	return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(path);
}
/** The last segment of a path. */
function baseName(path) {
	return path.split(/[\\/]/).pop() ?? path;
}
/** Bytes a value's JSON takes in UTF-8. */
function jsonBytes(value) {
	return new TextEncoder().encode(JSON.stringify(value ?? null)).length;
}
/** Accessibility handles belong to one observation and one document. */
const accessibilityTargets = /* @__PURE__ */ new WeakMap();
/** Interactive elements a snapshot lists (t3code `MAX_INTERACTIVE_ELEMENTS`). */
const MAX_INTERACTIVE_ELEMENTS = 200;
/** Characters kept of each element's name. */
const MAX_INTERACTIVE_ELEMENT_NAME_LENGTH = 120;
/** Characters kept of the page's visible text. */
const MAX_VISIBLE_TEXT_LENGTH = 4e4;
/** Bytes an evaluated value may serialize to (t3code `MAX_EVALUATION_BYTES`). */
const MAX_EVALUATION_BYTES = 64e3;
/** Elements a `read` with `all` reports. */
const MAX_READ_ELEMENTS = 200;
/** Console entries kept per guest. */
const MAX_CONSOLE_ENTRIES = 500;
/** How long a pointer action waits for the drawn cursor to arrive, in ms (ChatGPT `lE`). */
const CURSOR_ARRIVAL_TIMEOUT_MS = 1500;
/** How long a pane control gesture may take, which can open the three-dot menu and a submenu first, in ms. */
const CONTROL_GESTURE_TIMEOUT_MS = 1e4;
/** How long after an action starts a navigation it caused must have begun, in ms (ChatGPT `classificationTimeoutMs`). */
const NAVIGATION_CLASSIFICATION_MS = 250;
/** How long a started navigation is given to load its document, in ms (ChatGPT default `timeout_ms`). */
const NAVIGATION_TIMEOUT_MS = 3e3;
/** How often a scroll's position is sampled while it settles, in ms. */
const SCROLL_SETTLE_POLL_MS = 50;
/** Longest a scroll waits for its position to settle, in ms. */
const SCROLL_SETTLE_MAX_MS = 1e3;
/** Pause between characters of a sequential type, in ms (ChatGPT `pressSequentially` `WP`). */
const SEQUENTIAL_TYPE_DELAY_MS = 50;
/** How far inside the page's top edge a scroll's pointer enters when it was outside the page, in CSS pixels. */
const SCROLL_ENTRY_INSET_PX = 24;
/** Where the pointer last arrived in each guest, in its viewport CSS pixels. */
const pointerAt = /* @__PURE__ */ new WeakMap();
/**
* Guests whose pointer is currently drawn inside the page. A chrome action leaves the pointer on
* the pane's own controls, where its page coordinates mean nothing: without this, a later scroll
* would start from a stale in-page point and the pointer would jump out of the chrome row.
*/
const pointerInPage = /* @__PURE__ */ new WeakSet();
/** Dialogs the guests are showing now. */
const openDialogs = /* @__PURE__ */ new WeakMap();
/** Console entries per guest, newest last. */
const consoleEntries = /* @__PURE__ */ new WeakMap();
/** Operations that still answer while a JavaScript dialog blocks the page. */
const DIALOG_SAFE = /* @__PURE__ */ new Set([
	"dialog",
	"console",
	"screenshot",
	"clipboard"
]);
/** Mouse button masks for `Input.dispatchMouseEvent` `buttons`. */
const BUTTON_MASK = {
	left: 1,
	right: 2,
	middle: 4
};
/** Modifier bits for `Input.dispatchMouseEvent` `modifiers`. */
const MODIFIER_BITS$1 = {
	Alt: 1,
	Control: 2,
	Meta: 4,
	Shift: 8
};
/**
* Record a guest's console output and JavaScript dialogs from its debugger events.
* The caller enables the Runtime and Page domains on the debugger session.
* @param guest - the guest whose page is observed.
* @returns disposer removing the listener.
*/
function observePage(guest) {
	const listen = (_event, method, params) => {
		const values = params;
		switch (method) {
			case "Page.javascriptDialogOpening":
				openDialogs.set(guest, {
					type: String(values.type),
					message: String(values.message ?? ""),
					...typeof values.defaultPrompt === "string" ? { defaultPrompt: values.defaultPrompt } : {},
					...typeof values.url === "string" ? { url: values.url } : {}
				});
				return;
			case "Page.javascriptDialogClosed":
				openDialogs.delete(guest);
				return;
			case "Runtime.consoleAPICalled": {
				const text = (Array.isArray(values.args) ? values.args : []).map((arg) => arg.value !== void 0 ? typeof arg.value === "string" ? arg.value : JSON.stringify(arg.value) : arg.description ?? arg.type ?? "").join(" ");
				const frame = values.stackTrace?.callFrames?.[0];
				record(guest, {
					level: String(values.type),
					text,
					...frame?.url === void 0 || frame.url === "" ? {} : { url: frame.url },
					...frame?.lineNumber === void 0 ? {} : { line: frame.lineNumber + 1 },
					time: Date.now()
				});
				return;
			}
			case "Runtime.exceptionThrown": {
				const details = values.exceptionDetails;
				record(guest, {
					level: "exception",
					text: details?.exception?.description ?? details?.text ?? "uncaught exception",
					...details?.url === void 0 ? {} : { url: details.url },
					...details?.lineNumber === void 0 ? {} : { line: details.lineNumber + 1 },
					time: Date.now()
				});
				return;
			}
		}
	};
	guest.debugger.on("message", listen);
	return () => {
		guest.debugger.off("message", listen);
		openDialogs.delete(guest);
	};
}
/**
* Append one console entry, dropping the oldest past {@link MAX_CONSOLE_ENTRIES}.
* @param guest - the guest that logged it.
* @param entry - the entry.
*/
function record(guest, entry) {
	const entries = consoleEntries.get(guest) ?? [];
	entries.push(entry);
	if (entries.length > MAX_CONSOLE_ENTRIES) entries.splice(0, entries.length - MAX_CONSOLE_ENTRIES);
	consoleEntries.set(guest, entries);
}
/**
* Wait without blocking the main process.
* @param ms - how long, in milliseconds.
* @param signal - abandons the wait.
*/
async function sleep(ms, signal) {
	await new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", abort);
			resolve();
		}, ms);
		const abort = () => {
			clearTimeout(timer);
			reject(signal?.reason);
		};
		signal?.addEventListener("abort", abort, { once: true });
	});
}
/** t3code `captureAutomationSnapshot`'s page expression, with each control's value and checked state. */
const SNAPSHOT = `(() => {
  const selectorFor = (element) => {
    if (element.id) return "#" + CSS.escape(element.id);
    for (const attribute of ["data-testid", "name"]) {
      const value = element.getAttribute(attribute);
      if (value) return element.tagName.toLowerCase() + "[" + attribute + "=" + JSON.stringify(value) + "]";
    }
    const buildParts = (current, parts = []) => {
      if (!current || current.nodeType !== Node.ELEMENT_NODE || parts.length >= 8) return parts;
      const parent = current.parentElement;
      const siblings = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName) : [];
      const base = current.tagName.toLowerCase();
      const part = siblings.length > 1 ? base + ":nth-of-type(" + (siblings.indexOf(current) + 1) + ")" : base;
      return buildParts(parent, [part, ...parts]);
    };
    return buildParts(element).join(" > ");
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const elements = Array.from(document.querySelectorAll(
    "a[href],button,input,textarea,select,[role],[tabindex],[contenteditable]:not([contenteditable=false])"
  )).filter(visible).slice(0, ${String(MAX_INTERACTIVE_ELEMENTS)}).map((element) => {
    const rect = element.getBoundingClientRect();
    const control = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
    const checkable = element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio");
    return {
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute("role"),
      name: (element.getAttribute("aria-label") || element.innerText || element.getAttribute("name") || element.getAttribute("placeholder") || "").slice(0, ${String(MAX_INTERACTIVE_ELEMENT_NAME_LENGTH)}),
      selector: selectorFor(element),
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      editable: element.isContentEditable || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement,
      disabled: element.disabled === true,
      ...(control && !checkable && element.type !== "password" ? { value: String(element.value ?? "").slice(0, ${String(MAX_INTERACTIVE_ELEMENT_NAME_LENGTH)}) } : {}),
      ...(checkable ? { checked: element.checked } : {})
    };
  });
  const frames = Array.from(document.querySelectorAll("iframe,frame")).filter(visible).slice(0, 20).map((frame) => ({ selector: selectorFor(frame), src: frame.src || null, title: frame.title || null }));
  return {
    url: location.href,
    title: document.title,
    loading: document.readyState !== "complete",
    visibleText: (document.body?.innerText || "").slice(0, ${String(MAX_VISIBLE_TEXT_LENGTH)}),
    interactiveElements: elements,
    ...(frames.length > 0 ? { frames } : {})
  };
})()`;
/**
* The page expression for the element an action names.
* @param input - the action's arguments.
* @param fallback - expression used when the action names no element.
* @returns an expression evaluating to the element or null, inside a {@link LOCATOR_PRELUDE} scope.
*/
function targetOf(input, fallback) {
	if (typeof input.token === "string") return "__aevenTarget";
	if (typeof input.selector === "string") return `__aevenLocate.one(${JSON.stringify(input.selector)})`;
	return fallback;
}
/**
* The selector the pane re-measures to keep its pointer on the action's element:
* plain CSS in the top document only, because the pane reads it with `querySelector`.
* @param input - the action's arguments.
* @returns cursor anchor metadata, empty for a locator, a frame, or no selector.
*/
function anchorOf(input) {
	if (typeof input.selector !== "string" || input.frame !== void 0) return {};
	if (input.selector.includes(">>") || /^(css|xpath|text|role|label|placeholder|alt|title|testid|nth|visible)=/.test(input.selector)) return {};
	return { selector: input.selector };
}
/**
* The page expression placing the pointer on an element: it scrolls the element
* into view only when part of it is outside the viewport, then reports its centre,
* clamped to the viewport. A scroll here is instant, so the point is measured
* after it lands rather than during a smooth scroll.
* @param target - expression evaluating to the element.
* @param actionable - whether a hidden or disabled element is refused.
* @returns the expression; it evaluates to the point, or null when no element matches.
*/
function pointExpression(target, actionable) {
	return `(() => {
    ${LOCATOR_PRELUDE}
    const element = ${target};
    if (!element) return null;
    if (${String(actionable)} && (element.disabled || getComputedStyle(element).visibility === "hidden" || element.getClientRects().length === 0)) throw new Error("the target is hidden or disabled");
    const clamp = (value, limit) => Math.min(Math.max(value, 0), limit);
    const before = element.getBoundingClientRect();
    if (before.top < 0 || before.left < 0 || before.bottom > innerHeight || before.right > innerWidth) element.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
    const rect = element.getBoundingClientRect();
    return { x: clamp(rect.left + rect.width / 2, innerWidth), y: clamp(rect.top + rect.height / 2, innerHeight) };
  })()`;
}
/**
* t3code `typeIntoAutomationTarget`'s page expression, up to the insertion:
* focus the target and select what `clear` replaces. Clearing with no text
* deletes the selection here, as there is nothing to type over it.
*/
function focusExpression(input) {
	const target = targetOf(input, "document.activeElement");
	const clear = input.clear === true;
	const text = typeof input.text === "string" ? input.text : void 0;
	return `(() => {
    ${LOCATOR_PRELUDE}
    const element = ${target};
    if (!element) return { notFound: true };
    const textControl =
      element instanceof HTMLTextAreaElement ||
      (element instanceof HTMLInputElement &&
        !new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]).has(element.type));
    const editable = textControl || element.isContentEditable;
    if (!editable || element.disabled || element.readOnly) return { notEditable: true };
    element.focus();
    if (element.getRootNode().activeElement !== element) return { focusFailed: true };
    if (${String(clear)}) {
      if (textControl) {
        element.select();
      } else {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = document.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
    if (${String(clear && text === void 0)} && !document.execCommand("delete", false)) return { notEditable: true };
    return { ok: true };
  })()`;
}
/** t3code `NAMED_KEYS`, reduced to the key names the native event needs. */
const NAMED_KEYS$1 = {
	Escape: { key: "Escape" },
	Backspace: { key: "Backspace" },
	Tab: { key: "Tab" },
	Enter: {
		key: "Enter",
		text: "\r"
	},
	Space: {
		key: " ",
		text: " "
	},
	PageUp: { key: "PageUp" },
	PageDown: { key: "PageDown" },
	End: { key: "End" },
	Home: { key: "Home" },
	ArrowLeft: { key: "ArrowLeft" },
	ArrowUp: { key: "ArrowUp" },
	ArrowRight: { key: "ArrowRight" },
	ArrowDown: { key: "ArrowDown" },
	Insert: { key: "Insert" },
	Delete: { key: "Delete" }
};
/**
* Press one key on the guest's own widget (t3code `makePreviewAutomationNativeKeySequence`).
* @param guest - the guest to type into.
* @param input - `key` and optional `modifiers`.
*/
function press(guest, input) {
	const named = NAMED_KEYS$1[input.key === " " ? "Space" : String(input.key)];
	const requested = (Array.isArray(input.modifiers) ? input.modifiers : []).map(String);
	const shifted = requested.includes("Shift");
	const key = named?.key ?? (/^[a-z]$/i.test(String(input.key)) && shifted ? String(input.key).toUpperCase() : String(input.key));
	const text = requested.some((modifier) => modifier !== "Shift") ? "" : named?.text ?? (key.length === 1 ? key : "");
	const modifiers = requested.map((modifier) => modifier.toLowerCase());
	const keyCode = key.startsWith("Arrow") ? key.slice(5) : key;
	guest.sendInputEvent({
		type: "keyDown",
		keyCode,
		modifiers
	});
	try {
		if (text !== "") guest.sendInputEvent({
			type: "char",
			keyCode: text,
			modifiers
		});
	} finally {
		guest.sendInputEvent({
			type: "keyUp",
			keyCode,
			modifiers
		});
	}
}
/**
* The modifier bit mask a mouse action holds.
* @param input - the action's arguments; `modifiers` lists Alt, Control, Meta, or Shift.
* @returns the CDP modifier bits.
*/
function modifierMask(input) {
	return (Array.isArray(input.modifiers) ? input.modifiers : []).reduce((mask, name) => mask | (MODIFIER_BITS$1[String(name)] ?? 0), 0);
}
/**
* Watch for a navigation an action starts, as ChatGPT's `waitForPageLoadEvent` does:
* a main-frame load that begins within {@link NAVIGATION_CLASSIFICATION_MS} of this call is
* waited for until its DOMContentLoaded or load event, up to {@link NAVIGATION_TIMEOUT_MS};
* a same-document navigation or a back-forward cache restore settles at once.
* @param guest - the guest whose main frame is watched.
* @param mainFrameId - the main frame's id now.
* @param signal - abandons the watch.
* @returns the settlement, which never rejects, and a cancel that settles it early.
*/
function watchNavigation(guest, mainFrameId, signal) {
	let finish = () => {};
	return {
		settled: new Promise((resolve) => {
			let started = false;
			let timer = setTimeout(() => {
				finish();
			}, NAVIGATION_CLASSIFICATION_MS);
			const listen = (_event, method, params) => {
				const values = params;
				switch (method) {
					case "Page.navigatedWithinDocument":
						if (values.frameId === mainFrameId) finish();
						return;
					case "Page.frameStartedLoading":
					case "Page.frameNavigated":
						if (!(method === "Page.frameNavigated" ? values.frame?.parentId === void 0 : values.frameId === mainFrameId)) return;
						if (method === "Page.frameNavigated" && values.type === "BackForwardCacheRestore") {
							finish();
							return;
						}
						if (started) return;
						started = true;
						clearTimeout(timer);
						timer = setTimeout(() => {
							finish();
						}, NAVIGATION_TIMEOUT_MS);
						return;
					case "Page.domContentEventFired":
					case "Page.loadEventFired":
						if (started) finish();
						return;
				}
			};
			finish = () => {
				clearTimeout(timer);
				guest.debugger.off("message", listen);
				signal.removeEventListener("abort", finish);
				resolve();
			};
			guest.debugger.on("message", listen);
			signal.addEventListener("abort", finish, { once: true });
		}),
		cancel: () => {
			finish();
		}
	};
}
/**
* Watch for a JavaScript dialog an action opens. A dialog blocks the page, so the
* input that opened it does not complete until the dialog is answered; the action
* returns when the dialog opens instead, and the agent answers it next.
* @param guest - the guest whose page is watched.
* @returns the dialog once one opens, and the disposer of the watch.
*/
function watchDialog(guest) {
	let dispose = () => {};
	return {
		opened: new Promise((resolve) => {
			const listen = (_event, method, params) => {
				if (method !== "Page.javascriptDialogOpening") return;
				const values = params;
				resolve({
					type: String(values.type),
					message: String(values.message ?? "")
				});
			};
			guest.debugger.on("message", listen);
			dispose = () => {
				guest.debugger.off("message", listen);
			};
		}),
		dispose
	};
}
/** The result fields that report a dialog an action opened. */
function dialogReport(dialog) {
	return {
		dialog,
		next: `the page opened a JavaScript ${dialog.type} dialog; answer it with preview_dialog before anything else`
	};
}
/** File extensions and Google export formats a document kind accepts. */
const GOOGLE_EXPORTS = {
	document: [
		"docx",
		"pdf",
		"md",
		"txt",
		"odt",
		"rtf",
		"epub"
	],
	spreadsheets: [
		"xlsx",
		"csv",
		"pdf",
		"ods",
		"tsv"
	],
	presentation: [
		"pptx",
		"pdf",
		"txt",
		"odp"
	]
};
/**
* Perform one agent action on a guest.
* @param guest - the browser guest; its debugger is attached here when needed.
* @param operation - browser operation named by the tool or pane.
* @param input - the tool's arguments.
* @param signal - execution lifetime supplied by the owning request.
* @param host - local files, downloads, and clipboard where the engine runs.
* @returns the action's JSON result.
* @throws {Error} when the operation is unknown or the page refuses the action.
*/
async function automate(guest, operation, input, signal = new AbortController().signal, host = {}) {
	signal.throwIfAborted();
	if (!guest.debugger.isAttached()) guest.debugger.attach("1.3");
	const send = async (method, params) => {
		signal.throwIfAborted();
		const result = await guest.debugger.sendCommand(method, params);
		signal.throwIfAborted();
		return result;
	};
	const dialog = openDialogs.get(guest);
	if (dialog !== void 0 && !DIALOG_SAFE.has(operation)) throw new Error(`a JavaScript ${dialog.type} dialog is open ("${dialog.message}") and blocks the page; call preview_dialog to accept or dismiss it`);
	let targetObjectId;
	if (input.token !== void 0) {
		if (![
			"click",
			"type",
			"hover",
			"check",
			"read",
			"select"
		].includes(operation) || typeof input.token !== "string" || input.selector !== void 0 || input.x !== void 0 || input.y !== void 0 || input.frame !== void 0) throw new Error("an accessibility token is an exclusive target for click, type, hover, check, select, or read");
		const targets = accessibilityTargets.get(guest);
		const tree = await send("Page.getFrameTree");
		const backendNodeId = targets?.nodes.get(input.token);
		if (backendNodeId === void 0 || tree.frameTree.frame.loaderId !== targets?.loaderId) throw new Error("stale accessibility token; take a new preview_snapshot with mode ax");
		targetObjectId = (await send("DOM.resolveNode", { backendNodeId })).object.objectId;
		if (targetObjectId === void 0) throw new Error("the accessibility target disappeared; take a new snapshot");
		if ((await send("Runtime.callFunctionOn", {
			objectId: targetObjectId,
			functionDeclaration: "function(){return this.nodeType === 1 && this.isConnected && !this.disabled && this.getClientRects().length > 0 && getComputedStyle(this).visibility !== \"hidden\"}",
			returnByValue: true
		})).result?.value !== true) {
			await guest.debugger.sendCommand("Runtime.releaseObject", { objectId: targetObjectId });
			accessibilityTargets.delete(guest);
			throw new Error("the accessibility target is detached, hidden, or disabled; take a new snapshot");
		}
	}
	if (operation !== "snapshot") accessibilityTargets.delete(guest);
	let frameContextId;
	let frameObjectId;
	if (input.frame !== void 0) {
		if (typeof input.frame !== "string" || input.frame === "") throw new Error("frame must be a selector of an iframe");
		const owner = await send("Runtime.evaluate", {
			expression: `(() => { ${LOCATOR_PRELUDE} const frame = __aevenLocate.one(${JSON.stringify(input.frame)}); if (!frame) throw new Error("no iframe matches the frame selector"); if (!(frame instanceof HTMLIFrameElement || frame instanceof HTMLFrameElement)) throw new Error("the frame selector matches an element that is not an iframe"); return frame; })()`,
			returnByValue: false
		});
		if (owner.exceptionDetails !== void 0) throw new Error(owner.exceptionDetails.exception?.description ?? owner.exceptionDetails.text ?? "the frame selector failed");
		frameObjectId = owner.result?.objectId;
		if (frameObjectId === void 0) throw new Error("no iframe matches the frame selector");
		const described = await send("DOM.describeNode", { objectId: frameObjectId });
		if (described.node.frameId === void 0) throw new Error("the iframe has no document yet");
		frameContextId = (await send("Page.createIsolatedWorld", {
			frameId: described.node.frameId,
			worldName: "aeven-browser",
			grantUniveralAccess: false
		})).executionContextId;
	}
	const evaluate = async (expression) => {
		signal.throwIfAborted();
		if (targetObjectId !== void 0) {
			const response = await send("Runtime.callFunctionOn", {
				objectId: targetObjectId,
				functionDeclaration: `function(){return ${expression.replaceAll("__aevenTarget", "this")}}`,
				returnByValue: true,
				awaitPromise: true,
				userGesture: true
			});
			if (response.exceptionDetails !== void 0) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "accessibility target evaluation failed");
			return response.result?.value;
		}
		const response = await send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
			userGesture: true,
			...frameContextId === void 0 ? {} : { contextId: frameContextId }
		});
		if (response.exceptionDetails !== void 0) throw new Error((response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "evaluation failed").split("\n")[0]?.replace(/^Error: /, ""));
		return response.result?.value;
	};
	/** Move a point measured inside the action's frame into the top viewport. */
	const toTop = async (point) => {
		if (frameObjectId === void 0) return point;
		const offset = (await send("Runtime.callFunctionOn", {
			objectId: frameObjectId,
			functionDeclaration: "function(){const r=this.getBoundingClientRect();return {x:r.left+this.clientLeft,y:r.top+this.clientTop}}",
			returnByValue: true
		})).result?.value ?? {
			x: 0,
			y: 0
		};
		return {
			x: point.x + offset.x,
			y: point.y + offset.y
		};
	};
	/** Where an action's target is, or its x and y; scrolled into view when needed. */
	const pointFor = async (target, fallback, actionable) => {
		if (typeof target.token !== "string" && typeof target.selector !== "string" && typeof target.x === "number" && typeof target.y === "number") return {
			x: target.x,
			y: target.y
		};
		if (typeof target.token !== "string" && typeof target.selector !== "string" && fallback === null) throw new Error("name the target with selector, token, or x and y");
		const point = await evaluate(pointExpression(targetOf(target, fallback ?? "null"), actionable));
		if (point === null) throw new Error(`no element matches ${String(target.selector ?? "the target")}; call preview_snapshot for current selectors`);
		return await toTop(point);
	};
	/** Discrete actions wait for the pointer to arrive; continuous updates do not. */
	const show = (cursor, wait = false, timeoutMs = CURSOR_ARRIVAL_TIMEOUT_MS) => {
		signal.throwIfAborted();
		return guest.presentCursor(cursor, wait, timeoutMs, signal);
	};
	/** ChatGPT `dispatchMouseMove`: the drawn cursor arrives, then the page's mouse moves there. */
	const moveTo = async (point, anchor = {}, modifiers = 0) => {
		await show({
			action: "move",
			...point,
			...anchor
		}, true);
		await send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			button: "none",
			buttons: 0,
			modifiers,
			...point
		});
		pointerAt.set(guest, point);
		pointerInPage.add(guest);
	};
	/**
	* ChatGPT `clickPoint`: arrival, mouse move, one press and release per click count, then the navigation wait.
	* @returns the dialog the click opened, or null.
	*/
	const clickAt = async (point, anchor, options) => {
		const navigation = watchNavigation(guest, (await send("Page.getFrameTree")).frameTree.frame.id, signal);
		const dialog = watchDialog(guest);
		try {
			await send("Emulation.setFocusEmulationEnabled", { enabled: true });
			await moveTo(point, anchor, options.modifiers);
			const pressing = (async () => {
				for (let count = 1; count <= options.clickCount; count++) {
					await send("Input.dispatchMouseEvent", {
						type: "mousePressed",
						...point,
						button: options.button,
						buttons: BUTTON_MASK[options.button],
						clickCount: count,
						modifiers: options.modifiers
					});
					await send("Input.dispatchMouseEvent", {
						type: "mouseReleased",
						...point,
						button: options.button,
						buttons: 0,
						clickCount: count,
						modifiers: options.modifiers
					});
				}
				return null;
			})();
			const opened = await Promise.race([pressing, dialog.opened]);
			if (opened !== null) {
				pressing.catch(() => void 0);
				navigation.cancel();
				return opened;
			}
			const settled = await Promise.race([navigation.settled.then(() => null), dialog.opened]);
			signal.throwIfAborted();
			return settled;
		} catch (error) {
			navigation.cancel();
			throw error;
		} finally {
			dialog.dispose();
		}
	};
	/**
	* The pointer has left the page for the pane's own chrome row.
	*
	* Its page position stops applying, so a later scroll enters the page deliberately at that
	* horizontal position instead of starting from a place the pointer is no longer at.
	*/
	const leavePage = () => {
		pointerInPage.delete(guest);
	};
	/** Where a scroll with no named target starts: the pointer's own place when it is in the page, else just inside the top edge. */
	const scrollOrigin = async () => {
		const viewport = await evaluate("({ w: innerWidth, h: innerHeight })");
		const previous = pointerAt.get(guest);
		if (pointerInPage.has(guest) && previous !== void 0) return previous;
		return {
			x: previous === void 0 ? viewport.w / 2 : Math.min(Math.max(previous.x, 0), viewport.w),
			y: SCROLL_ENTRY_INSET_PX
		};
	};
	try {
		switch (operation) {
			case "upload": {
				if (frameContextId !== void 0) throw new Error("upload inside an iframe is unsupported; use a main-page file input");
				const requested = input.paths;
				if (!Array.isArray(requested) || requested.length === 0 || !requested.every((path) => typeof path === "string" && isAbsolutePath(path))) throw new Error("upload requires absolute file paths on the computer running this browser");
				if (host.resolveFiles === void 0) throw new Error("this browser cannot attach files from the computer");
				const files = await host.resolveFiles(requested);
				signal.throwIfAborted();
				if (typeof input.origin !== "string" || new URL(guest.getURL()).origin !== input.origin) throw new Error("the page origin changed; request upload approval again");
				const selector = typeof input.selector === "string" ? input.selector : "input[type=file]";
				await moveTo(await pointFor({ selector }, null, false), anchorOf(input));
				let backendNodeId;
				/** The chooser's own selection mode, recorded by the debugger handler that owns the frame. */
				const chooserMode = { multiple: false };
				let chooserFrame;
				let resolveChooser;
				let rejectChooser;
				const chooser = new Promise((resolve, reject) => {
					resolveChooser = resolve;
					rejectChooser = reject;
				});
				chooser.catch(() => {});
				const cancelChooser = () => {
					rejectChooser?.(signal.reason);
				};
				const opened = (_event, method, params) => {
					if (method !== "Page.fileChooserOpened" || typeof params !== "object" || params === null || !("backendNodeId" in params) || typeof params.backendNodeId !== "number") return;
					backendNodeId = params.backendNodeId;
					chooserFrame = "frameId" in params && typeof params.frameId === "string" ? params.frameId : void 0;
					chooserMode.multiple = "mode" in params && params.mode === "selectMultiple";
					resolveChooser?.();
				};
				guest.debugger.on("message", opened);
				try {
					await send("Page.enable");
					const frames = await send("Page.getFrameTree");
					const node = await send("Runtime.evaluate", {
						expression: `(() => {
            ${LOCATOR_PRELUDE}
            const nodes = __aevenLocate.all(${JSON.stringify(selector)});
            if (nodes.length > 1) throw new Error("the upload selector matches multiple elements; choose one file input");
            return nodes[0] ?? null;
          })()`,
						returnByValue: false
					});
					if (node.exceptionDetails !== void 0) throw new Error("the upload selector is invalid or ambiguous; choose one target");
					if (node.result?.objectId === void 0) throw new Error("no upload target matches; provide the file input or Upload button selector");
					const objectId = node.result.objectId;
					try {
						const info = await send("Runtime.callFunctionOn", {
							objectId,
							functionDeclaration: "function(){return {file:this instanceof HTMLInputElement && this.type === \"file\",multiple:this.multiple,disabled:this.disabled}}",
							returnByValue: true
						});
						if (info.result?.value?.disabled === true) throw new Error("the upload target is disabled");
						if (info.result?.value?.file === true) {
							if (files.length > 1 && info.result.value.multiple !== true) throw new Error("the file input does not accept multiple files");
							backendNodeId = (await send("DOM.describeNode", { objectId })).node.backendNodeId;
						} else {
							signal.addEventListener("abort", cancelChooser, { once: true });
							await send("Page.setInterceptFileChooserDialog", { enabled: true });
							await send("Runtime.callFunctionOn", {
								objectId,
								functionDeclaration: "function(){this.click()}",
								userGesture: true
							});
							let timer;
							try {
								await Promise.race([chooser, new Promise((_resolve, reject) => {
									timer = setTimeout(() => {
										reject(/* @__PURE__ */ new Error("the upload control did not open a file chooser; provide the file input selector"));
									}, 5e3);
								})]);
								signal.throwIfAborted();
							} finally {
								if (timer !== void 0) clearTimeout(timer);
							}
							if (chooserFrame !== frames.frameTree.frame.id) throw new Error("upload choosers in embedded frames are unsupported; use a main-page file input");
							if (files.length > 1 && !chooserMode.multiple) throw new Error("the chooser does not accept multiple files");
						}
						if (new URL(guest.getURL()).origin !== input.origin) throw new Error("the page origin changed before upload");
						await send("DOM.setFileInputFiles", {
							backendNodeId,
							files
						});
						return {
							ok: true,
							files: files.map((file) => baseName(file))
						};
					} finally {
						if (guest.debugger.isAttached()) await guest.debugger.sendCommand("Runtime.releaseObject", { objectId });
					}
				} finally {
					signal.removeEventListener("abort", cancelChooser);
					guest.debugger.off("message", opened);
					if (guest.debugger.isAttached()) await guest.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: false });
				}
			}
			case "wait": {
				const timeoutMs = input.timeoutMs ?? 5e3;
				if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 6e4) throw new Error("wait timeout must be between 1 and 60000ms");
				if (input.state !== void 0 && input.state !== "visible" && input.state !== "hidden" && input.state !== "attached" && input.state !== "detached") throw new Error("wait state must be visible, hidden, attached, or detached");
				if (input.load !== void 0 && input.load !== "load" && input.load !== "domcontentloaded") throw new Error("wait load must be load or domcontentloaded");
				const hasSelector = typeof input.selector === "string" && input.selector.length > 0;
				const hasUrl = typeof input.url === "string" && input.url.length > 0;
				if (!hasSelector && !hasUrl && input.load === void 0) throw new Error("wait requires a selector, a url, or a load state");
				const urlMatches = (url) => {
					const wanted = String(input.url);
					const regex = /^\/(.*)\/([a-z]*)$/s.exec(wanted);
					return regex === null ? url.includes(wanted) : new RegExp(regex[1] ?? "", regex[2]).test(url);
				};
				const deadline = Date.now() + timeoutMs;
				for (;;) {
					let ready = true;
					if (hasUrl) ready &&= urlMatches(guest.getURL());
					if (ready && input.load !== void 0) {
						const state = await evaluate("document.readyState");
						ready = input.load === "load" ? state === "complete" : state !== "loading";
					}
					if (ready && hasSelector) ready = await evaluate(`(() => {
              ${LOCATOR_PRELUDE}
              const nodes = __aevenLocate.all(${JSON.stringify(input.selector)});
              const state = ${JSON.stringify(input.state ?? "visible")};
              if (state === "attached") return nodes.length > 0;
              if (state === "detached") return nodes.length === 0;
              if (nodes.length > 1) throw new Error("the wait selector matches multiple elements");
              const element = nodes[0];
              const visible = !!element && __aevenLocate.visible(element);
              if (state === "hidden") return !visible;
              return visible && !element.disabled;
            })()`) === true;
					if (ready) return {
						ok: true,
						url: guest.getURL()
					};
					if (Date.now() >= deadline) throw new Error(`timed out after ${String(timeoutMs)}ms waiting for ${[
						hasSelector ? String(input.selector) : "",
						hasUrl ? `url ${String(input.url)}` : "",
						input.load === void 0 ? "" : `${String(input.load)}`
					].filter((part) => part !== "").join(", ")}`);
					await sleep(25, signal);
				}
			}
			case "sequence": {
				if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > 20) throw new Error("sequence requires 1 to 20 actions");
				const allowed = [
					"click",
					"type",
					"press",
					"upload",
					"wait",
					"hover",
					"select",
					"check",
					"scroll"
				];
				for (const action of input.actions) {
					if (typeof action !== "object" || action === null || Array.isArray(action) || !("operation" in action)) throw new Error("sequence actions must name an operation");
					const values = action;
					if (!allowed.includes(String(values.operation))) throw new Error(`sequence supports ${allowed.join(", ")}`);
					if ([
						"click",
						"hover",
						"select",
						"check"
					].includes(String(values.operation)) && typeof values.selector !== "string") throw new Error(`${String(values.operation)} requires a selector`);
					if (values.operation === "type" && typeof values.text !== "string") throw new Error("type requires text");
					if (values.operation === "press" && typeof values.key !== "string") throw new Error("press requires a key");
					if (values.operation === "select" && !Array.isArray(values.values)) throw new Error("select requires values");
					if (values.operation === "check" && typeof values.checked !== "boolean") throw new Error("check requires checked");
					if (values.operation === "upload" && (!Array.isArray(values.paths) || values.paths.length === 0 || !values.paths.every((path) => typeof path === "string" && isAbsolutePath(path)))) throw new Error("upload requires absolute file paths");
				}
				let completed = 0;
				for (const action of input.actions) try {
					await automate(guest, String(action.operation), action, signal, host);
					completed++;
				} catch (error) {
					signal.throwIfAborted();
					return {
						ok: false,
						completed,
						failedAction: completed + 1,
						error: error instanceof Error ? error.message : String(error)
					};
				}
				return {
					ok: true,
					completed
				};
			}
			case "screenshot": return {
				data: (await send("Page.captureScreenshot", {
					format: "jpeg",
					quality: 80,
					captureBeyondViewport: false
				})).data,
				mimeType: "image/jpeg"
			};
			case "snapshot": {
				accessibilityTargets.delete(guest);
				if (input.mode !== "ax") return await evaluate(SNAPSHOT);
				if (frameContextId !== void 0) throw new Error("mode ax reads the top document; use mode dom inside a frame");
				const tree = await send("Page.getFrameTree");
				await send("Accessibility.enable");
				const result = await send("Accessibility.getFullAXTree");
				const snapshotId = crypto.randomUUID();
				const targets = /* @__PURE__ */ new Map();
				const visible = result.nodes.filter((node) => !node.ignored);
				const nodes = visible.slice(0, MAX_INTERACTIVE_ELEMENTS).map((node, index) => {
					const token = `${snapshotId}:${index}`;
					if (node.backendDOMNodeId !== void 0) targets.set(token, node.backendDOMNodeId);
					const properties = new Map(node.properties?.map((property) => [property.name, property.value.value]));
					return {
						index,
						token,
						role: node.role?.value ?? "unknown",
						title: node.name?.value.slice(0, MAX_INTERACTIVE_ELEMENT_NAME_LENGTH),
						value: node.value?.value.slice(0, MAX_INTERACTIVE_ELEMENT_NAME_LENGTH),
						editable: properties.get("editable") !== void 0,
						...properties.has("checked") ? { checked: properties.get("checked") } : {},
						...properties.get("disabled") === true ? { disabled: true } : {}
					};
				});
				if ((await send("Page.getFrameTree")).frameTree.frame.loaderId !== tree.frameTree.frame.loaderId) throw new Error("the page navigated during observation; take a new snapshot");
				accessibilityTargets.set(guest, {
					snapshotId,
					loaderId: tree.frameTree.frame.loaderId,
					nodes: targets
				});
				return {
					url: guest.getURL(),
					title: guest.getTitle(),
					snapshotId,
					nodes,
					truncated: visible.length > MAX_INTERACTIVE_ELEMENTS
				};
			}
			case "click": {
				const clickCount = input.clickCount === void 0 ? 1 : Number(input.clickCount);
				if (!Number.isInteger(clickCount) || clickCount < 1 || clickCount > 3) throw new Error("clickCount must be 1, 2, or 3");
				const button = input.button === void 0 ? "left" : input.button;
				if (button !== "left" && button !== "right" && button !== "middle") throw new Error("button must be left, right, or middle");
				const dialog = await clickAt(await pointFor(input, null, true), anchorOf(input), {
					button,
					clickCount,
					modifiers: modifierMask(input)
				});
				return {
					ok: true,
					url: guest.getURL(),
					...dialog === null ? {} : dialogReport(dialog)
				};
			}
			case "hover":
				await moveTo(await pointFor(input, null, false), anchorOf(input), modifierMask(input));
				return { ok: true };
			case "drag": {
				const from = input.from;
				const to = input.to;
				if (typeof from !== "object" || from === null || typeof to !== "object" || to === null) throw new Error("drag requires from and to, each a selector or x and y");
				const start = await pointFor(from, null, false);
				const end = await pointFor(to, null, false);
				const modifiers = modifierMask(input);
				await send("Emulation.setFocusEmulationEnabled", { enabled: true });
				await moveTo(start, {}, modifiers);
				await send("Input.dispatchMouseEvent", {
					type: "mousePressed",
					...start,
					button: "left",
					buttons: 1,
					clickCount: 1,
					modifiers
				});
				let released = false;
				let last = start;
				try {
					show({
						action: "move",
						...end
					});
					last = end;
					await send("Input.dispatchMouseEvent", {
						type: "mouseMoved",
						...end,
						button: "left",
						buttons: 1,
						modifiers
					});
					released = true;
					await send("Input.dispatchMouseEvent", {
						type: "mouseReleased",
						...end,
						button: "left",
						buttons: 0,
						clickCount: 1,
						modifiers
					});
				} finally {
					if (!released && guest.debugger.isAttached()) await guest.debugger.sendCommand("Input.dispatchMouseEvent", {
						type: "mouseReleased",
						...last,
						button: "left",
						buttons: 0,
						clickCount: 1,
						modifiers
					}).catch(() => void 0);
				}
				pointerAt.set(guest, end);
				return { ok: true };
			}
			case "select": {
				const values = input.values;
				if (!Array.isArray(values) || values.length === 0 || !values.every((value) => typeof value === "string")) throw new Error("select requires values: option values or labels");
				await moveTo(await pointFor(input, null, true), anchorOf(input));
				const result = await evaluate(`(() => {
          ${LOCATOR_PRELUDE}
          const element = ${targetOf(input, "null")};
          if (!element) return { notFound: true };
          if (!(element instanceof HTMLSelectElement)) return { notSelect: true };
          if (element.disabled) return { disabled: true };
          const wanted = ${JSON.stringify(values)};
          const options = [...element.options];
          const picked = wanted.map((value) => options.find((option) => option.value === value)
            ?? options.find((option) => option.label.trim() === value.trim())
            ?? options.find((option) => option.label.trim().toLowerCase() === value.trim().toLowerCase()));
          if (picked.some((option) => !option)) return { missing: wanted.filter((_value, index) => !picked[index]), available: options.slice(0, 50).map((option) => ({ value: option.value, label: option.label })) };
          if (!element.multiple && picked.length > 1) return { notMultiple: true };
          for (const option of options) option.selected = picked.includes(option);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          return { selected: picked.map((option) => option.value) };
        })()`);
				if (result.notFound === true) throw new Error("no element matches the target; call preview_snapshot for current selectors");
				if (result.notSelect === true) throw new Error("the target is not a <select>; open the custom dropdown with preview_click and click its option");
				if (result.disabled === true) throw new Error("the select is disabled");
				if (result.notMultiple === true) throw new Error("the select accepts one option");
				if (result.missing !== void 0) throw new Error(`no option matches ${result.missing.join(", ")}; available: ${JSON.stringify(result.available)}`);
				return {
					ok: true,
					selected: result.selected
				};
			}
			case "check": {
				if (typeof input.checked !== "boolean") throw new Error("check requires checked: true or false");
				const stateExpression = `(() => {
          ${LOCATOR_PRELUDE}
          const element = ${targetOf(input, "null")};
          if (!element) return { notFound: true };
          const native = element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio");
          const aria = element.getAttribute("aria-checked");
          if (!native && aria === null) return { notCheckable: true };
          return { checked: native ? element.checked : aria === "true" };
        })()`;
				const before = await evaluate(stateExpression);
				if (before.notFound === true) throw new Error("no element matches the target; call preview_snapshot for current selectors");
				if (before.notCheckable === true) throw new Error("the target is not a checkbox, radio, or aria-checked control");
				if (before.checked === input.checked) return {
					ok: true,
					checked: input.checked,
					changed: false
				};
				const dialog = await clickAt(await pointFor(input, null, true), anchorOf(input), {
					button: "left",
					clickCount: 1,
					modifiers: 0
				});
				if (dialog !== null) return {
					ok: true,
					changed: true,
					...dialogReport(dialog)
				};
				if ((await evaluate(stateExpression)).checked !== input.checked) throw new Error(`clicking the control did not make it ${input.checked ? "checked" : "unchecked"}`);
				return {
					ok: true,
					checked: input.checked,
					changed: true
				};
			}
			case "read": {
				const property = input.property ?? "text";
				if (![
					"text",
					"innerText",
					"html",
					"value",
					"attribute",
					"count",
					"visible",
					"enabled",
					"checked",
					"box"
				].includes(String(property))) throw new Error("read property must be text, innerText, html, value, attribute, count, visible, enabled, checked, or box");
				if (property === "attribute" && typeof input.name !== "string") throw new Error("read attribute requires name");
				if (targetObjectId === void 0 && typeof input.selector !== "string") throw new Error("read requires a selector or token");
				const value = await evaluate(`(() => {
          ${LOCATOR_PRELUDE}
          const nodes = ${targetObjectId === void 0 ? `__aevenLocate.all(${JSON.stringify(input.selector)})` : "[__aevenTarget]"};
          const property = ${JSON.stringify(property)};
          if (property === "count") return nodes.length;
          const read = (element) => {
            switch (property) {
              case "text": return (element.textContent ?? "").replace(/\\s+/g, " ").trim();
              case "innerText": return element.innerText ?? element.textContent ?? "";
              case "html": return element.outerHTML;
              case "value": return "value" in element ? String(element.value) : null;
              case "attribute": return element.getAttribute(${JSON.stringify(input.name ?? "")});
              case "visible": return __aevenLocate.visible(element);
              case "enabled": return !element.disabled && element.getAttribute("aria-disabled") !== "true";
              case "checked": return element instanceof HTMLInputElement ? element.checked : element.getAttribute("aria-checked") === "true";
              case "box": { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }
            }
          };
          if (${String(input.all === true)}) return { values: nodes.slice(0, ${String(MAX_READ_ELEMENTS)}).map(read), count: nodes.length };
          if (nodes.length === 0) throw new Error("no element matches the target; call preview_snapshot for current selectors");
          if (nodes.length > 1) throw new Error(nodes.length + " elements match; pass all: true or refine the selector");
          return { value: read(nodes[0]) };
        })()`);
				if (jsonBytes(value) > MAX_EVALUATION_BYTES) throw new Error(`the result is larger than ${String(MAX_EVALUATION_BYTES)} bytes; narrow the selector`);
				return typeof value === "number" ? { count: value } : value;
			}
			case "content": {
				const format = input.format ?? "markdown";
				if (format === "youtube_transcript") {
					const transcript = await evaluate(YOUTUBE_TRANSCRIPT);
					const stamp = (seconds) => `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
					const text = transcript.lines.map((line) => `[${stamp(line.seconds)}] ${line.text}`).join("\n");
					return {
						title: transcript.title,
						language: transcript.language,
						text: text.slice(0, MAX_CONTENT_LENGTH),
						truncated: text.length > MAX_CONTENT_LENGTH
					};
				}
				const expression = format === "markdown" ? PAGE_MARKDOWN : format === "text" ? "(document.body?.innerText ?? \"\")" : format === "html" ? "document.documentElement.outerHTML" : void 0;
				if (expression === void 0) throw new Error("content format must be markdown, text, html, or youtube_transcript");
				const text = String(await evaluate(expression) ?? "");
				return {
					url: guest.getURL(),
					title: guest.getTitle(),
					format,
					text: text.slice(0, MAX_CONTENT_LENGTH),
					truncated: text.length > MAX_CONTENT_LENGTH,
					length: text.length
				};
			}
			case "export": {
				const page = new URL(guest.getURL());
				const match = /^\/(document|spreadsheets|presentation)\/d\/([^/]+)/.exec(page.pathname);
				if (page.hostname !== "docs.google.com" || match === null) throw new Error("export works on an open Google Docs, Sheets, or Slides document");
				const kind = match[1] ?? "document";
				const id = match[2] ?? "";
				const formats = GOOGLE_EXPORTS[kind] ?? [];
				const format = typeof input.format === "string" ? input.format : formats[0];
				if (format === void 0 || !formats.includes(format)) throw new Error(`a ${kind} exports as ${formats.join(", ")}`);
				const gid = /[#&?]gid=(\d+)/.exec(page.href)?.[1];
				const url = `https://docs.google.com/${kind}/d/${id}/export?format=${format}${gid !== void 0 && (format === "csv" || format === "tsv") ? `&gid=${gid}` : ""}`;
				const response = await guest.session.fetch(url, { signal });
				if (!response.ok) throw new Error(`Google answered the export with HTTP ${String(response.status)}; the document may not allow downloads`);
				if ((response.headers.get("content-type") ?? "").startsWith("text/html")) throw new Error("Google answered with a page instead of the file; sign in or ask the owner for download access");
				const bytes = new Uint8Array(await response.arrayBuffer());
				const title = guest.getTitle().replace(/ - Google (Docs|Sheets|Slides)$/, "").replace(/[\\/:*?"<>|]+/g, " ").trim() || "export";
				const text = [
					"md",
					"txt",
					"csv",
					"tsv"
				].includes(format) ? new TextDecoder().decode(bytes) : void 0;
				if (host.saveDownload === void 0 && text === void 0) throw new Error("this browser cannot save files; export as md, txt, csv, or tsv to read the content");
				const path = host.saveDownload === void 0 ? void 0 : await host.saveDownload(`${title}.${format}`, bytes);
				return {
					ok: true,
					format,
					bytes: bytes.length,
					...path === void 0 ? {} : { path },
					...text === void 0 ? {} : {
						text: text.slice(0, MAX_CONTENT_LENGTH),
						truncated: text.length > MAX_CONTENT_LENGTH
					}
				};
			}
			case "clipboard":
				if (host.clipboard === void 0) throw new Error("this browser cannot reach the computer's clipboard");
				if (input.action === "read") return { text: await host.clipboard.readText() };
				if (input.action === "write") {
					if (typeof input.text !== "string") throw new Error("clipboard write requires text");
					await host.clipboard.writeText(input.text);
					return { ok: true };
				}
				throw new Error("clipboard action must be read or write");
			case "console": {
				const entries = consoleEntries.get(guest) ?? [];
				const levels = Array.isArray(input.levels) ? input.levels.map(String) : void 0;
				const limit = typeof input.limit === "number" && Number.isInteger(input.limit) && input.limit > 0 ? Math.min(input.limit, MAX_CONSOLE_ENTRIES) : 100;
				const matching = entries.filter((entry) => levels === void 0 || levels.includes(entry.level));
				const result = {
					entries: matching.slice(-limit).map((entry) => ({
						...entry,
						text: entry.text.slice(0, 2e3)
					})),
					total: matching.length
				};
				if (input.clear === true) consoleEntries.delete(guest);
				return result;
			}
			case "dialog": {
				const open = openDialogs.get(guest);
				if (input.action === void 0) return open === void 0 ? { open: false } : {
					open: true,
					...open
				};
				if (input.action !== "accept" && input.action !== "dismiss") throw new Error("dialog action must be accept or dismiss");
				if (open === void 0) throw new Error("no JavaScript dialog is open");
				await send("Page.handleJavaScriptDialog", {
					accept: input.action === "accept",
					...typeof input.promptText === "string" ? { promptText: input.promptText } : {}
				});
				guest.emit("-cancel-dialogs");
				openDialogs.delete(guest);
				return {
					ok: true,
					handled: {
						...open,
						action: input.action
					}
				};
			}
			case "webmcp": {
				if (input.action !== "list" && input.action !== "invoke") throw new Error("webmcp action must be list or invoke");
				if (input.action === "invoke" && typeof input.name !== "string") throw new Error("webmcp invoke requires the tool name");
				const value = await evaluate(`(async () => {
          const native = Reflect.get(document, "modelContext");
          const testing = Reflect.get(navigator, "modelContextTesting");
          const describe = (tool) => ({ name: tool.name, title: tool.title ?? null, description: tool.description ?? null,
            inputSchema: typeof tool.inputSchema === "string" ? JSON.parse(tool.inputSchema) : tool.inputSchema ?? null,
            annotations: tool.annotations ?? null });
          const list = async () => {
            if (native && typeof native.getTools === "function") return (await native.getTools()).filter((tool) => tool.window === undefined || tool.window === window);
            if (testing && typeof testing.listTools === "function") return await testing.listTools();
            return null;
          };
          const tools = await list();
          if (tools === null) return { supported: false, tools: [] };
          if (${JSON.stringify(input.action)} === "list") return { supported: true, tools: tools.map(describe) };
          const name = ${JSON.stringify(input.name ?? "")};
          const tool = tools.find((candidate) => candidate.name === name);
          if (!tool) throw new Error("the page has no WebMCP tool " + name + "; list the tools first");
          const input = ${JSON.stringify(input.input ?? {})};
          let result;
          if (native && typeof native.executeTool === "function") {
            result = await native.executeTool(tool, native.executeTool.length === 2 ? JSON.stringify(input) : input, { signal: AbortSignal.timeout(${String(3e4)}) });
          } else {
            result = await testing.executeTool(name, JSON.stringify(input));
          }
          if (typeof result === "string") { try { result = JSON.parse(result) } catch {} }
          return { supported: true, result: result ?? null };
        })()`);
				if (jsonBytes(value) > MAX_EVALUATION_BYTES) throw new Error(`the result is larger than ${String(MAX_EVALUATION_BYTES)} bytes`);
				return {
					origin: new URL(guest.getURL()).origin,
					...value
				};
			}
			case "type": {
				const target = targetOf(input, "document.activeElement");
				await moveTo(await toTop(await evaluate(pointExpression(target, false)) ?? await evaluate("({ x: innerWidth / 2, y: innerHeight / 2 })")), anchorOf(input));
				await send("Emulation.setFocusEmulationEnabled", { enabled: true });
				const result = await evaluate(focusExpression(input));
				if (result.notFound === true) throw new Error("no element matches the target; call preview_snapshot for current selectors");
				if (result.notEditable === true) throw new Error("the target is disabled, read-only, or not editable");
				if (result.focusFailed === true) throw new Error("the target could not take focus");
				const text = typeof input.text === "string" ? input.text : "";
				const objectId = (targetObjectId === void 0 ? await send("Runtime.evaluate", {
					expression: `(() => { ${LOCATOR_PRELUDE} return ${target}; })()`,
					returnByValue: false,
					...frameContextId === void 0 ? {} : { contextId: frameContextId }
				}) : { result: { objectId: targetObjectId } }).result?.objectId;
				if (objectId === void 0) throw new Error("the editor disappeared before text insertion");
				try {
					if (input.sequential === true) {
						const characters = Array.from(text);
						for (const [index, character] of characters.entries()) {
							if (character === "\n") press(guest, { key: "Enter" });
							else if (character === "	") press(guest, { key: "Tab" });
							else await guest.insertText(character);
							if (index < characters.length - 1) await sleep(SEQUENTIAL_TYPE_DELAY_MS, signal);
						}
					} else if (text !== "") await guest.insertText(text);
					if ((await send("Runtime.callFunctionOn", {
						objectId,
						functionDeclaration: "function(){return this === this.getRootNode().activeElement}",
						returnByValue: true
					})).result?.value !== true) throw new Error("focus moved away during text insertion; inspect the editor before continuing");
				} finally {
					if (targetObjectId === void 0 && guest.debugger.isAttached()) await guest.debugger.sendCommand("Runtime.releaseObject", { objectId });
				}
				signal.throwIfAborted();
				return {
					ok: true,
					characters: Array.from(text).length
				};
			}
			case "press": {
				await send("Emulation.setFocusEmulationEnabled", { enabled: true });
				await show({
					action: "type",
					...await toTop(await evaluate(pointExpression("document.activeElement", false)) ?? await evaluate("({ x: innerWidth / 2, y: innerHeight / 2 })"))
				}, true);
				signal.throwIfAborted();
				const navigation = watchNavigation(guest, (await send("Page.getFrameTree")).frameTree.frame.id, signal);
				const dialog = watchDialog(guest);
				try {
					press(guest, input);
					const opened = await Promise.race([navigation.settled.then(() => null), dialog.opened]);
					if (opened !== null) navigation.cancel();
					return {
						ok: true,
						...opened === null ? {} : dialogReport(opened)
					};
				} finally {
					dialog.dispose();
				}
			}
			case "scroll": {
				const deltaX = Number(input.deltaX ?? 0);
				const deltaY = Number(input.deltaY ?? 0);
				if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) throw new Error("scroll deltas must be numbers");
				const point = typeof input.selector === "string" || typeof input.token === "string" ? await pointFor(input, null, false) : typeof input.x === "number" && typeof input.y === "number" ? {
					x: input.x,
					y: input.y
				} : await scrollOrigin();
				await show({
					action: "scroll",
					...point,
					...anchorOf(input)
				}, true);
				await send("Input.dispatchMouseEvent", {
					type: "mouseMoved",
					button: "none",
					buttons: 0,
					...point
				});
				const position = `(() => { const at = document.elementFromPoint(${String(point.x)}, ${String(point.y)}); let node = at; while (node && node !== document.documentElement && !(node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) node = node.parentElement; const scroller = node && node !== document.documentElement ? node : document.scrollingElement ?? document.documentElement; return scroller.scrollLeft + "," + scroller.scrollTop })()`;
				await send("Input.dispatchMouseEvent", {
					type: "mouseWheel",
					...point,
					deltaX,
					deltaY
				});
				const settleBy = Date.now() + SCROLL_SETTLE_MAX_MS;
				let last = await evaluate(position);
				while (Date.now() < settleBy) {
					await sleep(SCROLL_SETTLE_POLL_MS, signal);
					const now = await evaluate(position);
					if (now === last) break;
					last = now;
				}
				show({
					action: "move",
					...point
				});
				pointerAt.set(guest, point);
				pointerInPage.add(guest);
				return { ok: true };
			}
			case "status": return {
				open: true,
				url: guest.getURL(),
				title: guest.getTitle()
			};
			case "back":
			case "forward":
			case "reload":
			case "navigate":
				if (guest.navigate !== void 0) {
					await guest.navigate(operation, typeof input.url === "string" ? input.url : "", signal);
					return {
						ok: true,
						url: guest.getURL(),
						title: guest.getTitle()
					};
				}
				if (operation === "navigate") {
					leavePage();
					await show({
						action: "control",
						control: "navigate",
						url: typeof input.url === "string" ? input.url : "",
						x: 0,
						y: 0
					}, true, CONTROL_GESTURE_TIMEOUT_MS);
					return { ok: true };
				}
				leavePage();
				await show({
					action: "control",
					control: operation === "reload" ? "refresh" : operation,
					x: 0,
					y: 0
				}, true, CONTROL_GESTURE_TIMEOUT_MS);
				return { ok: true };
			case "capture":
				leavePage();
				await show({
					action: "control",
					control: "capture",
					x: 0,
					y: 0
				}, true, CONTROL_GESTURE_TIMEOUT_MS);
				return { ok: true };
			case "control":
				leavePage();
				await show({
					action: "control",
					control: typeof input.control === "string" ? input.control : "",
					x: 0,
					y: 0
				}, true, CONTROL_GESTURE_TIMEOUT_MS);
				return { ok: true };
			case "evaluate": {
				const dialog = watchDialog(guest);
				const evaluation = evaluate(String(input.expression));
				let opened;
				try {
					opened = await Promise.race([evaluation.then(() => null), dialog.opened]);
				} finally {
					dialog.dispose();
				}
				if (opened !== null) {
					evaluation.catch(() => void 0);
					return {
						value: null,
						...dialogReport(opened)
					};
				}
				const value = await evaluation;
				if (jsonBytes(value) > MAX_EVALUATION_BYTES) throw new Error(`the result is larger than ${String(MAX_EVALUATION_BYTES)} bytes`);
				return { value: value ?? null };
			}
			default: throw new Error(`unknown browser operation ${operation}`);
		}
	} finally {
		if (targetObjectId !== void 0 && guest.debugger.isAttached()) await guest.debugger.sendCommand("Runtime.releaseObject", { objectId: targetObjectId });
		if (frameObjectId !== void 0 && guest.debugger.isAttached()) await guest.debugger.sendCommand("Runtime.releaseObject", { objectId: frameObjectId }).catch(() => void 0);
	}
}
//#endregion
//#region ../../packages/web/browser-engine/src/chrome-tab.ts
/**
* A browser tab reached over one CDP session, as an engine target: Chrome over
* its debugging connection, or any Chromium through the Aeven extension's
* `chrome.debugger`. The agent pointer is the overlay, injected into the page.
*/
/** How long a navigation the agent starts is given to load, in ms (ChatGPT `navigate_tab_*` default). */
const NAVIGATE_TIMEOUT_MS = 1e4;
/** CDP modifier bits for key events. */
const MODIFIER_BITS = {
	alt: 1,
	control: 2,
	meta: 4,
	shift: 8
};
/** Named keys the engine sends, as CDP key fields. */
const NAMED_KEYS = {
	Enter: {
		key: "Enter",
		code: "Enter",
		keyCode: 13
	},
	Tab: {
		key: "Tab",
		code: "Tab",
		keyCode: 9
	},
	Escape: {
		key: "Escape",
		code: "Escape",
		keyCode: 27
	},
	Backspace: {
		key: "Backspace",
		code: "Backspace",
		keyCode: 8
	},
	Delete: {
		key: "Delete",
		code: "Delete",
		keyCode: 46
	},
	Insert: {
		key: "Insert",
		code: "Insert",
		keyCode: 45
	},
	Home: {
		key: "Home",
		code: "Home",
		keyCode: 36
	},
	End: {
		key: "End",
		code: "End",
		keyCode: 35
	},
	PageUp: {
		key: "PageUp",
		code: "PageUp",
		keyCode: 33
	},
	PageDown: {
		key: "PageDown",
		code: "PageDown",
		keyCode: 34
	},
	Up: {
		key: "ArrowUp",
		code: "ArrowUp",
		keyCode: 38
	},
	Down: {
		key: "ArrowDown",
		code: "ArrowDown",
		keyCode: 40
	},
	Left: {
		key: "ArrowLeft",
		code: "ArrowLeft",
		keyCode: 37
	},
	Right: {
		key: "ArrowRight",
		code: "ArrowRight",
		keyCode: 39
	},
	" ": {
		key: " ",
		code: "Space",
		keyCode: 32
	}
};
/** CDP fields of one key the engine names. */
function keyFields(name) {
	const named = NAMED_KEYS[name];
	if (named !== void 0) return {
		key: named.key,
		code: named.code,
		windowsVirtualKeyCode: named.keyCode
	};
	const upper = name.toUpperCase();
	return {
		key: name,
		code: /^[A-Z]$/.test(upper) ? `Key${upper}` : /^\d$/.test(name) ? `Digit${name}` : "",
		windowsVirtualKeyCode: name.length === 1 ? upper.charCodeAt(0) : 0
	};
}
/** A Chrome tab as an engine target. */
var ChromeTab = class {
	id;
	#channel;
	#url;
	#title;
	#detached = false;
	#overlayReady = false;
	#listeners = /* @__PURE__ */ new Map();
	#overlayScript;
	#unsubscribe;
	/**
	* @param channel - the tab's CDP session.
	* @param id - the id the agent's tab commands name it by.
	* @param url - its address now. @param title - its title now.
	* @param overlayScript - the agent pointer as a classic page script (the overlay package's IIFE bundle).
	*/
	constructor(channel, id, url, title, overlayScript) {
		this.id = id;
		this.#overlayScript = overlayScript;
		this.#channel = channel;
		this.#url = url;
		this.#title = title;
		this.#unsubscribe = channel.subscribe((method, params) => {
			if (method === "Page.frameNavigated" && params.frame?.parentId === void 0) this.#overlayReady = false;
		});
	}
	/**
	* Record the tab's address and title as its browser reports them.
	* @param url - the address. @param title - the title.
	*/
	setInfo(url, title) {
		this.#url = url;
		this.#title = title;
	}
	/** Mark the tab unreachable once its debugger detached, and stop listening to its events. */
	markDetached() {
		this.#detached = true;
		this.#unsubscribe();
		for (const unsubscribe of this.#listeners.values()) unsubscribe();
		this.#listeners.clear();
	}
	debugger = {
		attach: () => {},
		isAttached: () => !this.#detached && this.#channel.isOpen(),
		sendCommand: (method, params) => this.#channel.send(method, params ?? {}),
		on: (_event, listener) => {
			this.#listeners.set(listener, this.#channel.subscribe((method, params) => {
				listener(void 0, method, params);
			}));
		},
		off: (_event, listener) => {
			this.#listeners.get(listener)?.();
			this.#listeners.delete(listener);
		}
	};
	session = { fetch: async (input, init) => {
		init?.signal?.throwIfAborted();
		const reply = await this.debugger.sendCommand("Runtime.evaluate", {
			expression: `(async () => {
          const response = await fetch(${JSON.stringify(input)}, { credentials: "include" });
          const bytes = new Uint8Array(await response.arrayBuffer());
          let binary = "";
          for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
          return { status: response.status, type: response.headers.get("content-type") ?? "", data: btoa(binary) };
        })()`,
			awaitPromise: true,
			returnByValue: true
		});
		const value = reply.result?.value;
		if (value === void 0) throw new Error(reply.exceptionDetails?.text ?? "the page could not fetch the document");
		return new Response(Uint8Array.from(atob(value.data), (character) => character.charCodeAt(0)), {
			status: value.status,
			headers: { "content-type": value.type }
		});
	} };
	getURL() {
		return this.#url;
	}
	getTitle() {
		return this.#title;
	}
	async insertText(text) {
		await this.debugger.sendCommand("Input.insertText", { text });
	}
	sendInputEvent(input) {
		const modifiers = (input.modifiers ?? []).reduce((bits, name) => bits | MODIFIER_BITS[name], 0);
		const params = input.type === "char" ? {
			type: "char",
			text: input.keyCode,
			unmodifiedText: input.keyCode,
			modifiers
		} : {
			type: input.type === "keyDown" ? "rawKeyDown" : "keyUp",
			...keyFields(input.keyCode),
			modifiers
		};
		this.debugger.sendCommand("Input.dispatchKeyEvent", params).catch(() => void 0);
	}
	emit() {
		return false;
	}
	/** Put the overlay into the tab's page once per document, drawing the pointer alone. */
	async #overlay() {
		if (this.#overlayReady) return;
		await this.debugger.sendCommand("Runtime.evaluate", {
			expression: `if (!window.__aevenOverlay) { ${this.#overlayScript} } window.__aevenOverlay?.attach({ decorations: false }); true`,
			returnByValue: true
		});
		this.#overlayReady = true;
	}
	async presentCursor(step, wait, timeoutMs, signal) {
		const point = JSON.stringify({
			x: step.x,
			y: step.y
		});
		const call = step.action === "move" ? `moveTo(${point})` : step.action === "click" ? `click(${point})` : step.action === "type" ? `type(${point})` : step.action === "scroll" ? `scroll(${point})` : step.action === "cancel" ? "hide({ immediate: true })" : void 0;
		if (call === void 0) return;
		await this.#overlay();
		const drawn = await this.debugger.sendCommand("Runtime.evaluate", {
			expression: `document.visibilityState === "visible" ? (window.__aevenOverlay?.${call}, true) : false`,
			returnByValue: true
		});
		if (!wait || drawn.result?.value !== true) return;
		await Promise.race([
			this.debugger.sendCommand("Runtime.evaluate", {
				expression: "window.__aevenOverlay?.arrived()",
				awaitPromise: true,
				returnByValue: true
			}),
			new Promise((resolve) => {
				setTimeout(resolve, timeoutMs);
			}),
			new Promise((_resolve, reject) => {
				if (signal.aborted) reject(signal.reason);
				else signal.addEventListener("abort", () => {
					reject(signal.reason);
				}, { once: true });
			})
		]);
	}
	async navigate(operation, url, signal) {
		let finish = () => {};
		const loaded = new Promise((resolve) => {
			const timer = setTimeout(() => {
				finish();
			}, NAVIGATE_TIMEOUT_MS);
			const listener = (_event, method) => {
				if (method === "Page.loadEventFired" || method === "Page.navigatedWithinDocument") finish();
			};
			finish = () => {
				clearTimeout(timer);
				this.debugger.off("message", listener);
				signal.removeEventListener("abort", finish);
				resolve();
			};
			this.debugger.on("message", listener);
			signal.addEventListener("abort", finish, { once: true });
		});
		try {
			if (operation === "navigate") {
				const address = /^[a-z][a-z\d+.-]*:/i.test(url) ? url : `https://${url}`;
				const result = await this.debugger.sendCommand("Page.navigate", { url: address });
				if (result.errorText !== void 0 && result.errorText !== "") throw new Error(`the page did not load: ${result.errorText}`);
			} else if (operation === "reload") await this.debugger.sendCommand("Page.reload", {});
			else {
				const history = await this.debugger.sendCommand("Page.getNavigationHistory");
				const entry = history.entries[history.currentIndex + (operation === "back" ? -1 : 1)];
				if (entry === void 0) throw new Error(`cannot go ${operation}: no ${operation === "back" ? "previous" : "next"} page in history`);
				await this.debugger.sendCommand("Page.navigateToHistoryEntry", { entryId: entry.id });
			}
		} catch (error) {
			finish();
			throw error;
		}
		await loaded;
		signal.throwIfAborted();
	}
};
/**
* Make a newly attached tab ready for the engine: the domains its events come
* from, and the overlay installed in every document it opens.
* @param tab - the attached tab.
*/
async function prepareTab(tab, overlayScript) {
	await tab.debugger.sendCommand("Page.enable");
	await tab.debugger.sendCommand("Runtime.enable");
	await tab.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: overlayScript });
	observePage(tab);
}
//#endregion
//#region src/background.ts
/**
* The Aeven extension's service worker: it connects to the Aeven desktop app
* through the app's native messaging host and serves the agent's requests on the
* browser it runs in.
*
* The agent works only in tabs it opened, kept in an "Aeven" tab group and
* brought to the front so the user watches it work; it attaches
* `chrome.debugger` to those tabs alone, and only while it acts: Chrome shows its
* "started debugging this browser" bar while a debugger is attached, so a tab is
* detached once the agent has left it idle for `IDLE_DETACH_MS`. History
* and bookmarks are read on request; the app asks the user before it requests them.
* Messages are `{ id, method, params }` requests answered with `{ id, result }`
* or `{ id, error }`, and `{ event, ... }` notifications.
*/
/** The native messaging host the Aeven desktop app registers. */
const HOST = "io.aeven.browser";
/** The request and event set this extension speaks; the app refuses an older one. */
const PROTOCOL = 2;
/** Title of the tab group the agent's tabs live in. */
const GROUP_TITLE = "Aeven";
/** Session-storage key of the agent's tab ids, which survive the worker restarting. */
const TABS_KEY = "agentTabs";
/** Longest wait before reconnecting to the app, in ms. */
const MAX_RETRY_MS = 6e4;
/** How long an agent tab stays attached after its last operation, in ms; a task's steps follow within it. */
const IDLE_DETACH_MS = 1e4;
let port;
let retryMs = 1e3;
let retryTimer;
const agentTabs = /* @__PURE__ */ new Set();
const attached = /* @__PURE__ */ new Set();
/** Engine targets of the agent's tabs, attached on their first operation. */
const targets = /* @__PURE__ */ new Map();
/** Operations in flight, by request id, so the app can cancel one. */
const running = /* @__PURE__ */ new Map();
/** Pending detaches of idle agent tabs. */
const idleTimers = /* @__PURE__ */ new Map();
/** The agent pointer as a page script, bundled beside this worker. */
let overlayScript;
const loading = chrome.storage.session.get(TABS_KEY).then((stored) => {
	for (const id of stored[TABS_KEY] ?? []) agentTabs.add(id);
});
/** Persist the agent's tab ids. */
function saveTabs() {
	chrome.storage.session.set({ [TABS_KEY]: [...agentTabs] });
}
/** Send one message to the app, when connected. */
function post(message) {
	port?.postMessage(message);
}
/** The browser this extension runs in, as the app names it to the user. */
function browserName() {
	const brands = navigator.userAgentData?.brands.map((brand) => brand.brand) ?? [];
	return [
		"Microsoft Edge",
		"Brave",
		"Opera",
		"Vivaldi",
		"Google Chrome",
		"Chromium"
	].find((name) => brands.includes(name)) ?? "Chromium";
}
/** Connect to the app's host, retrying with backoff while the app is not running. */
function connect() {
	if (port !== void 0) return;
	clearTimeout(retryTimer);
	const opened = chrome.runtime.connectNative(HOST);
	port = opened;
	opened.onMessage.addListener((message) => {
		if (message.event === "unavailable") return;
		if (typeof message.id === "number" && typeof message.method === "string") answer(message.id, message.method, message.params ?? {}, post);
	});
	opened.onDisconnect.addListener(() => {
		if (port !== opened) return;
		port = void 0;
		for (const tabId of [...attached]) {
			forget(tabId);
			chrome.debugger.detach({ tabId }).catch(() => void 0);
		}
		retryTimer = setTimeout(connect, retryMs);
		retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
	});
	post({
		event: "hello",
		browser: browserName(),
		version: chrome.runtime.getManifest().version,
		protocol: PROTOCOL
	});
}
/**
* Answer one request from the app.
* @param id - the request id.
* @param method - the request.
* @param params - its parameters.
*/
async function answer(id, method, params, reply) {
	try {
		await loading;
		reply({
			id,
			result: await handle(method, params, id)
		});
		retryMs = 1e3;
	} catch (error) {
		reply({
			id,
			error: error instanceof Error ? error.message : String(error)
		});
	}
}
/**
* One of the agent's tabs as an engine target, attaching the debugger on first use.
* @param tabId - the tab.
* @returns the target.
*/
async function target(tabId) {
	const live = targets.get(tabId);
	if (live !== void 0 && attached.has(tabId)) return live;
	if (!attached.has(tabId)) {
		await chrome.debugger.attach({ tabId }, "1.3");
		attached.add(tabId);
	}
	overlayScript ??= fetch(chrome.runtime.getURL("overlay-page.iife.js")).then(async (response) => await response.text());
	const script = await overlayScript;
	const tab = await chrome.tabs.get(tabId);
	const created = new ChromeTab({
		send: async (method, params) => await chrome.debugger.sendCommand({ tabId }, method, params),
		subscribe: (listener) => {
			const forward = (source, method, params) => {
				if (source.tabId === tabId) listener(method, params);
			};
			chrome.debugger.onEvent.addListener(forward);
			return () => {
				chrome.debugger.onEvent.removeListener(forward);
			};
		},
		isOpen: () => attached.has(tabId)
	}, `ext:${String(tabId)}`, tab.url ?? "", tab.title ?? "", script);
	targets.set(tabId, created);
	await prepareTab(created, script);
	return created;
}
/**
* Forget a tab's debugger session, after it detached or the extension detached it.
* @param tabId - the tab.
*/
function forget(tabId) {
	clearTimeout(idleTimers.get(tabId));
	idleTimers.delete(tabId);
	attached.delete(tabId);
	targets.get(tabId)?.markDetached();
	targets.delete(tabId);
}
/**
* Detach the debugger from a tab once no operation runs on it, which removes Chrome's debugging bar.
* @param tabId - the tab.
*/
function detachWhenIdle(tabId) {
	clearTimeout(idleTimers.get(tabId));
	if ([...running.values()].some((operation) => operation.tabId === tabId)) return;
	idleTimers.set(tabId, setTimeout(() => {
		idleTimers.delete(tabId);
		if (!attached.has(tabId) || [...running.values()].some((operation) => operation.tabId === tabId)) return;
		forget(tabId);
		chrome.debugger.detach({ tabId }).catch(() => void 0);
	}, IDLE_DETACH_MS));
}
/**
* A tab the agent opened, refusing any other.
* @param value - the tab id the app named.
* @returns the tab id.
*/
function agentTab(value) {
	if (typeof value !== "number" || !agentTabs.has(value)) throw new Error("the agent can only use tabs it opened in the Aeven tab group");
	return value;
}
/**
* Put a tab into the window's Aeven tab group, creating the group collapsed.
* @param tab - the tab.
*/
async function group(tab) {
	if (tab.id === void 0) return;
	const [existing] = await chrome.tabGroups.query({
		title: GROUP_TITLE,
		windowId: tab.windowId
	});
	const groupId = await chrome.tabs.group(existing === void 0 ? { tabIds: tab.id } : {
		tabIds: tab.id,
		groupId: existing.id
	});
	await chrome.tabGroups.update(groupId, existing === void 0 ? {
		title: GROUP_TITLE,
		color: "grey",
		collapsed: false
	} : { collapsed: false });
}
/**
* Perform one request.
* @param method - the request.
* @param params - its parameters.
* @returns the result.
*/
async function handle(method, params, id) {
	switch (method) {
		case "info": return {
			protocol: PROTOCOL,
			browser: browserName(),
			version: chrome.runtime.getManifest().version
		};
		case "operate": {
			const tabId = agentTab(params.tabId);
			if (typeof params.operation !== "string") throw new Error("operate needs an operation");
			const controller = new AbortController();
			clearTimeout(idleTimers.get(tabId));
			running.set(id, {
				controller,
				tabId
			});
			try {
				return await automate(await target(tabId), params.operation, params.input ?? {}, controller.signal, {});
			} finally {
				running.delete(id);
				detachWhenIdle(tabId);
			}
		}
		case "operate.cancel":
			running.get(params.requestId)?.controller.abort(/* @__PURE__ */ new Error("the agent cancelled the action"));
			return {};
		case "tabs.list": {
			const listed = [];
			for (const tabId of agentTabs) {
				const tab = await chrome.tabs.get(tabId).catch(() => void 0);
				if (tab === void 0) {
					agentTabs.delete(tabId);
					continue;
				}
				listed.push({
					tabId,
					url: tab.url ?? "",
					title: tab.title ?? ""
				});
			}
			saveTabs();
			return listed;
		}
		case "tabs.create": {
			const tab = await chrome.tabs.create({
				url: typeof params.url === "string" ? params.url : "about:blank",
				active: true
			});
			if (tab.id === void 0) throw new Error("the browser did not open a tab");
			agentTabs.add(tab.id);
			saveTabs();
			await group(tab);
			return { tabId: tab.id };
		}
		case "tabs.close": {
			const tabId = agentTab(params.tabId);
			await chrome.tabs.remove(tabId);
			return {};
		}
		case "history.search": return (await chrome.history.search({
			text: typeof params.text === "string" ? params.text : "",
			startTime: 0,
			maxResults: typeof params.maxResults === "number" ? params.maxResults : 20
		})).map((item) => ({
			url: item.url ?? "",
			title: item.title ?? "",
			visits: item.visitCount ?? 0,
			visitedAt: item.lastVisitTime === void 0 ? null : new Date(item.lastVisitTime).toISOString()
		}));
		case "bookmarks.search": {
			const limit = typeof params.maxResults === "number" ? params.maxResults : 20;
			const query = typeof params.query === "string" ? params.query : "";
			return (query === "" ? await chrome.bookmarks.getRecent(limit) : (await chrome.bookmarks.search(query)).slice(0, limit)).filter((node) => node.url !== void 0).map((node) => ({
				url: node.url ?? "",
				title: node.title,
				addedAt: node.dateAdded === void 0 ? null : new Date(node.dateAdded).toISOString()
			}));
		}
		default: throw new Error(`unknown request ${method}`);
	}
}
chrome.debugger.onDetach.addListener((source) => {
	if (source.tabId !== void 0) forget(source.tabId);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
	if (!agentTabs.has(tabId) || change.url === void 0 && change.title === void 0) return;
	targets.get(tabId)?.setInfo(tab.url ?? "", tab.title ?? "");
	post({
		event: "tabs.updated",
		tabId,
		url: tab.url ?? "",
		title: tab.title ?? ""
	});
});
chrome.tabs.onRemoved.addListener((tabId) => {
	if (!agentTabs.delete(tabId)) return;
	forget(tabId);
	saveTabs();
	post({
		event: "tabs.removed",
		tabId
	});
});
chrome.alarms.create("aeven-connect", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {
	connect();
});
chrome.runtime.onStartup.addListener(() => {
	connect();
});
chrome.runtime.onInstalled.addListener(() => {
	connect();
});
connect();
//#endregion
