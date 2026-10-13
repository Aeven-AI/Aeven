# Agent Note: Location as a consented tool

Status: implemented

English | [中文](2026-09-24-location-as-a-consented-tool.zh.md)

## Problem

Asked "what is the weather here?" or "pharmacies near me", the model had only IP-derived hints, which are city-level at best and wrong behind a VPN. The workaround was granting location to the browser through DevTools. Location is personal data, so it cannot become ambient context sent on every request.

## Decision

Location is a tool the model calls, answered by the reader:

- `@aeven/tool-location` registers `get_location` with a required `purpose`. The call dispatches the agent-scoped `location/request` waterfall and renders the answer: device coordinates with `accuracyMeters`, a typed place, declined, or unavailable with a reason. `precision: approximate` rounds coordinates to about a kilometre. The wait is the tool timeout `consentTimeoutMs`, because a forwarded waterfall stays pending until a client answers ([bounded browser status lookup](../bug-fix/2026-09-24-bounded-browser-status-lookup.md)).
- `@aeven/client-ui-location` answers the waterfall in the Web client. The browser's permission prompt is the reader's one approval: a site the browser already allows is read without a card; otherwise the read starts at once and a composer card, **Allow Aeven to know your precise location?**, explains the prompt with **OK** to read again and **No** to decline this request only. A first design asked in the card before the browser prompt, which made the reader approve twice.

The waterfall is the provider seam: a Host listener reading Core Location, Windows.Devices.Geolocation, or GeoClue can answer the same event without changing the tool or the model contract.

## Alternatives considered

**Inject the location into every request.** It removes a tool call, but sends personal data the task may not need and makes every request depend on a permission the reader never gave for that purpose.

**IP geolocation as the default answer.** It needs no consent, but claims a location with kilometres of error; it stays out of the answer set rather than being labelled "your location".

**Native OS providers first.** They avoid Electron's Google-backed Chromium geolocation and fit a local-first product, but need per-platform code and packaging entitlements; the browser path serves the Web client today and the seam leaves room for them.

## Consequences

- The model receives coordinates, because no places or geocoding tool could consume them directly; `approximate` precision is the deployment control.
- Browsers expose geolocation only to secure contexts, so a Web client on a LAN address over http reports the location unavailable.
- The desktop app can report the location unavailable until a native provider exists.
