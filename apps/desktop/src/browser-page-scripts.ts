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
export const LOCATOR_PRELUDE = `const __aevenLocate = (() => {
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
})();`

/** Characters of exported page content returned to the model. */
export const MAX_CONTENT_LENGTH = 100_000

/**
 * The page's visible content as Markdown: headings, paragraphs, links, emphasis,
 * code, lists, tables, quotes, and images with alt text. Hidden elements are skipped.
 */
export const PAGE_MARKDOWN = `(() => {
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
})()`

/**
 * The open YouTube video's captions as timed lines, from the player's caption
 * track or, when that track cannot be fetched, the transcript panel the page shows.
 */
export const YOUTUBE_TRANSCRIPT = `(async () => {
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
})()`
