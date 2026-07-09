# ROADMAP.md — Session Audit & Forward Map

*Written 2026-07-08 ~15:00 after a full-history audit prompted by Sebastián:
"what else you may have missed?" Every ask from this session, its true status,
and the prioritized forward map. Statuses: ✅ done+verified · 🟡 partial ·
❌ not done. Companion: INTELLIGENCE.md (coverage scores), CONNECTORS.md,
INTERACTIVITY_PLAN.md, OVERNIGHT_PLAN.md.*

## A. The ledger — every ask vs. reality

| # | Ask (user's words, condensed) | Status | Evidence / gap |
|---|---|---|---|
| 1 | Fix transcription (hang, truncation, turns) | ✅ | MP3 chunking, speaker turns, no-silent-drop; Rec43 8,168w verified |
| 2 | Assistant-first experience (Today, CTAs, wiki, embeddings) | ✅ | verified live; RAG answer cites sources |
| 3 | ≥50 audios feedback loop, agents-only fixes | ✅ | ~86 unique; 11+ issues found+fixed |
| 4 | Recency priority IN CODE (transcription) | ✅ | verified live (wave 7 strict order) |
| 5 | Recency priority downloads + connectivity gating | ✅ code | device plug-in verification STILL PENDING (user) |
| 6 | GOAL.md session goal | ✅ | .agents/context/GOAL.md |
| 7 | Everything clickable/editable/discoverable, entity propagation | 🟡 | Rounds 1–5 landed; gaps: Today organizer, action-item lines, calendar day cells, chat chunk cards, conversation rename |
| 8 | Merge button (easy 2-entity merge) | ✅ | People merge mode, verified |
| 9 | Discovery function (People/Projects) | ✅ | 146 pairs→25 suggestions live (Eduardo=Edu…) |
| 10 | **Merge-safety: journal / unmerge / split** | ❌ **designed only** | INTELLIGENCE.md §8; merge_journal v30 + contacts:unmerge NOT implemented — user explicitly asked |
| 11 | Coverage map with completion values per component/characteristic | 🟡 | INTELLIGENCE.md §5 exists but coarse (per-surface, not per-component functions/metadata) — REBUILDING finer below |
| 12 | Connectors (BambooHR, Slack, Outlook, GitHub…) | 🟡 | Architecture + C0 (types) + C1 (PDF) done; C2 Slack, C3 M365 identity, C4 GitHub not started |
| 13 | Entity types (pdf, image, md, audio…) | 🟡 | Registry live (md/txt/json/image/pdf); audio NOT refactored into registry; svg/video absent |
| 14 | **ICS participants visible** | ❌→🟡 | ICS strips attendees (verified); transcript-derived people exist but were INVISIBLE on hover/Today/calendar — agent fixing now; M365 Graph connector = real fix (C3) |
| 15 | Run impeccable periodically | 🟡 | ran once (titlebar/depth); no periodic re-runs |
| 16 | Freeze under load | ✅ | debounced sql.js persistence; no freeze since |
| 17 | Speaker hover/right-click/rich picker | ✅ | verified live |
| 18 | Projects as hubs (folder, url, issues, risks, actions) | ✅ | v29; needs live user pass |
| 19 | Knowledge graph living/effortless | 🟡 | events + LLM-free surgery + debounced ingest live; nodes still NAME-KEYED (R4c pending); no visual graph UI |
| 20 | Process the full 1,795 backlog | ❌ | deliberate (API cost) — needs user decision on budget |

## B. Found-but-unfixed (my own observations, filed not fixed)
- json-mime analysis attempts systematically fail → fallback works but wastes
  one API call per analysis; planned: swap attempt order after measuring rate.
- Person `type` auto-classification (everyone is UNKNOWN unless hand-edited).
- Alias list ("Also known as") UI on PersonDetail — backend has aliases, no
  list IPC exposed.
- Old-format transcripts (pre-turns, ~278) render via paragraph fallback only;
  re-transcription upgrades them (needs backlog decision, see A20).
