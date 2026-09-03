# ADR: Use an iPhone Shortcut as the local work-calendar bridge

**Status:** Accepted

**Date:** 2026-09-02

## Context

The user's employer does not approve HiDock Next for Microsoft 365 delegated access. Published Outlook and macOS calendar
views expose only free/busy information, while the authorised work calendar on the user's iPhone exposes meeting details.
The integration must not bypass organisation authentication controls or scrape private Teams application storage.

## Decision

Accept a small, user-selected TSV snapshot written by an iPhone Shortcut. Parse it fail-closed, store it through the existing
meeting database service, and reuse the existing organisation reconciliation and recording-correlation pipeline. Do not add
Microsoft credentials or a second meeting store.

## Options considered

| Option | Complexity | Reliability | Policy posture |
| --- | --- | --- | --- |
| Microsoft Graph | Low once approved | High | Blocked by tenant approval |
| Scrape local Teams storage/UI | High | Low | Brittle and potentially inappropriate |
| iPhone Shortcut file bridge | Medium | Medium-high | User-mediated and locally inspectable |
| Time-only free/busy matching | Low | Low | Safe but loses titles and Teams links |

## Consequences

- Calendar matching works without a custom Microsoft application.
- The exported file contains potentially sensitive work metadata; the user must choose an organisation-approved location.
- Shortcut output is a snapshot rather than a live API. iCloud/Files latency may delay updates.
- A malformed or partially synced file cannot replace the last valid matching snapshot.
- Stable local meeting IDs are derived from title and time because iOS Shortcuts does not expose a portable event UID.

