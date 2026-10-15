# Agent Note: Authenticator two-factor authentication

Status: implemented

## Problem

An account password or social sign-in alone gives access to Aeven. Readers need optional authenticator protection during signup and a way to manage it from account settings.

## Decision

The Node account server owns TOTP enrollment and verification. Signup offers enrollment after naming; Account → Security exposes a switch. An encrypted pending secret expires after ten minutes, and a valid six-digit code commits activation. Recovery codes are disclosed once and stored as hashes. Disabling requires a valid authenticator or recovery code.

Password sign-in, repeated registration, and social token exchange withhold credentials from the client until a second-factor challenge completes. Challenges expire after five minutes. Account-scoped attempt limits include newly issued challenges. Mongo updates atomically consume a TOTP time step or recovery hash, and Redis atomically consumes the sign-in challenge. The shared `MfaForm` primitive receives API operations and locale-owned copy; it holds no boot-session state.

## Alternatives considered

**Enable immediately on QR display.** A reader who has not successfully enrolled an app can lock themselves out, so activation requires a code.

**Protect only password login.** Social token exchange and repeated registration can also return credentials, so those paths enforce the same challenge.

**Email as a second-factor fallback.** Recovery codes preserve a separate possession factor without making mailbox access sufficient to bypass the authenticator.

## Consequences

Losing both the authenticator and all recovery codes prevents self-service recovery. Existing sessions stay signed in when protection is enabled; the authenticator is required for subsequent sign-ins. Setup material stays out of persistent browser storage. The Node deployment needs `otpauth` and `qrcode` installed and its existing encryption secret configured.
