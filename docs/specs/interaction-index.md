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
| Library — reader/waveform | – | – | – | pending E-walk | markers clickable (B1 in flight); speaker chips→people |
| Today | – | – | – | pending E-walk | commits/moments in agenda; verify entity links |
| Calendar | – | – | – | pending E-walk | E1 |
| Meeting detail | – | – | – | pending E-walk | |
| People / Person detail | – | – | – | pending E-walk | identity merge/suggestions live |
| Projects | – | – | – | pending E-walk | F1 evidence fixed (69→0) |
| Context Graph | – | – | – | pending E-walk | E2 |
| Explore | – | – | – | pending E-walk | E4 |
| Actionables | – | – | – | pending E-walk | handover dialog lives here |
| Assistant (floating + embedded) | – | – | – | pending E-walk | F2 overlay fixed; F3 brain E2E in flight |
| Settings — AI Brains | – | – | – | pending E-walk | 6 brains, login-first badges |
| Settings — rest | – | – | – | pending E-walk | E5 |
| Sync / Device | – | – | – | pending E-walk | E7; recovery-exhausted surfacing new |
| Titlebar / chrome | – | – | – | pending E-walk | A5 pass in flight |

**Update protocol (per landed feature):** the orchestrator re-scores the touched surface(s)
in the same commit that marks the roadmap item done, citing screenshot/DOM evidence.
A feature that lowers any score is a regression finding, not a shrug.
