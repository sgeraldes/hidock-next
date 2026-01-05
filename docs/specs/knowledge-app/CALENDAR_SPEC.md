# Calendar Specification (Knowledge App)

**Route:** `/calendar`
**Related Numbered Spec:** [06_CALENDAR.md](../06_CALENDAR.md)
**References:** [11_CONCEPTUAL_FRAMEWORK.md](../11_CONCEPTUAL_FRAMEWORK.md)

---

## 1. Purpose

Calendar is the temporal organizer. It provides an event-centric view that links scheduled meetings to captured Sources (audio captures today; broader Sources over time) and exposes gaps (meetings with no captures).

### Vision alignment (do not mirror the current UI)
- Calendar is a *linking and coverage* surface: it helps users connect events ↔ evidence.
- Matching should be explainable and overrideable; users must understand why a Source is linked.
- Deep-links should land on meaningful anchors (meeting detail, Source reader at relevant segment).

---

## 2. Scope

- Day/week/month grid views.
- Meeting ↔ recording matching with clear visualization.
- Manual linking for orphans.

---

## 3. Implementation requirements

- Sync is a backend operation; UI reflects state and last-sync time.
- Matching rules must be explainable and overrideable by the user.
- Deep links:
  - meeting opens meeting detail
  - Source opens Library

---

## 4. Acceptance criteria

- Users can see which meetings have recordings.
- Users can link an orphan recording to a meeting.

Replace “recording” wording with “Source/audio capture” in the target UX as the Source model becomes primary.

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/Calendar.tsx`.
