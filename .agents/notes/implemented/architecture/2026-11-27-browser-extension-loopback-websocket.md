# Agent Note: The browser extension connects to the desktop app over a paired loopback WebSocket

Status: implemented

English | [中文](2026-11-27-browser-extension-loopback-websocket.zh.md)

## Problem

The Aeven browser extension reached the desktop app through a Chrome native messaging host. On Windows a browser finds that host only through a key under `HKCU\Software\<browser>\NativeMessagingHosts`, and a [Microsoft Store package](../process/2026-11-21-microsoft-store-msix-package.md) virtualizes every `HKCU` write, so a browser never sees a key the packaged app writes. The package therefore declared the `unvirtualizedResources` restricted capability, at first with whole-package `desktop6` opt-outs, then with only `%APPDATA%\Aeven` and the four `io.aeven.browser` keys excluded, which only Windows 11 supports. Microsoft refused the capability under policy 10.6.3 three times, the last two times on 2026-11-26 and 2026-11-27 with the same text, even though the last submission excluded one folder and four keys and named the support contact and website. A test on a Windows 11 VM confirmed that without the capability the Store build cannot register the host.

## Decision

The desktop app serves the extension a WebSocket on `127.0.0.1` (`serveExtensions` in `apps/desktop/src/browser-extension.ts`, on the `ws` package), on the first free port of `EXTENSION_PORTS` (47820, 47821, 47822); the extension's worker tries the same list in order (`APP_PORTS` in `apps/chrome-extension/src/background.ts`). Native messaging is gone from both sides, and the extension drops its `nativeMessaging` permission. The request and event messages are unchanged, one JSON message per text frame.

The server accepts only the `chrome-extension://` origins of `EXTENSION_IDS`. Both sides then prove they hold a 32-byte pairing secret, which the app keeps in `$AVN_HOME/desktop/browser-extension-secret` (mode 0600) and the extension in `chrome.storage.local`. The app sends a random challenge; the extension answers with HMAC-SHA256 of `extension:<port>:<challenge>` and a challenge of its own; the app answers with HMAC-SHA256 of `app:<port>:<their challenge>`. Only then does the app adopt the socket and the extension serve it. Naming the port in each proof stops a program on one port from relaying the exchange to the app on another.

An extension origin that cannot prove the secret is refused. The app then opens `chrome-extension://<id>/connect.html#<secret>` in each installed browser whose name starts with the one the extension reported and that has that extension, at most once per browser while the server runs, and in the background on macOS. The page hands the secret to the worker, which stores it, connects, and closes the page and its history entry. The app also puts the secret in that page's fragment when it starts a browser for the agent. No web page can open the page, because it is not a web-accessible resource, so only a program on the computer can pair the extension.

While connected the worker sends `{ event: 'ping' }` every 20 seconds, because Chrome stops an extension service worker whose WebSocket is idle for 30 seconds; the app ignores the event.

The Store package uses electron-builder's own manifest template, declares no restricted capability beyond `runFullTrust`, and requires Windows 10 1809 (`10.0.17763.0`). `installer/appx/AppxManifest.xml`, `tests/store-manifest.spec.ts`, the native host script, and the NSIS uninstaller's key deletion are deleted. At launch the app deletes the native messaging host earlier releases registered (`removeLegacyNativeHost`), so an extension that has not updated yet finds no host instead of starting a missing script every minute.

## Alternatives considered

**Keep native messaging and add the WebSocket only for the Store build.** Two transports, two install paths, and a Store-only mode would each need upkeep and testing, and the WebSocket alone serves every build.

**Check the origin and nothing else.** Any local program can send any `Origin` header and any program can listen on a free port, so a program of another account, or a sandboxed one, could pass for the extension and feed the agent page content, or pass for the app and drive the reader's signed-in browser. The pairing secret closes both directions.

**Pair by asking the reader in the app, trusting the first extension that connects.** It needs new UI, and it does not authenticate the app to the extension, so a program that takes the port first would still drive the browser.

**Ship the Store build without the extension.** Store readers would lose a feature that works on every other build.

**Keep requesting `unvirtualizedResources`.** The same refusal three times, and Microsoft's documentation describing the capability as meant for games, left no reason to expect a different outcome.

**Exclude only the folder and keys, or all of AppData, under the capability.** These were the earlier submissions' designs. They also let the agent's tools write unvirtualized files under AppData, such as an `npm install -g` or another program's settings file, which no list of exclusions can name in advance.

## Consequences

- The Store package installs on Windows 10 again, and its submission needs no capability justification.
- In the Store build every AppData and `HKCU` write lands in the package's private store, including what the agent's tools write there: the agent's later commands see it, other programs do not, and uninstalling the package removes it. A Store install and an NSIS install keep separate profiles and can run at the same time; the second to start serves the extension on the next port.
- The extension and the app must be released together: an extension from before this change finds no host, and this extension finds no app from before it. The Chrome Web Store update (extension 0.3.38) should be live before the desktop release that removes the host.
- Pairing opens a page in the browser once per browser and app run while an extension holds no secret or a stale one. The page opens in the profile the browser starts in, so an extension installed only in another profile is paired the next time the agent starts that browser, or never, if that profile is not the one the browser opens. Browsers the app does not know how to start, such as Opera and Vivaldi, are not paired.
- The secret appears in the browser launcher's command line for as long as that process runs. Linux lets other accounts read command lines unless `/proc` is mounted with `hidepid`.
- Chrome's Local Network Access restrictions gate WebSockets to loopback from Chrome 147 on, and their documentation does not mention extensions. In Chrome 158 on macOS the extension's service worker connected without a permission prompt; a later Chrome that applies them to extensions would stop the connection until the reader grants the permission.
