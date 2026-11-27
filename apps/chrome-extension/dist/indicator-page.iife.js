"use strict";
(function() {
	//#region src/indicator-page.ts
	/**
	* The agent's presence in a tab the Aeven extension drives: a glow around the
	* viewport in the agent pointer's blue, a status tag along the bottom edge, and
	* the Æven icon as the tab's icon. The page's title is left alone, since the
	* browser records it in the history. The extension's worker installs this script
	* into the page through the debugger and calls `window.__aevenIndicator` while
	* it controls the tab; nothing here reads the page or handles input, and every
	* element ignores the pointer.
	*
	* Everything is drawn in a closed shadow root with a constructed stylesheet, so
	* the page's styles cannot reach it and a page's style Content Security Policy
	* does not block it. The tag's font arrives as bytes (`loadFont`), which a
	* page's font policy does not block either.
	*/
	/** The family name the tag's font is registered under, apart from any the page loads. */
	const FONT_FAMILY = "Aeven Indicator Sans";
	/** How long the finished tag stays before everything is removed, in ms. */
	const DONE_VISIBLE_MS = 4e3;
	const STYLES = `
:host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
.glow {
  position: fixed; inset: 0; pointer-events: none; opacity: 0;
  box-shadow: inset 0 0 0 3px rgb(51, 156, 255), inset 0 0 36px 10px rgba(51, 156, 255, 0.42);
  transition: opacity 200ms ease-out;
}
:host([data-tone]) .glow { opacity: 1; animation: aeven-glow 2.4s ease-in-out infinite; }
:host([data-tone="done"]) .glow { animation: none; }
@keyframes aeven-glow {
  50% { box-shadow: inset 0 0 0 3px rgba(51, 156, 255, 0.8), inset 0 0 56px 16px rgba(51, 156, 255, 0.28); }
}
.tag {
  position: fixed; left: 50%; bottom: 20px; box-sizing: border-box; pointer-events: none;
  max-width: min(560px, calc(100vw - 32px)); padding: 8px 16px; border-radius: 999px;
  background: #0b6fd8; color: #ffffff; box-shadow: 0 4px 16px rgba(11, 111, 216, 0.32);
  font-family: "${FONT_FAMILY}", "Google Sans Flex", system-ui, sans-serif;
  font-size: 13px; line-height: 18px; font-weight: 550; letter-spacing: 0.1px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  opacity: 0; transform: translate(-50%, 8px);
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}
:host([data-tone]) .tag { opacity: 1; transform: translate(-50%, 0); }
@media (prefers-reduced-motion: reduce) {
  :host([data-tone]) .glow { animation: none; }
  .glow, .tag { transition: none; }
}
`;
	let host;
	let tag;
	let fontLoaded = false;
	let doneTimer;
	/** The page's own icon links, taken out while the Æven icon shows, with where each sat. */
	let pageIcons;
	let iconLink;
	/**
	* The indicator's host element, created on first use and re-attached when the page replaced the document's children.
	* @returns the host and its tag.
	*/
	function ensureHost() {
		if (host !== void 0 && tag !== void 0) {
			if (!host.isConnected) document.documentElement.append(host);
			return {
				host,
				tag
			};
		}
		const made = document.createElement("aeven-agent-indicator");
		const shadow = made.attachShadow({ mode: "closed" });
		const sheet = new CSSStyleSheet();
		sheet.replaceSync(STYLES);
		shadow.adoptedStyleSheets = [sheet];
		const glow = document.createElement("div");
		glow.className = "glow";
		const label = document.createElement("div");
		label.className = "tag";
		label.setAttribute("role", "status");
		label.setAttribute("aria-live", "polite");
		shadow.append(glow, label);
		document.documentElement.append(made);
		host = made;
		tag = label;
		return {
			host: made,
			tag: label
		};
	}
	/**
	* Show the Æven icon as the tab's icon, keeping the page's own icon links to put back.
	* @param icon - the icon as a data URL.
	*/
	function showIcon(icon) {
		if (iconLink?.isConnected === true) {
			iconLink.href = icon;
			return;
		}
		const head = document.head;
		pageIcons = [...document.querySelectorAll("link[rel~=\"icon\"]")].flatMap((link) => link.parentNode === null ? [] : [{
			link,
			parent: link.parentNode,
			next: link.nextSibling
		}]);
		for (const { link } of pageIcons) link.remove();
		iconLink = document.createElement("link");
		iconLink.rel = "icon";
		iconLink.href = icon;
		head.append(iconLink);
	}
	/** Put the page's own icon links back. */
	function restoreIcon() {
		iconLink?.remove();
		iconLink = void 0;
		for (const { link, parent, next } of pageIcons ?? []) parent.insertBefore(link, next !== null && next.parentNode === parent ? next : null);
		pageIcons = void 0;
	}
	/** Remove the glow, the tag, and the Æven tab icon. */
	function clear() {
		clearTimeout(doneTimer);
		doneTimer = void 0;
		host?.removeAttribute("data-tone");
		restoreIcon();
	}
	/**
	* Show the indicator; a `done` view removes itself after a few seconds.
	* @param view - what to show.
	*/
	function show(view) {
		clearTimeout(doneTimer);
		doneTimer = void 0;
		const drawn = ensureHost();
		drawn.tag.textContent = view.text;
		drawn.host.setAttribute("data-tone", view.tone);
		showIcon(view.icon);
		if (view.tone === "done") doneTimer = setTimeout(clear, DONE_VISIBLE_MS);
	}
	/**
	* Register the tag's font from its bytes.
	* @param base64 - the WOFF2 file, base64-encoded.
	*/
	function loadFont(base64) {
		if (fontLoaded) return;
		fontLoaded = true;
		const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
		const face = new FontFace(FONT_FAMILY, bytes, {
			weight: "1 1000",
			style: "normal"
		});
		document.fonts.add(face);
		face.load().catch(() => {
			fontLoaded = false;
		});
	}
	window.__aevenIndicator = {
		show,
		clear,
		loadFont,
		/** Whether the font is registered in this document. */
		hasFont: () => fontLoaded
	};
	//#endregion
})();
