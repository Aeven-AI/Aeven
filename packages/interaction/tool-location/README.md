---
description: "The model-facing get_location tool: how deployments mount it, bound its wait, and set its precision, and what the model sees."
kind: "package-reference"
---

# @aeven/tool-location

English | [中文](README.zh.md)

## Summary

`@aeven/tool-location` lets the model ask the reader where they are. It registers one tool, `get_location`, whose call becomes a `location/request` waterfall that the client showing the session answers. The reader approves the location permission or declines; nothing is read without that approval, and the model states why it needs the location before the reader is asked. Without a client able to ask, the call reports the location as unavailable.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in an agent composition whose client can ask the reader, such as the Web client with `@aeven/client-ui-location`. The shipped `cordis`, `standard`, and `ptc` presets mount it.

### Configuration

Both fields are optional; invalid values fail plugin load.

| Field | Default | Effect |
| --- | --- | --- |
| `precision` | `precise` | `precise` passes the device reading through. `approximate` rounds latitude and longitude to two decimals, about 1.1 km, and reports at least 1,100 m of accuracy. |
| `consentTimeoutMs` | `120000` | Milliseconds the reader has to choose, declared as the tool's `timeoutMs`. `@aeven/tool-call-timeout-policy` enforces it and the model receives `TOOL_TIMEOUT`. |

```yaml
- id: tool-location
  name: '@aeven/tool-location'
  config:
    precision: approximate
```

A deployment that must never ask for a location leaves the row out.

<a id="understand-the-implementation"></a>
## Understand the implementation

The tool dispatches `location/request` scoped to the calling agent, carrying the model's `purpose` and the call's signal. In a Web composition `@aeven/api-remotes` forwards it to the Typert gateway, which delivers it to every connected client and waits until one answers; the tool timeout bounds that wait. A listener that cannot ask calls `next()`, and the final fallback answers `unavailable`. A native provider, such as one reading Core Location on the Host, can answer the same waterfall.

The answer is one of `device` (latitude, longitude, `accuracyMeters`, timestamp), `declined`, `unavailable` (a reason), or `manual` (a named place, for an answerer that offers one; the Web client does not). `renderLocationAnswer` turns it into the tool result, applying the configured precision.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`get_location` schema](../../../docs/tool-catalog.md#aeventool-location). A device answer is a JSON object with `source: "device"`, `precision`, `latitude`, `longitude`, `accuracyMeters`, and an ISO `timestamp`; a typed place is `{"source": "manual", "place": …}`.

##### Declined result

```markdown
The user declined to share their location. Ask where they are if the task needs it, or continue without it.
```

##### Unavailable result

```markdown
The location is unavailable: <reason>. Ask the user where they are if the task needs it.
```

#### Token effect

The schema is fixed per request while the tool is visible; a call adds one short result.

#### KV Cache effect

Prefix-stable while the visible tool set is unchanged; a result is appended.

## Known Limitations and Deferred Work

- **No native OS provider** — the Web client reads the browser's Geolocation API. Electron's Chromium geolocation may need a Google API key, so the desktop app can report the location as unavailable; a Core Location, Windows.Devices.Geolocation, or GeoClue provider answering `location/request` on the Host is deferred.
- **No saved places** — the reader approves the browser's location permission; once the browser allows the site, later requests read the device without a card.
- **Coordinates reach the model** — there is no places or geocoding tool that could consume them directly, so the model receives the coordinates it searches with.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
