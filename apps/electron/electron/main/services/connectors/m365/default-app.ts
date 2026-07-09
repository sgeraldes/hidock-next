/**
 * Shipped ("default") Microsoft 365 / Entra application identity.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * hinotes.hidock.com lets a user connect their calendar with a single "Allow
 * access" popup — no Azure app registration required — because HiNotes ships its
 * OWN registered application and every user signs into it. This module is the
 * desktop equivalent: the project owner registers ONE public (native) Entra app
 * under a neutral personal tenant and pastes its Application (client) ID below.
 * With a default present, the M365 connector needs ZERO setup UI — the user just
 * clicks Connect and signs in. Users can still override it with their own app
 * registration via the "advanced" toggle in Settings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ CLIENT IDs ARE NOT SECRETS
 * ─────────────────────────────────────────────────────────────────────────────
 * An OAuth Application (client) ID is a PUBLIC identifier, not a credential. It
 * is safe to commit and ship in the binary. This is a PUBLIC client (no client
 * secret): security comes from PKCE + the user's interactive sign-in and the
 * scopes they consent to — never from hiding the client id. (This is exactly how
 * the Azure CLM, VS Code, and other shipped desktop apps embed their client id.)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOR THE PROJECT OWNER — how to fill this in
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Entra admin center → App registrations → New registration.
 *    - Name: e.g. "HiDock Next (Desktop)".
 *    - Supported account types: "Accounts in any organizational directory and
 *      personal Microsoft accounts" (this is what makes tenant 'common' work for
 *      BOTH a personal hotmail.com account AND a work/school dfx5.com account).
 * 2. Authentication → Add a platform → "Mobile and desktop applications".
 *    - Add redirect URI: http://localhost   (loopback — the interactive
 *      auth-code flow binds an EPHEMERAL port and Azure matches any port for the
 *      http://localhost loopback redirect on a public client, per RFC 8252).
 *    - Also add: https://login.microsoftonline.com/common/oauth2/nativeclient
 *      (harmless fallback for the device-code path).
 *    - Advanced settings → "Allow public client flows" = Yes (required for both
 *      the loopback auth-code PKCE flow and the device-code fallback).
 * 3. API permissions → Microsoft Graph → Delegated → add: User.Read,
 *    Calendars.Read, Contacts.Read, People.Read. (No admin consent needed for
 *    these delegated read scopes; each user consents on first sign-in.)
 * 4. Overview → copy the "Application (client) ID" and paste it below.
 *
 * Leave DEFAULT_M365_CLIENT_ID as '' to ship WITHOUT a default (the connector
 * then shows the full "register your own app" walkthrough).
 */

/**
 * The shipped public client id. EMPTY by default — the project owner pastes the
 * registered app's Application (client) ID here. Public identifier, not a secret.
 */
export const DEFAULT_M365_CLIENT_ID = ''

/**
 * Default authority tenant. 'common' allows BOTH personal Microsoft accounts
 * (hotmail/outlook.com) and work/school accounts (dfx5.com) to sign in.
 */
export const DEFAULT_M365_TENANT = 'common'

/** True when a shipped default client id is present (drives the zero-setup UX). */
export function hasDefaultM365App(): boolean {
  return DEFAULT_M365_CLIENT_ID.trim() !== ''
}
