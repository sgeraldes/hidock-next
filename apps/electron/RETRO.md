# RETRO.md — Session Retrospective & Determinism Proposals

*2026-07-08. Full-history review: what was asked, what was delivered, which
working patterns to keep, which failure modes recurred, and what skills/tools/
commands would make this deterministic instead of heroic. Companion:
ROADMAP.md §A (the ask-vs-delivered ledger).*

## 1. What worked (keep, and codify)

| Pattern | Evidence |
|---|---|
| **Precise agent briefs** (root cause + contract + explicit gates + "report as last action") | ~20 Opus agents; near-all delivered working, gated code |
| **Evidence-first debugging** (compare wiki tail vs DB substring vs chunk math before touching code) | MP3-in-.wav root cause; json-mime malformation classes; freeze root cause |
| **Live verification** (CDP scripts + screenshots against the RUNNING app) | caught the hooks-order crash, dead assistant input, wrong download order minutes after shipping |
| **Waves as feedback loops** (real data volume surfaces defect classes code review can't) | ~86 audios → 11+ defect classes found and fixed |
| **Gates before every commit** (typecheck + lint + full suite) + commit-often | 25+ commits, zero broken pushes |
| **Event-driven orchestration** (persistent monitors + agent mailboxes instead of polling) | wave outcomes, freeze detection |
| **User corrections → standing rules** (recency principle, journey-driven verification, honest scoring) | GOAL.md, ROADMAP §E/§F |

## 2. Failure modes (recurred; each needs a mechanism, not a promise)

| # | Failure | Occurrences | Mechanism needed |
|---|---|---|---|
| F1 | Agents go idle WITHOUT their final report | ~8 times | report protocol + auto tree-inspection fallback (orchestrator already does this after 2 idles — codify) |
| F2 | Diff-driven verification missed user-journey failures (participants invisible; Today UX; impeccable cadence skipped) | 3 major | journey-walk checklist per round (see /verify-journeys below) |
| F3 | Optimistic self-scoring (edit=65 while times uneditable) | 1 systemic | scoring rule: count only user-visible/doable (ROADMAP §F) + rescore command |
| F4 | Parallel-agent file collisions (SCHEMA_VERSION double-bump; stale 27→28 assertion; cross-blamed OOM) | 3 | migration-number claims + one-owner-per-file-set dispatch rule |
| F5 | Session limits killed agents mid-task | 2 | cheap: re-dispatch template; staggered spawns |
| F6 | Ad-hoc CDP scratchpad scripts rewritten per need (probe APIs each time, ~12 scripts) | constant | versioned dev toolkit in repo (scripts/dev/cdp.mjs) |
| F7 | The restart dance (stop task → reap ports → start → wait CDP → re-arm monitor) done manually ~8× | ~8 | one command (scripts/dev/app-cycle.mjs) |
| F8 | Orchestrator passivity ("the picker self-corrects") | 1 | GOAL.md rule 4 (disagree and commit) — user-enforced, now standing |
| F9 | detect-secrets baseline churn + hook false-positives interrupting commits | 3 | known; pre-commit baseline refresh is routine — acceptable |

## 3. Proposals — skills / tools / commands (priority order)

1. **`scripts/dev/app-cycle.mjs`** (tool, BUILD NOW): `node app-cycle.mjs restart|stop|status` — stops the tracked dev task's listeners (devproc reap 9222/5180), starts `npm run dev` detached-tracked, waits for CDP, prints ready. Kills F7. Also `--wait-log <regex>` for migration evidence.
2. **`scripts/dev/cdp.mjs`** (tool, BUILD NOW): one entry point with subcommands — `eval <expr>`, `screenshot [path]`, `queue-status`, `enqueue-transcriptions <n>`, `downloads reorder|cancel|small-batch <n>`, `navigate <route>`, `click-text <text>`, `body-text`. Replaces the 12 scratchpad one-offs; future sessions get verified plumbing. Kills F6.
3. **`/verify-journeys` (repo skill, .claude/skills/verify-journeys/SKILL.md)**: a scripted walk of core user journeys (Today → next meeting → detail → edit; Library → transcript → assign speaker; People → discover → review → merge; Calendar → meeting → recording), each step = CDP action + screenshot + explicit pass/fail question ("are participants visible?", "is contrast readable?"). Output: scored table vs ROADMAP §D. Run after every UI round. Kills F2, feeds F3.
4. **Agent dispatch conventions (append to `.claude/rules/`)**: (a) one agent per file-set, migrations claimed by number in the brief; (b) every brief ends with the report-as-last-action block + "if you idle without reporting, the orchestrator will inspect your tree and commit what gates green"; (c) re-dispatch template for session-limit deaths. Kills F1/F4/F5 drift.
5. **`/rescore` (skill)**: re-walk ROADMAP §D after a round: for each changed surface ask the scoring-rule questions (can a user click/edit/see it?), update numbers, append a dated delta row. Kills F3 recurrence.
6. **Impeccable cadence hook**: hookify/PostToolUse reminder when a commit touches `src/**/*.tsx`: "UI landed — run impeccable on changed surfaces + one untouched." (Soft reminder, not a gate.)
7. **`/backlog-budget` (command)**: estimate cost (files × avg tokens × price) before bulk operations (Process All 1,795) so budget decisions are explicit.
8. **`/retro` (skill)**: this document's procedure, repeatable: ledger from task list + commits, failure-mode diff against §2, new proposals.

## 4. Decision asks for Sebastián
- Approve building #1–#3 now (agents; ~1 session). #4 is a docs change I'll make directly.
- Process-All budget (1,795 files) — needs your call (ROADMAP C10).
- M365 Graph connector next after current fixes? (real attendees + email autocomplete — C3.)
