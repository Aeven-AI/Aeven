# Agent Note: Voice settings model preparation

Status: implemented

English | [中文](2026-09-30-voice-settings-model-preparation.zh.md)

## Problem

Voice settings presented model sizes, download sources, internal preparation steps, and detailed download diagnostics before a person could use dictation. These choices and implementation details made a basic speech control look like a setup tool.

## Decision

The section shows one voice-model status per recognizer with a Download or Retry button, and the composer's mic starts preparation too: pressing it with no model installs one and opens this section, where the run is visible. Opening the section alone starts nothing. The existing Host preparation call chooses its download source. A completed inspection or failed preparation releases its slot for a new request even before its cleanup callback runs, so a retry starts. While preparation runs, the row shows its status and a full-width bar built like the Account page's allowance bar: an 8px track with 4px corners in the platform background colour, filled in the success colour by the downloaded percentage. The section title is Voice, with dictation described as its current use.

## Alternatives considered

**Start preparation when the settings page opens.** Opening the panel would begin a model download of roughly 190 MB without a click, so a person who only wanted to read the setting could not decline it, and the download's result appeared before they could watch it start.

**Keep a manual download source selector.** The Host already owns source selection and fallback, so those controls add work without a necessary user choice.

**Show every preparation step.** This helps diagnose a setup failure but obscures the result regular users need. The Host retains detailed state for diagnostics while the settings page presents one status.

## Consequences

Installing the model is one explicit action whose outcome is visible as Ready, or as a failure with Retry and the Host's message. The settings page does not expose source selection, resource estimates, cancellation, or individual preparation stages; operators use Host diagnostics when they need that detail.
