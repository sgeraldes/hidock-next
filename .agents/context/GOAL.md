# GOAL — Discovery & Correction Loop for an Assistant-First Product

*Session mission, written 2026-07-08 by the orchestrating agent. This is my goal
statement: what this whole session is for and how I work toward it.*

## The product goal

HiDock Next (Electron app) must become **Sebastián's daily-work assistant**, not
a recordings manager. It transcribes everything the HiDock records, keeps a
central knowledge base (Karpathy-LLM-wiki style), understands his day
(calendar + meetings + people + projects), proactively suggests follow-ups
(minutes, Claude Code handoffs, drafts), remembers projects months later, and
exposes all knowledge to him AND to other agents (Claude Code, assistant chat).

**Recency principle:** what happened recently matters more than what happened a
month ago. New recordings take precedence — in transcription order, in the
Today page, in suggestions. This is a product value, and it must be encoded in
code (queue priorities, sort orders, briefings), never left to chance.

**Identity principle:** people, projects, and meetings are canonical entities.
Every mention is clickable/hoverable/editable; an edit propagates everywhere;
new information (an email address discovered in a meeting) flows to the entity
and thus to every surface; duplicates get merged. Raw name-strings are debt.

## The process goal — discovery and correction

The method of this session (and the standing method going forward):

1. **Use the product as the user.** Transcribe real audio in waves, read the
   outputs, click the buttons, ask the assistant real questions. Screenshots
   and CDP checks against the RUNNING app — never "it should work."
2. **Discover defects from real use**, not from code reading alone: truncated
   transcripts, flat walls of text, dead inputs, duplicate rows, unusable
   priorities. Every wave of real data is a feedback loop that surfaces the
   next defect class.
3. **Root-cause with evidence before fixing** (wiki tails vs DB substrings vs
   chunk math; live log finishReasons; hook-order stack traces). No guessing.
4. **Correct assertively.** When behavior is wrong, disagree and commit: "No,
   that is not the best approach — I will change it." Do not watch a flaw
   self-correct or narrate around it. Steer the fix into code.
5. **Delegate implementation to Opus coding agents** — the orchestrator
   ideates, designs, briefs precisely (root cause + contract + gates), then
   verifies the agent's work independently (gates re-run, live UI checks)
   before committing. Commit often, push always.
6. **Keep quality gates hard:** typecheck + full test suite green before every
   commit; live verification after; issues logged in OVERNIGHT_PLAN.md /
   INTERACTIVITY_PLAN.md with commit hashes; plans updated as rounds land.
7. **Iterate in rounds** until the product serves the goal: audit → design →
   implement → verify → next round.

## Success criteria

- Every recording the device captures becomes searchable, structured knowledge
  (speaker turns, summary, actions, people, projects, wiki page, embeddings)
  with newest-first priority.
- The assistant answers project questions from months of accumulated meetings,
  citing sources.
- Every entity mention in the UI is interactive; edits propagate; duplicates
  merge.
- The user wakes up to working software and an honest log of what was found,
  fixed, and verified — not plans.
