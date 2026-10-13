/**
 * The referrer a video player embedded in the app page sends.
 *
 * YouTube's embedded player refuses to play (error 153) for a request without
 * an HTTP referrer, and the app page's `avn-app://` origin is not one it
 * accepts. The page's markdown renderer plays videos from YouTube's no-cookie
 * embed host, so the player's own document request carries the product's
 * address as its referrer instead.
 *
 * @module
 */

import type { Session } from 'electron'

/** The player documents a reply's video loads. */
const EMBED_URLS = ['https://www.youtube-nocookie.com/embed/*']

/** The address the player is told it is embedded on. */
const EMBEDDING_PAGE = 'https://aeven.io/'

/**
 * Give the embedded player's document request a web referrer when the page's
 * own is not one. A request that already carries an `http(s)` referrer — the
 * app page served from an adopted Host's origin — keeps it.
 * @param target - The session the app window renders in.
 */
export function sendVideoEmbedReferrer(target: Session): void {
  target.webRequest.onBeforeSendHeaders({ urls: EMBED_URLS }, (details, callback) => {
    const headers = { ...details.requestHeaders }
    const current = headers['Referer'] ?? headers['referer']

    if (current === undefined || !/^https?:/i.test(current)) {
      delete headers['referer']
      headers['Referer'] = EMBEDDING_PAGE
    }

    callback({ requestHeaders: headers })
  })
}
