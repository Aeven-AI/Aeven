---
name: reverse-engineering
description: Work out how shipped software behaves from the artifact itself — native binaries, Electron and web bundles, APKs, firmware, databases, packet captures — with the shell already at hand. Use to explain how a feature works, recover versions and dependencies, compare two builds, or rebuild a behavior from what shipped.
---

# Reverse-engineer shipped software

Every row below is a command the shell already runs. There is nothing to register and nothing to start: identify the artifact, take the cheapest inventory, then read only the part that answers the question.

## Ground rules

- Work on a copy (`cp -c` is instant on APFS) and extract each target into `$TMPDIR/reverse/<name>`, reused for the rest of the task.
- Route by `file -b T` and the magic bytes first, inventory second, code last.
- Search extracted trees with `rg -uu`: `rg` skips hidden and ignored paths, and bundlers hide code in `.webpack/` and `.vite/`.
- Never `cat` a large or minified file. Slice it: `rg -o '.{0,200}NEEDLE.{0,200}' F | head`. Write a disassembly to a file once, then grep that file.
- Batch independent probes into one shell call, separated by `;` and `echo '--- name'` markers. Quote them: zsh expands a bare `==x`. Cap every output with `head`.
- Mark each claim **seen** (cite the file and offset, or the symbol and string) or **inferred**. A fact you did not find is **unknown**, not absent, and static reading is never observed execution.
- A missing tool is not a blocker: take the fallback in the same row, or install it when the person allows it.
- Independent artifacts fan out one target per subagent; track three or more in `todo_write`.
- Turns cost more than bytes: aim for two to four shell calls, then answer, and do not re-verify what you already saw.

## Route by artifact

| Artifact (`file -b`) | Fastest path |
| --- | --- |
| Mach-O | `lipo -info`, then `lipo -thin arm64 -o T1 T` if fat; `otool -L`; `nm -gU` exports and `nm -u` imports read as a capability map; `strings -a -n 6`; `codesign -d --entitlements :-`; `otool -ov` for ObjC classes. Disassemble with `otool -tV T > dis.txt`, then `llvm-objdump -d --no-show-raw-insn -C`. |
| ELF / PE | `readelf -hlSW`, `readelf -dW` for NEEDED, `nm -D --defined-only`, `objdump -d -M intel`. PE: `objdump -x`, `pefile` or `wrestool` for resources. Checksec with `pwn checksec`. |
| Go | `go version -m T` answers toolchain, module, dependencies and build flags in one call. Without Go: `strings -a T \| rg -m1 -A200 'Go buildinf'`. Symbols survive stripping: `go tool nm T \| rg main\.`. |
| Rust | `cargo audit bin T`, or inflate `.dep-v0` from `__DATA,.dep-v0`. Compiler: `strings -a T \| rg -o '/rustc/[0-9a-f]{40}' \| sort -u`. Crate sources: `strings -a T \| rg -o '[a-z0-9_-]+-[0-9]+\.[0-9]+\.[0-9]+/src'`. |
| .NET | `ilspycmd -p -o X T.dll`, then `rg` the tree; `rg DllImport X` for native calls. NativeAOT and IL2CPP are native: use the rows above. |
| Electron app | `npx -y @electron/asar extract app.asar X`; entry point `jq .main X/package.json`; `.node` addons live in `app.asar.unpacked/`. The IPC surface is where a feature answer usually lives (see below). Fuses: `npx -y @electron/fuses read --app A.app` — with `EnableNodeCliInspectArguments` off, `--inspect` is ignored. |
| Web bundle / minified JS | Find `sourceMappingURL`; if the map carries `sourcesContent`, read the original sources. Otherwise `npx -y prettier --parser babel F > F.pretty.js` and read with line ranges. In webpack output, grep the module ids, then slice around the hit. |
| Hermes / bytenode / V8 snapshot | Hermes magic `c6 1f bc 03` (an `index.android.bundle`): `hermes-dec` or `hbc-decompiler`. `.jsc` does not decompile: work from strings and runtime hooks. |
| APK | `jadx -d X --show-bad-code a.apk`, then `rg`. Manifest and resources only: `apktool d --no-src -o X a.apk`. Inventory: `unzip -l a.apk`. |
| Flutter | `lib/*/libflutter.so` means Dart AOT (`blutter`). In `libapp.so`, magic `f5 f5 dc dc`; the 32 hex characters at +20 are the snapshot hash, which maps to a Dart version. |
| WASM | `wasm-objdump -x`, `wasm2wat`, `wasm-decompile` (WABT). |
| SQLite | Copy the database and its `-wal` sibling. `sqlite3 'file:C?mode=ro' '.schema'`, then `SELECT * FROM t LIMIT 20`. |
| pcap / HAR | `tshark -r C -q -z conv,tcp`; hosts with `-T fields -e dns.qry.name -e tls.handshake.extensions_server_name -e http.request.full_uri`. HAR: `jq -r '.log.entries[].request \| .method+" "+.url'`. |
| plist / .car / bundle | `plutil -p F` — Info.plist holds the bundle id, URL schemes and permission strings. `assetutil --info Assets.car` for asset catalogs. |
| Firmware | `binwalk -e F`, or `unblob -e X F`. Send each extracted blob back through this table. |
| Website | `curl -sL URL` for the HTML and its scripts, then fetch the JS and slice it. Runtime behavior needs the browser beside the session. |
| Running process | `lldb -p PID`, `fs_usage`, `log stream --predicate 'process=="X"'`. Electron main needs `--inspect` and an allowing fuse. |

