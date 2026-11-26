/*
 * Aeven's in-page driver for the motion audit. It runs after layout-audit.browser.js in a page that carries a
 * HyperFrames composition bundled with its runtime: it seeks the composition's player to each time and returns
 * what the upstream audit measured there, plus the font families that fell back to another face.
 * `summarizeAudit` in src/audit.ts judges the result.
 */
(function () {
  const TEXT_LIMIT = 120;
  const ISSUE_LIMIT = 40;
  const GENERIC = new Set([
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-serif", "ui-sans-serif",
    "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit", "initial", "unset",
  ]);

  function clip(text) {
    const normal = String(text ?? "").replace(/\s+/g, " ").trim();
    return normal.length > TEXT_LIMIT ? normal.slice(0, TEXT_LIMIT - 3) + "..." : normal;
  }

  // A family that is absent measures the same as each generic it falls back to.
  function familyRenders(context, family) {
    const probe = "AaBbGgQqWwMmIiLl 0123456789 Æøß";
    return ["monospace", "serif"].some((generic) => {
      context.font = `72px ${generic}`;
      const base = context.measureText(probe).width;
      context.font = `72px "${family.replace(/"/g, "")}", ${generic}`;
      return context.measureText(probe).width !== base;
    });
  }

  function firstFamily(stack) {
    const first = stack.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
    return first.length === 0 || GENERIC.has(first.toLowerCase()) ? null : first;
  }

  function missingFamilies(root) {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) return [];
    const uses = new Map();
    for (const element of root.querySelectorAll("*")) {
      const hasText = Array.from(element.childNodes).some(
        (node) => node.nodeType === 3 && (node.textContent || "").trim().length > 0,
      );
      if (!hasText) continue;
      const family = firstFamily(getComputedStyle(element).fontFamily);
      if (family && !uses.has(family)) uses.set(family, clip(element.textContent));
    }
    const missing = [];
    for (const [family, text] of uses) {
      if (!familyRenders(context, family)) missing.push({ family, text });
    }
    return missing;
  }

  window.__avnMotionAudit = async function auditFilm(times) {
    const player = window.__player;
    const root =
      document.querySelector("[data-composition-id][data-width][data-height]") ||
      document.querySelector("[data-composition-id]");
    if (!player || !root || typeof window.__hyperframesLayoutAudit !== "function") return null;
    await document.fonts.ready;
    const samples = [];
    for (const time of times) {
      await player.renderSeek(time);
      if (typeof window.__hfWaitForSeekCompletion === "function") await window.__hfWaitForSeekCompletion();
      const issues = window.__hyperframesLayoutAudit({ time }).slice(0, ISSUE_LIMIT).map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        selector: issue.selector,
        text: clip(issue.text),
        message: issue.message,
        fixHint: issue.fixHint ?? null,
      }));
      const parts = window.__hyperframesCraftSample({}).parts.map((part) => ({
        key: part.key,
        block: part.block,
        selector: part.selector,
        text: clip(part.text),
        blockText: clip(part.blockText),
        opacity: part.opacity,
        fontPx: part.fontPx,
        captions: part.captions === true,
      }));
      samples.push({ time, issues, parts });
    }
    return {
      width: Number(root.getAttribute("data-width")) || window.innerWidth,
      height: Number(root.getAttribute("data-height")) || window.innerHeight,
      missingFonts: missingFamilies(root),
      samples,
    };
  };
})();
