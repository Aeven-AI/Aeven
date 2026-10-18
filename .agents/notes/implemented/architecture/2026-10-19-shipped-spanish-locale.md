# Agent Note: Spanish as a shipped GUI locale

Status: implemented

English | [中文](2026-10-19-shipped-spanish-locale.zh.md)

## Problem

The browser GUI shipped two locales, `zh` and `en`, and `LocaleRuntime.register` required exactly that pair: the typed object form takes `Record<BuiltInLocaleId, LocaleDictOf<N>>` over `LOCALE_IDS`. A shipped third language therefore had no supported route. The language-pack seam that exists for external plugins registers one locale at a time through the untyped `register(ns, locale, dict)` overload, so a language shipped that way could miss keys and blend Spanish and English in one screen while every gate stayed green.

## Decision

**Spanish (`es`) is a built-in GUI locale.** `LOCALE_IDS` lists `zh`, `en`, and `es`, and `BUILT_IN_LOCALE_METADATA` gives `es` the label `Español` with `en` as its fallback, so a browser asking for `es-419` matches by primary subtag and a key missing from a future namespace still resolves. Adding an element to `LOCALE_IDS` turns every typed `register(ns, { zh, en })` call site into a compile error until it also carries an `es` dictionary — the completeness the language-pack seam cannot enforce.

**Every shipped namespace carries a Spanish dictionary checked against the `zh` key set.** Dictionaries keep their existing shape: `zh` remains the key-set source of truth, `en` and `es` are checked against it at compile time, and a file that annotates `en` annotates `es` the same way. Pre-sign-in `auth.aeven` copy never reaches the locale service — the gate runs before the plugin graph — so it carries its own `es` entry in its dictionary table and matches browser tags by the same primary-subtag rule.

**The dictionary-parity gate verifies every shipped locale.** `scripts/locale-dictionary-parity.spec.ts` discovers `es` dictionaries and `Es`-suffixed names, compares every locale present in a pair against `zh`, and holds a floor on how many pairs declare Spanish, so a narrowed sweep fails instead of passing vacuously over fewer languages.

Spanish copy is neutral Latin American, informal second person, and keeps product names, model ids, protocol tokens, and `{placeholder}` names verbatim; Spanish punctuation (`«»`, `…`) replaces the English quoting.

## Alternatives considered

**Ship Spanish as an external language pack.** Rejected. That seam exists for out-of-tree languages, its single-locale registration is untyped, and a partially translated pack would render one screen in two languages with no gate noticing.

**Derive `es` from the `en` key order instead of declaring it.** Rejected. Key drift would then surface as a bare key in a running UI, which is exactly the failure the `zh`/`en` pair already guards against.

## Consequences

A shipped language now costs one complete dictionary set: `pnpm run typecheck` names every namespace that lacks one, and the parity spec names every key that drifted. The opening locale is unchanged — `FALLBACK_LOCALE` still points at `en`, and browser detection still decides the provisional language. The language-pack path stays available for languages that are not shipped in-box. Spanish needs no plural rule beyond the existing `.one`/`.other` key pairs, but gender agreement inside count phrases is a translation concern no dictionary gate can check. `packages/client/locale/tests/apply.client.spec.ts` and `document-language.client.spec.ts` pin the Spanish copy and the `es` document tag; the locale README pair records the shipped set.