## One call each

Native binary:

```sh
T=./bin; D=$TMPDIR/reverse/$(basename $T); mkdir -p $D; file $T; lipo -info $T; otool -L $T
echo '--- EXPORTS'; nm -gU $T | head -150
echo '--- IMPORTS'; nm -u $T | rg -v '^__Z|napi_' | tr '\n' ' '; echo
echo '--- STRINGS'; strings -a -n 6 $T | rg -v '^[_$.]' | head -400
otool -tV $T > $D/dis.txt
echo '--- FUNCS'; rg '^[_a-zA-Z].*:$' $D/dis.txt | rg -v '^_?_?Z?N?St3' | head -150
```

Electron app:

```sh
A=./app.asar; X=$TMPDIR/reverse/asar; rm -rf $X
npx -y @electron/asar extract $A $X && jq '{name,version,main}' $X/package.json
find $X -path '*/node_modules' -prune -o -type f \( -name '*.js' -o -name '*.node' \) -print | head -60
ls ${A}.unpacked/node_modules 2>/dev/null
rg -uu -l --glob '!node_modules' 'exposeInMainWorld' $X
```

Then the IPC surface, which is what a feature answer usually needs:

```sh
rg -n -o '.{0,120}(ipcMain\.(handle|handleOnce|on|once)|ipcRenderer\.(invoke|send|sendSync|on)|contextBridge\.exposeIn(Main|Isolated)World|webPreferences|preload:|nodeIntegration|contextIsolation|sandbox|\.node\b).{0,160}' -uu $X --glob '!node_modules'
rg -uu -o '"[a-z]+:[a-z0-9:-]+"' $X/<main> | sort -u   # wrappers hide the channel names
```

## Read the code, not the file

- Let one command answer the whole question where it can: `otool -L` or `readelf -dW` for every library the binary needs, `go version -m` for a Go toolchain and its dependencies, `nm -u` for the capability map its imported symbols describe.
- Go from the boundary inward: native call, caller class, IPC registration, the renderer that invokes it.
- Find who uses a string with `rg -n 'literal pool for: "NEEDLE' dis.txt`, then read the function label above that line.
- Read one function at a time: `awk '/^_FUNC:$/{p=1;next} p&&/^[_a-zA-Z].*:$/{exit} p' dis.txt | rg 'bl|call|cmp|literal'`. A C++ name at a `bl` target already names the protocol, so the call sequence is usually enough and pseudocode is not.
- Real pseudocode only when instructions are not enough: Ghidra `analyzeHeadless $D p -import T -postScript DecompileAll.java -deleteProject`, or `r2 -qc 'aaa; pdc @ sym.X' T`.
- Comparing two versions starts with the inventories (`nm`, the module list, `go version -m`) before any code diff.
- Rebuilding means writing the smallest reimplementation and running it against the original on the same inputs, not reading more disassembly.

## When the artifact is not enough

Static reading shows what the code can do, never what it did. When the answer is what happens at runtime, run it and record: the app's log, `fs_usage`, `lsof -p PID`, a proxy or the browser's network log.

For a screenshot, a native dialog, or a window on the person's own screen, use computer use: load the `mcp__cua-driver-mcp__*` tools with tool search, check permissions with `prompt: false` first, and look at the screen before and after each action. Ask the person before anything that deletes data, sends a message, or changes an account.