- MeetingDetail start/end time editing (form scaffolding exists, no inputs).
- March backlog: BUG-R1/R3 re-scan loop, DevicePipeline Phase 2.

## C. Forward map (priority order)
1. **Merge journal + unmerge (v30)** — explicit user ask, only designed. NEXT.
2. **Participants visibility** — agent in flight (hover/Today/calendar/detail).
3. **Device plug-in verification** — waiting on user; then bulk backlog
   restore (220 files) under the freeze fix.
4. **C3 M365/Graph connector** — real attendees with emails; also email
   autocomplete on People (explicit user example).
5. **Impeccable re-run** on the new surfaces (People/Projects/suggestions UI).
6. **Fine-grained coverage map** (per component function w/ metadata) — see D.
7. C2 Slack connector (living channel captures).
8. json-mime attempt-order swap; person-type classification; alias list UI.
9. **Context Graph — full surface redesign (replaces "Knowledge Graph")** —
   user directive 2026-07-08: the current Knowledge Graph surface "does not
   help, has no visualization, lacks usage both for human and AI. Context
   Graph is the way to go." Scope:
   - **Rename + reframe**: nav item, page, and mental model become *Context
     Graph* — the entity/relationship substrate that gives both the human AND
     the assistant/RAG pipeline usable context, not a text query console.
   - **Real visualization**: interactive graph view (people, projects,
     meetings, topics, artifacts as nodes; mentions/attendance/assignment as
     edges), zoom/filter/focus on an entity's neighborhood, click-through to
     the entity page. Today's text-only console retires.
   - **Human usage**: answer "who/what is connected to X and through which
     conversations" visually; neighborhood view doubles as merge/identity
     context (feeds the suggestion cards).
   - **AI usage**: the graph becomes retrievable context — assistant answers
     and RAG cite/walk graph edges (person→meetings→decisions), not just
     vector chunks.
   - Subsumes R4c (re-key person nodes by contact id at ingest) as the data
     prerequisite; supersedes the old "visual graph view" line item.
10. Backlog decision: Process All (1,795) budget + old-transcript upgrades.

## D. Fine-grained coverage map (the "mapping" — per component, per function)
Method: every VIEW lists its FUNCTIONS (what a user can do/see there); each
function scores click/edit/discover/identity 0–100 + notes. This section is
the living artifact; INTELLIGENCE.md §5 keeps the per-surface rollup.

### Today
| Function | Click | Edit | Discover | Identity | Notes |
|---|---|---|---|---|---|
| Meeting rows (ribbon) | 90 | 0 | 80 | 70 | end times all variants, hover cards on capsule rows, legend popover, dot tooltips (verified live 07-08) |
| Follow-up CTAs | 95 | n/a | 70 | n/a | |
| Pending actionables | 70 | 30 | 50 | 40 | recipients now chips |
| Identity suggestions card | 90 | 90 | 85 | 95 | group cards: canonical-name picker verified live (Nauman→Nouman) |
| Recent knowledge | 90 | 0 | 50 | 60 | dates are mentions |
| Stats line | 0 | n/a | 30 | n/a | could deep-link |

### Library (list + reader + assistant panel)
| Function | Click | Edit | Discover | Identity | Notes |
|---|---|---|---|---|---|
| Title/category | n/a | 90 | 70 | 70 | inline |
| Speaker labels | 95 | 95 | 90 | 90 | hover+assign+reset |
| Transcript turns | 80 | 0 | 80 | 85 | text not correctable |
| Action items list | 0 | 0 | 20 | 20 | plain li; assignee backend ready |
| Project assignment | 90 | 90 | 70 | 85 | picker (R3b) |
| Meeting link | 90 | 85 | 60→75* | 80 | |
| File import (artifacts) | 85 | n/a | 50 | n/a | needs per-type preview |
| Topics chips | 0 | 0 | 20 | 10 | should filter/search |

