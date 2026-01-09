# Settings Specification (Knowledge App)

**Route:** `/settings`
**Related Numbered Spec:** [09_SETTINGS.md](../09_SETTINGS.md)

---

## 1. Purpose

Settings configures providers and integrations: calendar sync, AI providers, storage behavior, and advanced maintenance actions.

### Vision alignment (do not mirror the current UI)
- Settings is for *explicit user control* over providers, storage, and privacy.
- Prefer testable, reversible changes (Test buttons, clear error states, safe defaults).
- Secrets must never be exposed in logs or UI beyond controlled inputs.

---

## 2. Security requirements

- Store secrets encrypted at rest.
- Never log secrets.
- Provide explicit "Test" actions for providers.

---

## 3. Acceptance criteria

- Settings changes persist and take effect without restart when feasible.
- Users can verify provider connectivity.

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/Settings.tsx`.
