# Sync Specification (Knowledge App)

**Route:** `/sync`
**Primary Spec in this folder:** `DEVICE_SYNC_SPEC.md`
**Related Numbered Spec:** [08_SYNC.md](../08_SYNC.md)

---

## 1. Purpose

Sync is the ingestion path for HiDock hardware: connect, list device files, download/sync, and (optionally) trigger processing into Sources.

### Vision alignment (do not mirror the current UI)
- Treat device captures as inputs that become immutable Sources once ingested.
- The sync experience should be understandable by outcomes (what’s new, what failed, what’s next) rather than internal implementation.

---

## 2. Notes

This file exists as a bridge between the numbered specs and the more detailed device-focused spec. Treat `DEVICE_SYNC_SPEC.md` as the implementation reference.

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/Device.tsx`.