### People / PersonDetail
| Function | Click | Edit | Discover | Identity | Notes |
|---|---|---|---|---|---|
| Cards → detail | 95 | 20 | 45 | 90 | list hover cards missing |
| Quick merge | 95 | 95 | 80 | 100 | |
| Discover sweep | 95 | n/a | 90 | 95 | |
| Suggestions queue | 95 | 95 | 85 | 95 | |
| Fields (name/email/role/type/tags/notes) | n/a | 90 | 70 | 90 | type/tags now editable |
| Aliases | 0 | 0 | 0 | n/a | backend only |
| Timeline meetings | 90 | 0 | 70 | 85 | hover cards |
| Add Person | 0 | 0 | n/a | n/a | STILL A STUB |

### Projects
| Function | Click | Edit | Discover | Identity | Notes |
|---|---|---|---|---|---|
| Rename / folder / url | 80 | 90 | 70 | 85 | R3b |
| Issues / risks | 70 | 90 | 60 | n/a | |
| Actions by project | 80 | 0 | 60 | 50 | read-only list |
| Members | 90 | 0 | 70 | 90 | no add/remove UI |
| Knowledge list | 20 | 0 | 40 | 60 | counts, not items |
| Discover / suggestions | 95 | 95 | 85 | 95 | |

### Calendar / MeetingDetail
| Function | Click | Edit | Discover | Identity | Notes |
|---|---|---|---|---|---|
| Meeting blocks | 90 | 0 | 60→75* | 70 | tooltips gain participants* |
| Day cells | 0 | 0 | 10 | n/a | no day view / create |
| Recording overlays | 90 | 40 | 75 | 70 | |
| Attendees (detail) | 80 | 80 | 50→75* | 85 | empty-ICS state* |
| Subject/location/desc/organizer | n/a | 85 | 60 | 70 | times not editable |
| Linked recordings | 85 | 85 | 70 | 80 | |

### Actionables
| Function | Click | Edit | Discover | Identity | Notes |
|---|---|---|---|---|---|
| Cards → inline detail | 90 | 0 | 85 | 60 | expand: full quote, WILL GENERATE panel, detected date (verified live 07-08) |
| Approve button | 95 | n/a | 90 | n/a | per-template "Generate X" labels |
| Source link | 40 | 0 | 40 | 50 | recording-id sources render dead text — fix-actionable-source agent in flight |
| Recipients | 70 | 0 | 60 | 70 | chips in detail |
| Filters/pagination | 90 | n/a | 70 | n/a | |

### Assistant / Explore / Graph
| Function | Click | Edit | Discover | Identity | Notes |
|---|---|---|---|---|---|
| Chat + citations | 80 | 30 | 65 | 70 | chunk cards inert; no conv rename |
| Explore results | 95 | 0 | 75 | 90 | |
| Graph queries | 70 | 0 | 55 | 60 | name-keyed; no visual graph — surface slated for full **Context Graph** redesign (§C.9) |

## E. Loop correction (why the participants miss happened)
Verification was diff-driven (does what I built work?) not journey-driven
(can the user answer their real questions on every surface?). Standing rule
added: each round's verification must include one user-journey walk on a
surface the round did NOT touch, screenshotted, judged against §D.

## F. Score corrections (2026-07-08 ~15:30, user review of Today/MeetingDetail)
User caught optimistic scoring — indices must be measured against what a
user can actually DO, not what code paths exist:
- Today meeting rows: contrast fails 4.5:1, no hover motion, no
  time-to-meeting/next-highlight, giant empty rows → discover was 20, real
  experience ≈ 10. Fix in flight (impeccable-today-meeting agent).
- MeetingDetail: edit score 65 was WRONG — date/start/end/duration not
  editable (score should have been ≈45); description renders raw `*` bullet
  markers; "Join Meeting Link" not an actual link (meeting_url null, URL
  embedded in description text). All in the same fix.
- Rule: a surface's edit score counts ONLY fields a user can change in the
  UI; discover counts ONLY information visibly reachable (hover/click),
  not data present in the DB.
- Impeccable cadence violation: ran once (titlebar), never re-run on new
  surfaces despite standing instruction. Cadence now: after every UI-landing
  round, run the impeccable pass on the changed surfaces + one untouched one.
