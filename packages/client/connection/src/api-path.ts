/**
 * The /api URL prefix — single source for both halves of the web transport.
 * The node half registers this prefix on the web server.
 */

/** Route prefix owning every api request (`/api` and `/api/<anything>`). */
export const API_PATH = '/api'

/**
 * `HEAD` route on {@link API_PATH} that does nothing but admit its caller.
 * Admission publishes the caller's bearer to the Host, so a page that renewed
 * its session credential hands the renewal over here without waiting for its
 * next API call; long streamed turns make none, and the Host's copy would lapse.
 */
export const CREDENTIAL_HANDOVER_PATH = `${API_PATH}/credential`
