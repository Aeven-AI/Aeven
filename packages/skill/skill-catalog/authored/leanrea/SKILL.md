---
name: leanrea
description: Reverse engineer shipped software with plain local CLI tools and no server or agent: Electron and web bundles, native Mach-O/ELF/PE, Go, Rust, .NET, Flutter, WASM, APKs, SQLite, packet captures, firmware, websites. Use to explain how a feature works, extract versions and dependencies, compare two builds, or rebuild a feature from what shipped.
---

# leanrea: the shell-only fast path

No server, no child process, no registration: every command here is one the shell already runs. Route the artifact by `file -b T` and the magic bytes, take the cheapest inventory, then slice only the code that answers the question. For decompiler depth — pseudocode, callers, a retained evidence record — load the `reverse-engineering` skill instead; this one stays useful when nothing else is running.

## Rules

- Work on a copy (`cp -c` is instant on APFS) in `$TMPDIR/re/<name>`, and reuse an extraction that already exists.
- Search extracted trees with `rg -uu`: `rg` skips hidden and ignored paths, and bundlers hide code in `.webpack/` and `.vite/`.
- Never `cat` a large or minified file. Slice it: `rg -o '.{0,200}NEEDLE.{0,200}' F | head`. Write a disassembly to a file once, then grep that file.
- Batch independent probes into one shell call, separated by `;` and `echo '--- name'` markers. Quote them: zsh expands a bare `==x`. Cap every output with `head`.
- Mark each claim **seen** (cite file:offset, symbol, or string) or **inferred**. A fact you did not find is **unknown**, not absent, and static reading is not observed execution.
- A missing tool is not a blocker: take the fallback in the same row, or install it when the person allows it.
- Turns cost more than bytes: two to four calls — one batched recon, one or two slices — then answer.

## First move, one call each

Native (Mach-O):

```sh
T=./bin; D=$TMPDIR/re/$(basename $T); mkdir -p $D; file $T; lipo -info $T; otool -L $T
echo '--- EXPORTS'; nm -gU $T | head -150
echo '--- IMPORTS'; nm -u $T | rg -v '^__Z|napi_' | tr '\n' ' '; echo
echo '--- STRINGS'; strings -a -n 6 $T | rg -v '^[_$.]' | head -400
otool -tV $T > $D/dis.txt
echo '--- FUNCS'; rg '^[_a-zA-Z].*:$' $D/dis.txt | rg -v '^_?_?Z?N?St3' | head -150
```

One function out of that disassembly: `awk '/^FUNC_LABEL:$/{p=1;next} p&&/^[_a-zA-Z].*:$/{exit} p' $D/dis.txt | rg 'bl|b\.|cmp|literal|mov\s+w2'`.

Electron:

```sh
A=./app.asar; X=$TMPDIR/re/asar; rm -rf $X
npx -y @electron/asar extract $A $X && jq '{name,version,main}' $X/package.json
ls ${A}.unpacked/node_modules 2>/dev/null
rg -n -o '.{0,120}(ipcMain\.(handle|on)|ipcRenderer\.(invoke|send)|contextBridge\.exposeIn\w+|webPreferences|preload:|nodeIntegration|contextIsolation|\.node\b).{0,160}' -uu $X --glob '!node_modules'
```

## The rest, one line each

| Artifact | Command |
| --- | --- |
| ELF / PE | `readelf -hlSW`, `readelf -dW` for NEEDED, `nm -D --defined-only`, `objdump -x` for PE resources |
| Go | `go version -m T`, else `strings -a T \| rg -m1 -A200 'Go buildinf'`; symbols survive stripping: `go tool nm T \| rg main\.` |
| Rust | `strings -a T \| rg -o '/rustc/[0-9a-f]{40}' \| sort -u`; crates in `strings`: `[a-z0-9_-]+-[0-9]+\.[0-9]+\.[0-9]+/src` |
| .NET | `ilspycmd -p -o X T.dll`, then `rg DllImport X` |
| APK | `jadx -d X --show-bad-code a.apk`; manifest only: `apktool d --no-src -o X a.apk` |
| Flutter | `libflutter.so` means Dart AOT (`blutter`); `libapp.so` magic `f5 f5 dc dc`, snapshot hash at +20 |
| Hermes / bytenode | magic `c6 1f bc 03`: `hermes-dec` or `hbc-decompiler`; `.jsc` does not decompile — strings and runtime hooks |
| WASM | `wasm-objdump -x`, `wasm2wat`, `wasm-decompile` |
| SQLite | copy the database and its `-wal` sibling; `sqlite3 'file:C?mode=ro' '.schema'` |
| pcap / HAR | `tshark -r C -q -z conv,tcp`; `jq -r '.log.entries[].request \| .method+" "+.url'` |
| plist / .car | `plutil -p F`; `assetutil --info Assets.car` |
| Firmware | `binwalk -e F` or `unblob -e X F`, then route each blob back through this table |
| Website | `curl -sL URL`, then fetch and slice its scripts; runtime behavior needs the browser beside the session |

## Answer shape

Lead with what the artifact does, then the evidence for it: the symbol, string, IPC channel, schema, or module that shows it, with the offset when it is in a disassembly. Say which questions the artifact cannot answer, and stop there instead of padding.
