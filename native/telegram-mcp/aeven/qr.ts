/** Render a Telegram login link as the QR image Settings shows. */

import { renderSVG } from 'uqr'

/**
 * Encode a `tg://login` link as an SVG QR code.
 * @param link - the login link Telegram's app scans.
 * @returns a base64 SVG data URL an `<img>` can show.
 */
export function qrDataUrl(link: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(renderSVG(link, { border: 2 })).toString('base64')}`
}
