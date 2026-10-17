---
name: reverse-engineering
description: Work out how shipped software behaves from the artifact itself — native binaries, Electron and web bundles, APKs, firmware, databases, packet captures — using the rea tool server where it reaches further and the shell everywhere else. Use to explain how a feature works, recover versions and dependencies, compare two builds, or rebuild a behavior from what shipped.
---

# Reverse-engineer shipped software

Two instruments, one route: the `rea` server answers what a command cannot — pseudocode, callers and callees, formats it parses directly, an evidence record that outlives the session — and the shell answers everything else without starting a process. Load the server's tools with one `tool_search` for `rea` before the first target; they arrive as `mcp__rea__*` and nothing else here needs registering.

Identify the artifact with `file -b` and the magic bytes, take the cheapest inventory, then read only the part that answers the question.

## Route by artifact

| Target | rea tool | Shell path when the server is absent or a provider engine is missing |
| --- | --- | --- |
| Native executable, library, analysis database | `open_binary`, then `binary_overview` | `lipo -info`, `otool -L`, `readelf -hlSW`, `nm`, `strings` |
| One function: pseudocode, callers, callees | `analyze_function` after `open_binary` | `otool -tV T > dis.txt`, `objdump -d -M intel`, grep `dis.txt` |
| Electron or extracted JavaScript tree, ASAR | `analyze_javascript_application` | `npx -y @electron/asar extract`, then `rg -uu` |
| APK classes, methods, incoming references | `inspect_android_package` | `jadx -d X --show-bad-code`, `apktool d --no-src` |
| Managed PE or CLI assembly | `inspect_managed_artifact` | `ilspycmd -p -o X T.dll` |
| Firmware image | `inspect_firmware_regions`, `extract_firmware` | `binwalk -e`, `unblob -e` |
| Go build info, modules, build flags | `inspect_go_binary` | `go version -m T`, or `strings -a T \| rg -A200 'Go buildinf'` |
| Rust cargo-auditable dependencies | `inspect_rust_binary` | inflate `.dep-v0` from `__DATA` |
| SQLite snapshot, schema, rows | `inspect_sqlite_database` | `sqlite3 'file:C?mode=ro' '.schema'` |
| HAR, SAZ, recorded web traffic | `inspect_web_network_capture` | `jq -r '.log.entries[].request \| .method+" "+.url'` |
| Packet captures and field discovery | `inspect_packet_capture`, `inspect_pcap_capture`, `inspect_packet_fields` | `tshark -r C -q -z conv,tcp` |
| WASM artifact, EVM bytecode | `inspect_wasm_artifact`, `inspect_evm_interface` | `wasm-objdump -x`, `wasm2wat` |
| ELF layout, PE resources, core dump | `inspect_binary_layout`, `inspect_pe_resources`, `inspect_recorded_crash` | `readelf -a`, `objdump -x`, `lldb --core` |
| Packaged Electron app, fuses, open runtime | `inspect_electron_fuses`, `list_electron_targets` | `npx -y @electron/fuses read --app A.app` |
| Browser page, or actions to drive | `list_browser_targets`, `capture_browser_scenario` | `curl -sL URL` and the browser beside the session |

Hermes (`c6 1f bc 03`) and bytenode `.jsc` have no server route: `hermes-dec` or `hbc-decompiler` for the bundle, strings and runtime hooks for the rest. A stripped binary whose call target needs a decompiler database is exactly the case the server exists for.

## Ground rules

- Work on a copy (`cp -c` is instant on APFS) in `$TMPDIR/reverse/<name>`, reused for the task.
- Search extracted trees with `rg -uu`: `rg` skips hidden and ignored paths, and bundlers hide code in `.webpack/` and `.vite/`.
- Never `cat` a large or minified file. Slice it: `rg -o '.{0,200}NEEDLE.{0,200}' F | head`. Write a disassembly to a file once, then grep that file.
- Batch independent probes into one shell call, separated by `;` and `echo '--- name'` markers. Quote them: zsh expands a bare `==x`. Cap every output with `head`.
- Mark each claim **seen** (cite the file and offset, the symbol and string, or the tool's evidence id) or **inferred**. A fact you did not find is **unknown**, not absent, and static reading is never observed execution.
- Read each result's stated limitations and unknowns instead of assuming it covered more; a missing provider engine narrows that one answer, not the task.
- Independent artifacts fan out one target per subagent, three or more tracked in `todo_write`. Turns cost more than bytes: aim for two to four calls, then answer.

## One call each

Native binary, when the server is not the route:

```sh
T=./bin; D=$TMPDIR/reverse/$(basename $T); mkdir -p $D; file $T; lipo -info $T; otool -L $T
echo '--- EXPORTS'; nm -gU $T | head -150
echo '--- IMPORTS'; nm -u $T | rg -v '^__Z|napi_' | tr '\n' ' '; echo
echo '--- STRINGS'; strings -a -n 6 $T | rg -v '^[_$.]' | head -400
otool -tV $T > $D/dis.txt
echo '--- FUNCS'; rg '^[_a-zA-Z].*:$' $D/dis.txt | rg -v '^_?_?Z?N?St3' | head -150
```

Electron app, and the IPC surface that a feature answer usually needs:

```sh
A=./app.asar; X=$TMPDIR/reverse/asar; rm -rf $X
npx -y @electron/asar extract $A $X && jq '{name,version,main}' $X/package.json
rg -n -o '.{0,120}(ipcMain\.(handle|handleOnce|on|once)|ipcRenderer\.(invoke|send|sendSync|on)|contextBridge\.exposeIn(Main|Isolated)World|webPreferences|preload:|nodeIntegration|contextIsolation|sandbox|\.node\b).{0,160}' -uu $X --glob '!node_modules'
```

## Read the code, not the file

- Let one call answer the whole question where it can: `otool -L`/`readelf -dW` for linked libraries, `inspect_go_binary` for a toolchain, `nm -u` for the capability map.
- Go from the boundary inward: native call, caller class, IPC registration, the renderer that invokes it.
- One function at a time: `analyze_function` for its pseudocode and callers, or `awk '/^_FUNC:$/{p=1;next} p&&/^[_a-zA-Z].*:$/{exit} p' dis.txt | rg 'bl|call|cmp|literal'`. A C++ name at a `bl` target names the protocol, so the call sequence is usually enough.
- Two versions compare by inventory first (`nm`, the module list, `inspect_go_binary`). A rebuild means running the smallest reimplementation against the original on the same inputs.

## When the artifact is not enough

Static reading shows what the code can do, never what it did. For runtime behavior, observe: the app's log, `fs_usage`, `lsof -p PID`, a proxy, or `capture_browser_scenario` with the actions to perform.

For a screenshot, a native dialog, or a window on the person's own screen, use computer use: load the `mcp__cua-driver-mcp__*` tools with tool search, check permissions with `prompt: false` first, and look at the screen before and after each action. Ask the person before anything that deletes data, sends a message, or changes an account.
