# Agent Note: The read-aloud voice picker uses the popupSelect card and gains a Settings row

Status: implemented

English | [中文](2026-11-25-read-aloud-voice-picker-uses-the-popupselect-card.zh.md)

## Problem

The composer's System voice row opened a card of its own design: a sectioned list with one sticky header per language and a trailing check on the current voice. The Image model and Video model rows beside it open the shared popupSelect card from `ui-commands`, which has a search field, a different surface, and different rows, so the three neighbouring rows opened two kinds of popup. The voice card could not be searched, and the Catalogue holds dozens of languages. Voices could be chosen only from the composer, not from Settings, where the dictation model is set.

## Decision

The composer row opens the popupSelect card through `commandUi.openSelect(sessionId, 'voice', spec, row, 'beside')`, the call the model rows reach through `invokeFromButton`. The first card lists the languages, with the voice count as the row detail and the language subtag as a search keyword, so the card's search matches the language name or its code. Picking a language calls `openSelect` again with that language's voices: Default first, naming the voice it resolves to, then every voice, the current choice marked `active`. The second open replaces the controller's binding, so the settled language pick returns without closing the card. Picking a voice writes the existing per-language preference in `localStorage`. The row is registered inside `ctx.inject(['commandUi'])`, as `ui-imagine` registers its pickers.

Settings → General → Voice gains a `settings.voice.item` list that `ui-voice-input`'s Voice group renders after the dictation model rows, and `ui-tts` registers a Read-aloud voices row in it. The popupSelect card renders only in the composer's overlay seat, so the row draws the card's markup, keys, and stylesheet: `VoiceSettingsRow.module.css` copies `PopupSelectView.module.css` rule for rule and SettingsSelect's pill, and changes only the card's placement, fixed from the pill above the settings panel. Escape closes the card without reaching the settings panel's document listener. Both surfaces build their rows with `languageRows`, `voiceRows`, and `filterRows` in `voices.ts`.

## Alternatives considered

**Keep the sectioned card and add a search field to it.** That kept a second popup design beside the model rows, which is the inconsistency this change removes.

**One flat list of every voice with the language as detail.** It drops the per-language Default row and lists hundreds of rows before a language is picked.

**Export a presentational card from `ui-commands`.** It would let Settings render the card instead of copying its stylesheet, but it splits the shared shell for one consumer; the copy names its source so the two can be compared.

## Consequences

The composer's voice choice takes two picks, language then voice. The Settings card and the popupSelect card share one look through a copied stylesheet, so a change to `PopupSelectView.module.css` must be carried into `VoiceSettingsRow.module.css`. Preferences stay in this browser's storage, as before.
