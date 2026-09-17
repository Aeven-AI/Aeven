/**
 * Publish the session bearer as the Aeven provider's credential.
 *
 * Inference runs in the Host's own process, which never sees this token; the
 * browser is its only holder, and the browser is also where the rotation that
 * keeps it fresh already lives. So rather than a second credential system, the
 * bearer the transport already attaches to every call is mirrored into the
 * credential store the Aeven provider resolves its key from — the same store,
 * and the same write path, the Models page uses for a typed provider key. A
 * rotation reaches the provider with no extra machinery: the next call
 * publishes the token that replaced the old one.
 *
 * Only a changed token is written, so a signed-in page costs one write per
 * rotation rather than one per request; and because the newest token seen is
 * held, a page that installs its publisher after calls have already flowed
 * publishes that token at install instead of waiting for the next call.
 * @module @aeven/client-ui-auth-aeven/client
 */

/**
 * The reference the Aeven provider route resolves, which is also that route's
 * own default — the two name one credential, so they are one constant here and
 * a default there rather than two strings that can drift.
 */
export const INFERENCE_CREDENTIAL_REF = 'AEVEN_TOKEN'

/** The newest token seen on the wire. */
let latest: string | undefined
/** The token the store last accepted. */
let published: string | undefined
/** The Host-side writer, absent until the page's plugin graph is up. */
let publisher: ((ref: string, value: string) => Promise<void>) | undefined

/**
 * Record the bearer of a call in flight, publishing it when it is new.
 *
 * Called from the transport hook, which is the one place a bearer is known
 * before it is sent. With no publisher installed yet the token is only held:
 * the page installs one once its graph is up, and that install publishes it.
 * @param bearer - the token this call is about to send, when the session holds one.
 */
export function mirrorSessionBearer(bearer: string | undefined): void {
  // Compared against what the store accepted, not against the newest token seen:
  // a write that failed leaves the store without it, and comparing against `latest`
  // would skip every later call carrying that same token — so a transient failure
  // would be permanent, and the session would never reach the provider.
  if (bearer === undefined || bearer === published) return
  latest = bearer
  flush()
}

/**
 * Install the writer, publishing whatever has already been seen.
 * @param write - stores one credential in the Host's provider-managed document.
 * @returns disposer withdrawing the publisher.
 */
export function installInferenceCredentialMirror(
  write: (ref: string, value: string) => Promise<void>,
): () => void {
  publisher = write
  flush()
  return () => {
    if (publisher === write) publisher = undefined
  }
}

/**
 * Write the held token when it differs from the last one the store accepted.
 *
 * A refusal is neither retried here nor surfaced: the provider's own
 * `MISSING_CREDENTIAL` names the remedy, and a mirror that cannot write must not
 * fail the call whose token it was reading. Forgetting the failure lets the
 * next call try again, so a store that was briefly unwritable recovers.
 */
function flush(): void {
  const write = publisher
  const value = latest
  if (write === undefined || value === undefined || value === published) return
  published = value
  void write(INFERENCE_CREDENTIAL_REF, value).catch(() => { published = undefined })
}
