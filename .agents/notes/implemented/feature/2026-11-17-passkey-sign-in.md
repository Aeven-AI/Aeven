# Agent Note: Passkey Sign-In That Also Unlocks Synced Data

Status: implemented

English | [中文](2026-11-17-passkey-sign-in.zh.md)

## Problem

A passkey that protects an account's synced data could not sign in to the account. The passkey page kept only the PRF output and the credential id, its challenge was drawn in the browser, and the Aeven server stored no public key, so it had nothing to verify an assertion against. A reader on a protected account signed in with email or a provider and then touched the passkey a second time to unlock the device.

## Decision

- **The passkey that holds the sync key also signs in.** A passkey step that creates a passkey (`protect`, `add`) asks the page to describe the new passkey (`meta=1`). The page answers the PRF output followed by `{ id, publicKey, alg, aaguid, device }`, and the device sends `signIn: { publicKey, alg }` with `key.protect` or `passkey.add`. The relay stores it in `passkey_credentials` keyed by credential id and account. A passkey signs in exactly while it holds the account key: `passkey.remove` and `key.unprotect` remove its sign-in key too. The page lists the account's existing passkeys in `excludeCredentials`, so a provider that already holds one refuses to create another instead of replacing it, and the password manager names the new passkey after the account's email, which Account → Security passes because the Host identity carries only the account id.
- **Email first.** "Sign in with passkey" sits under "Sign in with Email". The reader types the email, `/passkey/lookup` says whether the account has a sign-in passkey, and only then does the passkey page open; `/oauth/passkey/check` refuses a passkey of another account with `other-account`. The desktop shell matches sign-in addresses with loopback hosts compared as one name, because the Host states loopback URLs to the page under the name the page arrived on.
- **Sign-in runs on the Aeven site like a provider.** `/oauth/passkey` serves a page with a server-issued, single-use challenge. It asks for any of the site's passkeys with user verification, posts the assertion to `/oauth/passkey/check`, and follows the URL the answer names. The server verifies the signature with Node's crypto against the stored SubjectPublicKeyInfo key, so no WebAuthn or CBOR dependency is added. A verified assertion creates a session and a one-use `strong` challenge, and the client exchanges it through `/oauth-result` as it does a provider's. User verification stands for both factors, so a `strong` exchange skips the authenticator code. Desktop and waiting web pages receive the result through the same handoff as provider sign-ins (`finishedSignInUrl`).
- **One prompt signs in and unlocks.** The sign-in screen draws a one-use X25519 key pair and a verifier on mount and passes `#key=…&vault=…&salt=…`. The page evaluates the PRF in the sign-in prompt and deposits it sealed under the verifier's hash at `/passkey/vault/result`. After sign-in the Settings → Sync popup takes the pair from the reader's `takePasskeyUnlock` and calls `unlockFromSignIn`, and asks for the passkey only if the device is still locked.
- **Regular sign-in stays.** The passkey button is an addition on the sign-in screen only. An account whose passkeys were created before this change keeps unlocking with them; they sign in after the reader adds a passkey from Account → Security on an unlocked device. The PRF salt and the passkey hostname are unchanged, so every wrapped key keeps opening.

## Alternatives considered

**Register the public key through an authenticated API route.** The relay connection already authenticates the account and is where the passkey's wrapped key arrives, so storing both in one request keeps a sign-in key from existing for a passkey that never held the account key.

**Use `@simplewebauthn/server`.** The browser states the new passkey's public key as SubjectPublicKeyInfo (`getPublicKey()`), so verification needs only a signature check over two buffers; the library would add attestation and CBOR handling nothing here uses.

**Start the unlock on the Host before sign-in.** The sync Remote acts for a signed-in caller only. Drawing the key pair in the page and handing it to the Host after sign-in keeps every sync operation behind the account's own session.

## Consequences

A reader on a protected account signs in and unlocks the device with one passkey touch, and the server still never holds the PRF output unsealed; it gains only public keys. Sign-in passkeys come only from Account → Security, so an account that never protects its data has no passkey sign-in.

- A provider that already holds one of the account's passkeys refuses a second one (`duplicate`); the reader saves the new passkey in another password manager or on a phone.
- Every passkey row offers Remove. Removing one of several drops its copy; removing the only one turns protection off after a confirmation, so the relay holds the key again and no device loses its data. Rows show only on an unlocked device.
- A recovery key is an optional 28-character holder of the account key, shown once and typed back to confirm.
- A passkey available on one platform only (iCloud Keychain on a Mac) is not offered on another (Android); regular sign-in covers that device, which then unlocks with another passkey. Setting up a device from another device is separate work.
