# Aeven Python SDK

English | [中文](README.zh.md)

Python packages for driving Aeven as a subprocess. The client SDK communicates with the bundled runtime over newline-delimited JSON-RPC on stdio.

## Packages

| Directory | Dist / module | Role |
|---|---|---|
| [sdk](sdk/README.md) | `aeven-sdk` / `aeven` | High-level turns API and lower-level JSON-RPC client |
| [sdk-runtime](sdk-runtime/README.md) | `aeven-runtime-bin` / `aeven_runtime` | Bundled `avn` CLI executable and native sidecars |

## Behavior

The SDK starts the matching bundled `avn --profile sdk` runtime unless the caller selects another `avn` executable or profile. The runnable minimal example selects the shipped standalone `sdk-minimal` profile; the same runtime also packages `avn web` and its frontend assets for separate CLI use. Every launch requires an explicitly selected Aeven home; Python never silently reads `~/.aeven`. The [SDK reference](sdk/README.md) and [runtime carrier reference](sdk-runtime/README.md) own runtime selection, profiles, patches, and external plugin management.

## Contributor workflows

The [Python contributor workflows](development.md) cover building runtime artifacts, validating the packages, source-mode development, and distribution.
