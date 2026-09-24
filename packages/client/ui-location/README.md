---
description: "Browser location consent UI that answers get_location with the reader's choice through the scoped interaction path."
kind: "package-reference"
---
# @aeven/client-ui-location

English | [中文](README.zh.md)

## Summary

Browser location consent over the Agent-scoped `location/request` Remote Event waterfall, where the browser's own permission prompt is the reader's one approval. When the model calls `get_location` and the browser already allows the site, the plugin reads the position without showing anything. Otherwise it starts the read at once, which opens the browser prompt, and takes over the Conversation composer with **Allow Aeven to know your precise location?**, the model's purpose, and two buttons: **OK** reads again, for a reader who dismissed or has not yet answered the prompt, and **No** declines this request only.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

None, as this package presents location requests in the browser; `@aeven/tool-location` owns what the model sees.

#### KV Cache effect

None; presenting a request and returning the reader's choice does not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Secure pages only** — browsers expose geolocation only over https or a loopback address, so a page opened on a LAN address over http reports the location unavailable.
- **A blocked site stays blocked** — after the reader blocks the prompt, the card asks them to allow the site in the browser's settings; the page cannot re-open a prompt the browser has blocked.
- **Electron needs a native provider** — Chromium geolocation in Electron may need a Google API key; until a Host provider answers `location/request`, the desktop card can report the location unavailable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
