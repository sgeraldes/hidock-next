# Interaction Index — Clickability · Editability · Discoverability

**Owner-mandated per-module metrics** (asked 2026-07-08: "you need to measure user-editability,
user-clickability … capacity to see information by hover — all important metrics for each
component and section"). This file is the durable tracker. It MUST be updated by the
orchestrator's (Fable 5) audit pass **after every module/feature lands** — scores count only
what pixels allow a user to do, never what the API/DB implies.

**Scoring** (0–10 per axis, per surface):
- **C — Clickability**: every entity mention (person, project, meeting, date, file, commit)
  navigates somewhere useful on click; primary objects have right-click/overflow actions.
- **E — Editability**: every field a user would reasonably change is editable in place
  (titles, times, assignments, identities) and edits propagate everywhere.
- **D — Discoverability**: hover reveals metadata (who/when/what) on entity mentions;
  affordances are visible without documentation; live states are visibly live.

| Surface / Module | C | E | D | Last audited | Evidence / notes |
|---|---|---|---|---|---|
| Library — list | – | – | – | pending E-walk | H4/H17 landed; rows click→reader; no inline rename yet |
| Library — reader/waveform | 8 | 5 | 7 | 2026-07-11 (B-track landing; prelim, E-walk confirms) | C: markers/event-rows → transcript cross-highlight (B1, tested), speaker chips → People, action buttons. E: category/project assignable, no inline title edit yet. D: marker tooltips, chip↔bar color parity (B2), honest badges; pulse shows where you landed. |
| Today | – | – | – | pending E-walk | commits/moments in agenda; verify entity links |
| Calendar | 7 | 3 | 7 | 2026-07-11 (F6/F7 landing; unit-test evidence — dev server runs main, live confirm at next restart) | C: every event surface clickable AND keyboard-operable (role/tabIndex/Enter/Space, F7); overlapping events all reachable (cascade + hover/focus-to-front, F6). E: no inline event/time editing — read-only surface by design, selection only. D: aria-labels speak subject + time range; overlap cascade keeps every title row visible; focus rings honest; removed dishonest cursor-pointer. |
| Meeting detail | – | – | – | pending E-walk | |
| People / Person detail | – | – | – | pending E-walk | identity merge/suggestions live |
| Projects | 7 | 6 | 8 | 2026-07-11 (F9 r2 landing) | C: provenance chips → meeting, EntityMentions, merge/dismiss actions. E: merge + assign + DURABLE dismiss (tombstone v41 — dismissed never re-created, F9r2); no inline rename. D: discovered-automatically card gated on real provenance (manual empties get honest neutral card, F9r2); evidence lines (F1). |
| Context Graph | 5 | 3 | 7 | 2026-07-11 (F8 r2 landing) | C: nodes clickable, lens switches. E: re-key/cleanup/ingest actions only. D: strata bands readable full-width (F8) + HONEST axis — labelled date ticks, "ordered by time" copy matches the ordinal reality, density binning never collides nodes (F8r2). |
| Explore | 6 | 4 | 7 | 2026-07-11 (F10 landing) | C: real topic chips run searches; results navigable. E: search only. D: honest empty state; no fake data (F10); 21-result search in 2ms. |
| Actionables | – | – | – | pending E-walk | handover dialog lives here |
| Assistant (floating + embedded) | – | – | – | pending E-walk | F2 overlay fixed; F3 brain E2E in flight |
| Settings — AI Brains | – | – | – | pending E-walk | 6 brains, login-first badges |
| Settings — rest | – | – | – | pending E-walk | E5 |
| Sync / Device | – | – | – | pending E-walk | E7; recovery-exhausted surfacing new |
| Titlebar / chrome | – | – | – | pending E-walk | A5 pass in flight |

**Update protocol (per landed feature):** the orchestrator re-scores the touched surface(s)
in the same commit that marks the roadmap item done, citing screenshot/DOM evidence.
A feature that lowers any score is a regression finding, not a shrug.
