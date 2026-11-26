# Motion audit scripts

English | [中文](README.zh.md)

Browser scripts a motion renderer adds to a bundled HyperFrames composition to measure it. `src/audit.ts` loads both and judges what they return.

| File | Origin |
|---|---|
| `layout-audit.browser.js` | Copied unmodified from the npm package `hyperframes` 0.9.99, `dist/commands/layout-audit.browser.js` ([heygen-com/hyperframes](https://github.com/heygen-com/hyperframes), Apache-2.0). It defines `window.__hyperframesLayoutAudit` and `window.__hyperframesCraftSample`. |
| `driver.browser.js` | Ours. It defines `window.__avnMotionAudit(times)`, which seeks the composition's player to each time, calls the two functions above, and reports font families that rendered in a fallback face. |

## Updating the upstream script

Update it with the `@hyperframes/*` packages, to the same version:

1. `npm pack hyperframes@<version>` in an empty scratch folder and unpack the archive.
2. Copy `package/dist/commands/layout-audit.browser.js` over the file here, unmodified.
3. Change the version in the table above.
4. Review a film with known faults and confirm its findings are unchanged; the driver reads `code`, `severity`, `selector`, `text`, `message`, and `fixHint` of each issue, and `key`, `block`, `selector`, `text`, `blockText`, `opacity`, `fontPx`, and `captions` of each craft part.
