# Aeven browser extension

English | [中文](README.zh.md)

Lets the Aeven agent use the browser you browse with — Chrome, Brave, Edge, Arc, or another Chromium browser — from the Aeven desktop app or from Aeven on the web.

- The agent opens its own tabs in front, in an open **Aeven** tab group, and drives only those, with the same tools, waits, and pointer as the sidebar browser. The extension runs each whole operation itself.
- Chrome shows "Aeven started debugging this browser" while the agent acts; the extension detaches from a tab 10 seconds after the agent's last action there, and the bar goes with it.
- With your approval, the agent searches your history and bookmarks.
- The desktop app serves the extension a WebSocket on `127.0.0.1`, on the first free port of 47820, 47821, and 47822, unless the reader turned **Browser extension** off in Settings > General; turning it off closes the server. The server accepts only the extension's `chrome-extension://` origins, and both sides then prove they hold the pairing secret in `$AVN_HOME/desktop/browser-extension-secret`: each signs the other's random challenge and the port with HMAC-SHA256, so a program that listens on or connects to the port without the secret, or relays between two ports, passes for neither side. An extension without the secret is refused, and the app opens `connect.html` with the secret in its fragment in each installed browser of that name that has the extension, once per browser while it runs; the page hands the secret to the worker, which keeps it, connects, and closes the page and its history entry. Only a program on the computer can open that page, because no web page may navigate to it. The app also keeps registering its native messaging host (`io.aeven.browser`) with each installed Chromium browser and serves that host's local socket, so extensions from before the WebSocket (0.3.37 and older) still connect: on Windows it writes the `HKCU\Software\<browser>\NativeMessagingHosts\io.aeven.browser` key of Chrome, Chromium, Brave and Edge, elsewhere the host manifest in each browser's `NativeMessagingHosts` folder. Turning **Browser extension** off deletes them, and the Windows installer's uninstaller deletes the keys. A Microsoft Store install writes the keys into its private, virtualized registry, where no browser reads them, so extensions reach it only over the WebSocket. When no port answers, the extension connects through the native host instead, which is how it reaches desktop apps from before the WebSocket. Several browsers can be connected at once; each install has its own id, which agent tab ids carry. When none is connected and the agent opens a tab, the app starts the browser that has the extension and opens `connect.html`, which wakes the extension. The worker sends a message every 20 seconds so Chrome keeps it running while the app is connected.
- An Aeven web page on `aeven.io` reaches the extension directly (`externally_connectable`), which is how hosted Aeven uses your browser. Localhost pages may connect only to an unpacked development install.
- Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/aeven/cpgmlafibkmklfnpjpjbdgoegpljfofa) (id `cpgmlafibkmklfnpjpjbdgoegpljfofa`). When hosted Aeven needs your browser and the extension is missing, the page links this store page and continues as soon as the extension is added; the page sees a new install without reloading.

## Build and load

```sh
pnpm --filter @aeven/chrome-extension build
```

Open `chrome://extensions`, turn on Developer mode, choose **Load unpacked**, and select `apps/chrome-extension/dist`. The manifest's `key` fixes the extension id (`jagdfmhjejiccpmnfieenehhijhjjgnf`) that the host manifest allows.
