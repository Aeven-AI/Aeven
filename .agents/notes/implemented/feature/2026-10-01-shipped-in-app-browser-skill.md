# Agent Note: Shipped in-app browser skill

Status: implemented

English | [中文](2026-10-01-shipped-in-app-browser-skill.zh.md)

## Problem

A session's skill catalog came from disk alone: `.aeven/skills` and `.agents/skills` under the project root, `~/.aeven/skills`, `~/.agents/skills`, and a `bundled` root that no shipped composition configured. A clean install therefore starts with an empty catalog — the `avn-*` skills a maintainer sees exist only because the working directory is this checkout. The procedure for the browser beside the session was in the same position: the model-facing policy in `@aeven/tool-browser` covers the `preview_*` tools and the escalation order, but says nothing about the pane's own toolbar, about capturing pixels, or about recovering from a pane that is closed, refuses a read, or hides behind a consent wall. That knowledge lived in one user's learned capabilities, which a fresh install does not have.

## Decision

`@aeven/agent-presets` ships the skills, and every shipped preset that discovers local skills mounts the shipped directory as a `customSkillDirs` root resolved from its own composition URL:

```yaml
- id: skill-filesystem
  name: '@aeven/skill-filesystem'
  config:
    customSkillDirs:
      - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('./skills/', baseUrl))"
```

- The skills live once, in `presets/aeven/skills/`. The `aeven` preset resolves `./skills/`; `standard`, `ptc`, and `cordis` resolve `../aeven/skills/`; `minimal` mounts no filesystem discovery and gets none of them.
- `baseUrl` is the composition's own URL, so the root resolves in a checkout and in an installed package alike. `presets` is already in the package's `files`, so the skills travel with the package: no copy step, no `extraResources`, and no launcher that has to resolve and export a directory.
- The root registers at rank 300 (`custom`), above the user roots, so a shipped skill wins a name against a local copy of the same name.
- The repository path `.agents/skills/<name>/SKILL.md` is a relative symbolic link to the shipped file, so a maintainer session discovers the same file rather than a second copy.
- The first shipped skill is `in-app-browser`: pick the surface (`preview_*` first), read and drive the page, capture the pane, press its toolbar, and recover when it cannot serve. Its `scripts/pane.mjs` and `references/cdp-surface.md` are resolved against the base directory the loader prints in `<skill_resources>`.
- `tests/skills.spec.ts` holds the shape: every rendered body stays below the standard preset's `thresholdChars: 8192`, every resource a body names exists and stays readable below the same threshold, the catalog description stays within `@aeven/tool-skill`'s 500-character cap, the repository alias resolves to the shipped file, the shipped directory reaches a catalog through `@aeven/skill` and `@aeven/skill-filesystem`, and each composition that mounts `skill-filesystem` resolves its `customSkillDirs` entry to the shipped directory.

## Alternatives considered

- **`.agents/skills` only.** Invisible to any install whose project root is not this checkout, which is the case the request was about.
- **A dedicated provider package at the bundled rank** — the shape of `@aeven/skill-badge` and, upstream, of a package that registers one immutable candidate per asset directory. It is the right shape when a skill needs runtime paths injected into its text, because the provider can append them. `in-app-browser` needs none: `preview_status` reports the surface at run time, so a provider and its composition row would carry no information the skill does not already have.
- **`bundledSkillDir` or `$AVN_BUNDLED_SKILL_DIR`.** The rank-600 root works, but something must resolve the directory for each install shape — checkout, npm install, Electron seed — and export it before the composition loads. A URL relative to the composition needs no such step.
- **Prompt text only.** t3code, which has the same pane, ships no skill for it and puts its browser policy in per-turn developer instructions that are omitted when the tools are absent. `@aeven/tool-browser` already carries that policy here; a skill adds the procedure the policy does not hold without lengthening every turn's prompt.

## Consequences

- A clean install on `aeven`, `standard`, `ptc`, or `cordis` now lists `in-app-browser`, and its description costs its code points in every session's catalog message on those presets.
- The skill's script route reaches the pane over the application's DevTools port, which is a development and desktop surface. The skill names the `preview_*` route first, states why the script route is a last resort, and forbids neither.
- A deployment that edits a shipped skill changes every session on that preset. A deployment that must differ copies the preset into a user root, and that copy deliberately carries none of the shipped skills.
- `@aeven/skill` and `@aeven/skill-filesystem` join the package's devDependencies for the catalog test; neither is a runtime dependency of the package.

## Related

- [Layered skill registry](../architecture/2026-08-09-layered-skill-registry.md) owns the registry shape this row registers into: a preset's `skill-filesystem` contributes to that preset's layer, which is why the mount lives in the preset file rather than the host composition.
- [Host-plane ownership after presets](../architecture/2026-08-10-host-plane-ownership-after-presets.md) records why the host `skill-filesystem` row is disabled in the Web composition and presets own local discovery.
- [Per-session agent presets](../architecture/2026-08-03-per-session-agent-presets.md) owns the preset roster, the copy-only authoring rule, and the reason a copy carries no shipped skills.

