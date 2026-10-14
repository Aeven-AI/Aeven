---
description: "Settings shell, ownerless copy, and durable product-onboarding namespace for the avn web client: the General section, trigger chrome, and onboarding ledger projection."
kind: "package-reference"
---

# @aeven/client-ui-settings-general

English | [中文](README.zh.md)

## Summary

`avn-client-ui-settings-general` is the settings shell of the avn web client: the Settings panel opens from the sidebar's bottom control, a connection toast at the top of the window offers immediate recovery, the navigation is built from the sections features contribute, and first-run users are walked through one onboarding step at a time. It also registers everything on the Settings pages that belongs to no single feature: the trigger/header/close chrome content, the local configuration-file action, the General section and its `settings.general.item` slot, and the `settings` dictionaries. Feature-owned rows (Permission, Language), sections (Appearance, Models), and conditional onboarding steps stay with their feature packages; the shell itself ships no onboarding copy of its own.

The panel and navigation consume the Aeven 30px surface radius, 20px control radius, neutral surfaces, and Google Sans Flex typography while retaining the settings information architecture. At viewport widths of 768px and below, the navigation moves from the side rail to a horizontally scrolling tab strip under the title row so the section keeps the full panel width; at 640px and below, the panel fills the viewport.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Users reach the shell through the sidebar's bottom Settings control; feature plugins contribute their pages and onboarding steps through the slot ledgers this shell projects. After a Host connection failure, a toast centered at the top of the window shows **Disconnected** with a **Reconnect now** action; automatic recovery shows **Connecting** with one to three dots advancing every 500ms, and the action starts retry 1 immediately. Its close button hides the toast for the rest of that outage. Recovery changes the toast to **Connected** for two seconds before it disappears. Initial startup and uninterrupted healthy operation remain silent. The shell renders the modal panel, the navigation built from `settings.section` entries, and exactly one mounted onboarding step at a time.

### The General section

The General section holds rows registered into `settings.general.item` by feature packages, plus two rows of its own. Run in the background appears only in the desktop application, whose preload bridge stores the choice; the browser build has no bridge and no row. Developer mode is stored as `enabled` in the `ui-developer` settings namespace this package registers. Developer surfaces such as the agent-preset roster mount only while it is on; consumers import the namespace's type from `./client` and bind it through `ctx.settingsScope`. Feature plugins own their row copy and behavior. Language, for example, lives in client-locale. The Appearance section lives in ui-theme.

### Opening the configuration file

On a loopback browser, the shell renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action opens that document in the native text editor (bypassing the browser file association on macOS). Remote browsers never register the action and never issue the privileged settings read.

### Onboarding steps

The onboarding ledger projects in ascending order and mounts exactly one step at a time. Registrants own durable completion, capability readiness, copy, mutations, and their visible wrapper, so independently registered flows cannot stack and the shell does not become a second configuration fact source. Visible steps own their dialog chrome and app-root `inert` lifecycle.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell owns the chrome and the projections; every piece of content and copy belongs to a registrant.

### Ledger projections

Models, Agent presets, Plugins, and Subscriptions (`grok-build`) each carry their own navigation glyph; every other section uses the settings gear. The navigation is a projection of the `settings.section` ledger; nav labels may be locale-following thunks, resolved through `resolveSlotLabel` and re-rendered on the section ledger bump or the locale revision (an optional `ctx.get('locale')` read; no hard locale dependency). The onboarding ledger projects in ascending order; the active registrant receives its id, `complete()`, and an `openSection(id)` callback, and completing or skipping transfers ownership to the next entry.

### Connection recovery

The shell is an explicit recovery consumer, so it injects Connection directly rather than adding lifecycle controls to `ctx.remote`. Its private hooks compartment binds `ctx.connection.state`, while the component receives only the selected state and an injected callback for `ctx.connection.reconnect()`. `ConnectionIndicator` owns the toast presentation and receives all visible and accessible copy from the `settings` locale namespace; the shell owns the two-second recovered-state timer.

### Document availability

On a loopback page, the Client loads the provider's `hasDocument` capability through `settings/describe` and renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action calls the pathless, browser-authenticated `settings/openSettingsDocument` Remote; the Host resolves the provider path again, materializes an absent document, and hands it to a native text editor (`open -t` on macOS, bypassing a browser file association; the desktop file association on Linux and Windows; Windows association after `wslpath -w` translation on WSL). Open failures keep the action available and render a localized error. Reopening the dialog or reconnecting refreshes availability after a transient read failure or Host topology change. Non-loopback pages retain the Client policy that withholds this native action and its settings read.

### Host half

The Host half registers `ui-onboarding` in the user-settings seam so documents written by the retired product notice keep a valid home; no shipped surface reads or writes its one historical `welcomeNoticeVersion` field. The shell itself remains policy-free.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the settings surface family and the composition model.

- [ui-settings](../ui-settings/README.md) — the domain base whose slot types and scope service this shell builds on.
- [ui-sidebar](../ui-sidebar/README.md) — the sidebar shell hosting the `sidebar.settings` seat.
- [ui-settings-models](../ui-settings-models/README.md) — the feature package contributing the DeepSeek onboarding step.
- [settings](../../settings/README.md) — the durable user-settings seam and its file provider.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the ledgers.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell itself provides versus what features must supply; they are current package constraints.

- **The General section owns only the Run in the background and Developer mode rows** — every other row appears only when its owning feature plugin is mounted.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The settings seam validates and publishes the durable onboarding section, while slot conflicts fail loud in the slot core. The local document action is browser state over typed RPC responses and is covered by store/component tests rather than a Cordis runtime relationship.
