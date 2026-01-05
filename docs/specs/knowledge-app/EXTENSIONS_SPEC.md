# Extensions Specification (Knowledge App)

**Scope:** future (Phase 3+)
**Related Numbered Spec:** [10_EXTENSIONS.md](../10_EXTENSIONS.md)
**References:** [11_CONCEPTUAL_FRAMEWORK.md](../11_CONCEPTUAL_FRAMEWORK.md), [11_REDESIGN_ARCH.md](../11_REDESIGN_ARCH.md)

---

## 1. Purpose

Extensions (plugins/connectors) ingest external data (Slack/Jira/files) into the Library as Sources, then index into Explore so the Assistant can use it as grounded context.

---

## 2. Implementation constraints

- Plugins run outside the renderer (main process or separate process).
- All network calls and credential handling live outside the renderer.
- Payload validation, timeouts, retries, and logging are mandatory.

---

## 3. Acceptance criteria

- A plugin can ingest and produce Sources without destabilizing the app.
- Ingestion is observable (logs + status).
