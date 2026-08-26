# Complete Request Audit — Full Session (2026-07-08 to 2026-07-11)

**Purpose:** An exhaustive, one-by-one, checked ledger of EVERY distinct request, complaint,
and instruction the owner made across the entire multi-day session — nothing collapsed, nothing
hidden. Built from all 236 harness-surfaced user messages, filtered to the **107 messages the
owner actually typed** (the rest were teammate/agent status noise), split into individual asks,
and cross-referenced against the roadmap (`2026-07-10-nightly-roadmap.md`), git history, and code.

**Method / honesty rules:** A status is only DONE when there is a commit or a file:symbol that
demonstrably implements it. Where a fix landed but the owner re-reported the same problem
afterwards, or where evidence is indirect, it is PARTIAL with the reason stated. NOT-DONE and
IN-PROGRESS are used literally. No commits are invented.

**Headline tallies (177 distinct requests):** Done 62 · Partial 95 · Not done 9 · In progress 11. (A single owner message often carried several asks, so 107 messages expand to 177 distinct requests.)

> The gap the owner keeps naming — "asks I never got a response from" — is concentrated in
> Section 3. The single loudest cluster is the **Library list / titlebar-sidebar redesign**
> (asked 10+ times, "for the millionth time", still contested at the last message) and the
> **waveform-must-match-the-mockup / disk-cache / transcript-on-nav** cluster (H2/H3/H5/H6).

---

## Section 1 — Chronological Request Ledger

Legend: [D] Done · [P] Partial · [N] Not done · [IP] In progress. "MSG n" = owner message number.
Roadmap ids (H1–H14, A–G) referenced where they map.

### 2026-07-08 — Day 1 (transcription, first architecture vision)

| id | MSG | Request | Status | Evidence / What remains |
|----|-----|---------|--------|--------------------------|
| R001 | 1 | transcription not working; why + what service | [D] | Diagnosed Gemini Files API path; transcription.ts; root-caused. |
| R002 | 2 | find all errors in the transcription engine | [D] | Multi-agent audit; fixes in transcription.ts (chunking, JSON repair, retry). |
| R003 | 2 | transcribe Rec43 in a nice usable format | [D] | Fully transcribed after MP3-aware chunking (splitMp3IntoChunks); tail recovered. |
| R004 | 4 | did you downgrade to 2.5 flash? | [D] | Answered; model selection corrected. See R123 (recurred Jul 10). |
| R005 | 5 | transcription was cut after a few lines | [D] | Root cause maxOutputTokens 8192 truncation on hour-long single call; fixed via chunking. |
| R006 | 6 | cannot scroll today's view | [P] | Today reworked (9cbc115c,6d1f6265); scroll later re-litigated (R069). Needs a live check. |
| R007 | 7 | tie all parts of the app — action items into projects | [D] | Projects-as-hubs + actionables pipeline (8fd81f05, output-generator). |
| R008 | 7 | projects auto-detected with rich metadata (repo/webpage/contacts/actions/issues/risks/summary/meetings) | [P] | Entity+hub landed; auto-detection + rich metadata only partial. ACTION ITEM: finish project auto-detect + metadata fields. |
| R009 | 7 | people auto-added from ICS, linked to project/place/team, actions attached | [D] | Identity platform + attendees-to-contacts (93a9cc96). |
| R010 | 7 | calendar overlays recordings by date/time/duration (1:1, partial, spanning) | [P] | Correlation landed (d3cea7d7); span/merge cases imperfect. ACTION ITEM: handle spanning + merged-recording cases. |
| R011 | 7 | meeting-detail opens correctly, scrollable, transcript present | [D] | 7e18d1cc unify reader + Join fix; 3f45bc74 badge from transcript. |
| R012 | 7 | "go to calendar" jumps to now instead of the meeting time | [P] | Nav reworked; jump-to-meeting-time not confirmed. ACTION ITEM: verify target time. |
| R013 | 7 | calendar conflicts should hang, not shrink like Outlook | [N] | No hang-overlap layout found. ACTION ITEM: build hanging-overlap calendar layout. |
| R014 | 7 | "invalid recording ID" on some clicks | [D] | resolveRecordingId fix. |
| R015 | 9 | Urgent Call transcript ends early — did it cut? | [D] | Confirmed data truncation; fixed. |
| R016 | 9 | transcript is one wall of text (no turns/timestamps/speakers) | [P] | parseInlineTurns + render-time splitting; legacy transcripts still walls (recurred MSG214). ACTION ITEM: backfill re-render legacy transcripts. |
| R017 | 28 | measure editability/clickability/discoverability across all entities | [P] | EntityMention + hover cards + speaker popover; coverage incomplete (Context Graph, Actionables). Recurs R040,R073,R116. |
| R018 | 28 | edit a person in a transcript -> changes everywhere | [D] | transcript_speakers binding + contacts:merge. |
| R019 | 28 | add missing meeting info -> propagate contact info to all transcript people | [P] | meetings:addAttendee exists; auto back-propagation not fully wired. ACTION ITEM: propagate contact info to speakers. |
| R020 | 28 | merge people discovered the same | [D] | mergeContacts() + merge UI (cf82c1dc). |
| R021 | 28 | execute with opus 4.8 agents; you orchestrate + check quality | [P] | Followed as working mode; adherence self-reported. |
| R022 | 34 | recency-first transcription priority, steered in code | [D] | orderPendingForProcessing() recency-first dequeue (6139f404). |
| R023 | 34 | write the session goal as goal.md | [P] | Captured in roadmap+memory, not a dedicated goal.md. ACTION ITEM: produce goal.md. |
| R024 | 46 | hover a speaker -> show metadata (name/email/role/phone) | [P] | SpeakerAssignPopover + hover cards; MSG208 still no hover on Context-Graph person lens. ACTION ITEM: hover metadata on all renders. |
| R025 | 46 | right-click speaker: edit/replace/clear/reset; left-click pick | [P] | Assign/unassign popover; right-click menu not confirmed. ACTION ITEM: right-click speaker menu. |
| R026 | 46 | people list needs metadata + discoverability per item | [P] | Rows enriched partially; flagged thin later (R059). ACTION ITEM: enrich people-list rows. |
| R027 | 47 | confidence/probability on identity + project so we stop dup entities | [P] | Confidence resolver + corroboration (6e321229); UI probabilities incomplete. ACTION ITEM: surface confidence in UI. |
| R028 | 47 | editing entity metadata triggers graph re-discovery | [P] | graph-sync/org-reconciler exist; explicit re-discover-on-edit partial. ACTION ITEM: trigger re-discovery on edit. |
| R029 | 51 | persist all definitions (alias memory, resolver, suggestion queue) to a doc | [D] | Intelligence architecture captured in docs/memory. |
| R030 | 51 | assign completion values per component -> a prioritization map | [P] | Partial scoring (ROADMAP D); full per-component KPI index is Section 2 here (J3). |
| R031 | 54 | connectors: BambooHR/Kantata/Salesforce/Slack/M365/AWS/Jira/Teams/Amazon Connect | [P] | Host+registry (b99ad7b9), M365 (6c670fa6/1861b792), Slack (98ac13f7) shipped. 7 others NOT built. ACTION ITEM: build remaining connectors. |
| R032 | 54 | M365 connector -> email autocomplete in People edit | [P] | M365 connector landed; autocomplete wiring not confirmed. ACTION ITEM: wire email autocomplete. |
| R033 | 54 | Slack connector -> metadata + send message + channels as sources | [P] | connectors-slack contract shipped; ingestion+send not confirmed live. ACTION ITEM: Slack ingestion+send. |
| R034 | 54 | GitHub connector -> repo md as sources; project metadata from commits | [P] | Today shows git commits (f8c6ba4a); full GitHub connector NOT built. ACTION ITEM: build GitHub connector. |
| R035 | 54 | Android / WhatsApp / PDF / image connectors | [N] | Not built (PDF/image is a roadmap note c412cf17). ACTION ITEM: build these connectors. |
| R036 | 55 | connectors + entity-type extensions, no expensive-LLM dependency | [P] | connectors host implements the split; most entity extensions not implemented. ACTION ITEM: implement shared entity-type extensions. |
| R037 | 64 | is all running? app stopped responding, need it up | [D] | Restarted; freeze root-caused (R038). |
| R038 | 66 | app freezing while downloading/transcribing | [D] | Debounced sql.js persistence + 079517f3 serialize boot work. |
| R039 | 65 | downloads not in order — need newest first (started Jun22) | [D] | Downloads gated + newest-first. |
| R040 | 67 | downloads start even when device off | [P] | Gating added; device-off guard partial (recurred R070-R072). ACTION ITEM: verify no dispatch when device off. |
| R041 | 67 | keep restarting until you find + fix what is broken | [D] | Iterative restart-debug loop performed. |
| R042 | 77 | what is going on? | [D] | Status provided. |
| R043 | 78 | ICS invitees missing (no hover/click on Today meetings) | [D] | 93a9cc96 show Participants+Invited; d0c3fd8e split. (Re-asked R140.) |
| R044 | 79 | why did feedback loops miss it? review whole session; did you map it? | [P] | Roadmap exists; full mapping delivered by THIS doc (see R136,R157). |
| R045 | 82 | run impeccable UI feedback loop on Today | [P] | impeccable/dogfood used; Today still flat (R046-R049). ACTION ITEM: standing impeccable pass per surface. |
| R046 | 82 | Today: poor contrast, no hover animation, underuses space | [P] | Reworks done; still flagged MSG126/137. ACTION ITEM: contrast+hover pass. |
| R047 | 82 | Today: time-to-meeting + highlight next meeting | [P] | Countdown added; static re-flagged MSG87. ACTION ITEM: animated countdown + highlight. |
| R048 | 82 | meeting description unformatted, no link, not clickable | [P] | Formatting improved (7e18d1cc); rich-format/links not confirmed. ACTION ITEM: format + linkify description. |
| R049 | 82 | meeting Edit: nothing editable (time/duration/date/link) | [N] | Meeting field editing not implemented. ACTION ITEM: editable meeting fields. |
| R050 | 83 | decide if we need skills/tools/commands for deterministic delivery | [P] | Some skills exist; no dedicated determinism tooling. ACTION ITEM: decide on determinism tooling. |
| R051 | 87 | recording indicator when device is recording (red dot) | [P] | Requested repeatedly (R057,R124); indicator partial, contested. ACTION ITEM: reliable recording indicator. |
| R052 | 87 | live countdown that visibly updates + next-meeting time | [P] | Countdown present; ticking unconfirmed. ACTION ITEM: verify countdown ticks. |
| R053 | 87 | stronger Today typography (grey-on-grey); same on calendar | [P] | Typography touched; punch still questioned MSG126. ACTION ITEM: typographic hierarchy pass. |
| R054 | 94 | give feedback on this new surface | [D] | Feedback exercise performed. |
| R055 | 95 | encode "how does the user know if two are the same" into the skill | [P] | Disambiguation context added (87a08985); skill encoding partial. ACTION ITEM: encode same-entity heuristic. |
| R056 | 96 | merge UI must show context of BOTH + impact (how many/which sources) | [P] | Some context/source shown; impact-count + neighbors graph not complete. ACTION ITEM: merge-impact + both-sides context. |
| R057 | 105 | recording light on Today + assign ongoing recording to a meeting | [P] | Attribution partially designed; assign/un-assign-while-recording not confirmed. ACTION ITEM: live attribution + assign/un-assign. |
| R058 | 106 | show meeting still ongoing + recording when joined late | [P] | Ongoing/late-join handling not confirmed. ACTION ITEM: ongoing + late-join state. |
| R059 | 107 | "connect device" shown though connected + recording | [P] | Connect-status reworked (4fb3b227); recurred MSG214/215. ACTION ITEM: verify connect state under active-recording. |

### 2026-07-08 evening -> night — device lock, merge context, Today redesign

| id | MSG | Request | Status | Evidence / What remains |
|----|-----|---------|--------|--------------------------|
| R060 | 108 | unblock the device at hardware level WITHOUT power-cycling | [P] | Drain attempted; in LIBUSB_ERROR_ACCESS locked-active state a physical replug was still required (MSG115). ACTION ITEM: research software-only unlock. |
| R061 | 111 | can you send ack/receive commands to free it? | [P] | Drain/ack attempts implemented; not reliably sufficient in locked state. |
| R062 | 112-114 | do not reset/replug while a Teams call is live; closing the app must not cut the call | [D] | Understood + honored; USB audio device, node reset/replug cuts the call; recovery held for idle windows. |
| R063 | 115 | you did not fix it, I had to replug | [P] | Device recovery without physical action not achieved in this state. ACTION ITEM: document the hardware limitation clearly. |
| R064 | 115 | "Feriado" all-day event representation is wrong | [P] | Re-flagged MSG123 (wrong spot/tomorrow/on top). ACTION ITEM: fix all-day rendering + placement. |
| R065 | 115 | meetings with recordings are not signaled in the calendar | [P] | Recording-to-meeting signaling partial. ACTION ITEM: signal recorded meetings on the calendar. |
| R066 | 120 | I am in a meeting, it is not shown in the calendar | [P] | Live-meeting-in-calendar surfacing not confirmed. ACTION ITEM: surface the current live meeting. |
| R067 | 123 | recording not in Today; "All day Feriado" wrong spot pinned on top | [P] | Today all-day placement unresolved. ACTION ITEM: fix Today all-day placement + ongoing recording. |
| R068 | 126 | SO MANY times about look and feel — no shadows/animations/contrast | [P] | Status given; owner remained unsatisfied (recurs R100,R116). ACTION ITEM: shadow/animation/contrast pass. |
| R069 | 127 | rolling/fade time window; million-dollar redesign; dark/light theme switch | [P] | Today Stream built then reverted (527af57e->5091ad4d); rolling window + theme switch not confirmed. ACTION ITEM: rolling window + theme switch. |
| R070 | 128 | then go — what happened with the rest of the solution? | [D] | Work continued. |
| R071 | 135 | merge dialog cannot pick the correct side; what if BOTH are wrong? | [P] | Merge-correct mode roadmapped (8365ce8e); keeper-select/edit-both not complete. ACTION ITEM: keeper-selection + edit-both. |
| R072 | 137 | the three-KPI audits are not being run; new Today UI not clearly better | [P] | Audits partially run; hover/legend gaps persisted. ACTION ITEM: run the three-KPI audit each round. |
| R073 | 137 | Actionables: no hover, cannot see detail — only Approve/Generate with no context | [P] | 8fd81f05 sort/group/filter + counts; per-item detail/hover not confirmed. ACTION ITEM: actionable detail view + hover. |

### 2026-07-09 — identity depth, dashboard, connectors, Entra

| id | MSG | Request | Status | Evidence / What remains |
|----|-----|---------|--------|--------------------------|
| R074 | 151 | unmatched recording (has transcription) gives no context to assign it | [P] | d3cea7d7 matching; unmatched-recording context panel not complete. |
| R075 | 153/184 | 13 meetings today but only detail is yesterday's follow-up | [D] | 6d1f6265 today's follow-ups digest. |
| R076 | 153/184 | Claude Code handoff incomplete — shows in list but does nothing useful | [P] | 19f3292c CTA + generation, but owner STILL says clipboard/file at MSG236 -> H9 open. |
| R077 | 163 | status/roadmap; 2 shells + 1 monitor for what; 59 agents mostly idle | [D] | Status explained. |
| R078 | 164 | clear vs compact guidance | [D] | Advised. |
| R079 | 164 | run C2/C3 connectors in parallel; connectors pluggable/decoupled | [D] | Connectors host is decoupled; C2/C3 landed. |
| R080 | 164 | process all backlog now — a UI control? should the app do it alone? estimate the cost | [P] | Queue processing exists; one-click backlog control + cost estimate not confirmed. |
| R081 | 164 | mark important old transcripts; the rest get cheap LLM-format, not full re-transcription | [N] | Importance-gated cheap reformat not implemented. |
| R082 | 165 | 60 to 100 agents!? what are we using? | [D] | Explained. |
| R083 | 166 | reconcile ambiguous first-names at RECORDING level, not global | [P] | Recording-scoped speaker binding exists; recording-level disambiguation UI not complete. |
| R084 | 167 | merging safer when a meeting (calendar/emails) is related | [D] | Meeting-linked corroboration in resolver (6e321229). |
| R085 | 168 | does ICS not already cover that? | [D] | Confirmed; ICS attendees feed identity. |
| R086 | 180 | interactive HTML dashboard: each agent's task, dormant ones, status vs plan + roadmap | [P] | session-dashboard skill exists; per-agent live dashboard build not confirmed. ACTION ITEM: build the agent/roadmap dashboard. |
| R087 | 181 | Context Graph looks like a knowledge graph — where is reasoning/strategy/intent? | [P] | cf82c1dc clickable/editable nodes; reasoning/strategy/intent LAYER not built. ACTION ITEM: add reasoning layer. |
| R088 | 182 | continue | [D] | Continued. |
| R089 | 185 | credits are back | [D] | Acknowledged. |
| R090 | 186 | agents use Opus 4.8 not Fable 5, correct? | [D] | Confirmed Opus 4.8. |
| R091 | 187 | clickable + observable dashboard; open items needing my input with instructions | [P] | Depends on R086; interactive drill-in not confirmed. ACTION ITEM: clickable items + awaited-input instructions. |
| R092 | 188 | company Entra app vs public OSS app — how reconcile? | [D] | Advisory answered (bring-your-own Entra app; per-user registration). |
| R093 | 189 | personal Microsoft account setup; want an "Allow access to my calendar" popup like HiNotes | [P] | MSAL device-code path exists; one-click consent popup UX not confirmed. ACTION ITEM: simple personal-account consent + clear docs. |
| R094 | 191 | so what should I do now? | [D] | Directed. |

### 2026-07-10 — Sean emails, diarization, library redesign, waveform, device connecting

| id | MSG | Request | Status | Evidence / What remains |
|----|-----|---------|--------|--------------------------|
| R095 | 192 | 2 instances running | [D] | Second-instance guard (fe115e63). |
| R096 | 193 | Play button below the waveform does not work (file-list one does) | [D] | 451c7297 reader waveform Play loads+plays on fresh open. |
| R097 | 194 | LLM not associating clearly-stated full names to speakers | [P] | Self-stated-name binding (d917b3ec) + corroboration; imperfect on old recordings. ACTION ITEM: improve name binding on legacy recordings. |
| R098 | 195 | diarization wrong: name at 12:11 shows as 0:00; missed speaker change at 2:31 | [P] | 305654c2 diarization spike + ae56da8a per-turn overrides; accuracy imperfect. ACTION ITEM: improve boundary detection. |
| R099 | 196 | do all of that and anything else; experiment, annotate, retry until best | [D] | WER/diarization spikes run + annotated (f1e1eaee, 0903fd80). |
| R100 | 197 | review how/when we can REMOVE sources (personal recordings add no value) | [D] | 53204b84 privacy source-deletion — personal flag + full delete cascade (v38). |
| R101 | 197 | Noman/Nouman: find-and-correct-all (ASR error); clickable names in transcript body | [P] | Entity mentions clickable in some surfaces; global find-and-correct + body linking not complete. ACTION ITEM: global correct + transcript-body linking. |
| R102 | 198 | Library redesign; AI Assistant as overlay/dockable (pinned or collapsed) | [D] | 4e921800 floating bubble + pin-to-embed + collapse; 4d200e9f library redesign. |
| R103 | 198 | source list supports multiple formats; rethink filter/sort, simplified | [P] | 4d200e9f multi-format rows + simplified filters; further simplification re-requested. ACTION ITEM: multi-format list + simpler filters. |
| R104 | 198 | "Search captures..." duplicates the top search box | [P] | Not confirmed de-duplicated. ACTION ITEM: remove the duplicate search box. |
| R105 | 198 | filter by source type; fix broken quality filter; sort by duration to clean short calls | [P] | Some filters landed; quality filter + duration sort not confirmed working. ACTION ITEM: fix quality filter + duration sort. |
| R106 | 199 | what to ask Sean for (firmware, hardware docs, live-audio transcription) — your view | [D] | Advisory given. |
| R107 | 200 | H1E mic array — check mono/stereo separation; draft the email reply | [P] | Email drafted; channel-separation check on real files not confirmed run. ACTION ITEM: analyze H1E channel layout. |
| R108 | 201 | ask Sean for discounted hardware (H1E/P1/P1 Mini) | [D] | Folded into the email draft. |
| R109 | 202 | discounted not free; loaner fine; fold them in | [D] | Email updated. |
| R110 | 203 | add a responsiveness check to the per-round test battery | [P] | 4437b001 responsive-width fix; standing responsiveness check not confirmed. ACTION ITEM: add responsiveness check to test battery. |
| R111 | 204 | send WER results when in; spot the email issue | [D] | WER produced; email issue-spotting done. |
| R112 | 204/205 | biggest email issue: offered to test his Apple-Silicon app but I have no M1 Mac | [D] | Caught + corrected; MSG205 acknowledged. |
| R113 | 206 | write the email | [D] | Final email written. |
| R114 | 207 | compacting (~95%); anything to save first? | [D] | Pre-compaction notes/memory saved. |
| R115 | 208 | run the ability skill on each update AND every surface; keep ability-agents ready | [IP] | Ongoing audit loop (Track E); not complete. ACTION ITEM: finish cross-surface KPI audit loop. |
| R116 | 208 | person lens: no discoverability; clicking "Jiarabi" (should be Yaravi) gives no rename/merge; source not clickable; no bulk ops; cannot locate node | [P] | cf82c1dc locate/merge/convert; owner reports still failing at MSG208. ACTION ITEM: person-lens rename/merge/locate/bulk + clickable source. |
| R117 | 210 | line below the top bar does not reach the right side | [D] | 70d9715a (H14) full-width divider. |
| R118 | 210 | title oddly aligned, spills over sidebar, poor coherence | [P] | Titlebar reworked; alignment re-litigated MSG217/219/231. ACTION ITEM: fix title alignment (part of redesign R142). |
| R119 | 210 | sidebar Actionables/Today/Sync need counters | [P] | Actionables count done (1f8c4c98); Today+Sync counters not confirmed. ACTION ITEM: add Today + Sync counters. |
| R120 | 210 | transcription dock: collapse-to-icon/expand-to-surface, pause, see what it is, go to meeting, (de)prioritize; same for Activity Log | [P] | 6139f404 pause/resume + reorder backend; the dock UI affordances not confirmed. ACTION ITEM: transcription-dock UI affordances. |
| R121 | 210 | collapsed sidebar: alignment with top menu off; centering off; not aligned with titlebar | [P] | Chrome alignment reworked (2c1023cb); re-flagged MSG217/231. ACTION ITEM: collapsed-sidebar alignment (part of redesign). |
| R122 | 211 | I am back — brief of all that happened + what I need to do | [D] | Brief provided. |
| R123 | 212 | transcription models ARE ALL WRONG — WHO ADDED 2.5? | [D] | bfda7862 live audio-capable Gemini model list (drops stale 2.5/TTS/Image). Note: landed 11:20; owner still saw stale at 13:44 (needs app restart). |
| R124 | 213 | not in a live meeting — should not be marked recording; at most ongoing | [P] | Recording-state accuracy re-flagged; not confirmed fixed. ACTION ITEM: correct recording-vs-ongoing when user not joined. |
| R125 | 214 | why still "connecting"? find WHY it is stuck (should be disconnected/error) | [D] | 4fb3b227 main-side connect timeout so status cannot hang on connecting. |
| R126 | 214 | waveform should always be loaded, not wait for Play | [P] | eb559e86/87202b89 silent auto-load; but H5 (disk cache / overlay) still OPEN at MSG236. ACTION ITEM: H5 disk-cached waveform. |
| R127 | 214 | duration should not be "Unknown" | [P] | Duration backfill (4d200e9f); Unknown recurred MSG214. ACTION ITEM: ensure duration resolves. |
| R128 | 214 | actionable -> recording marked Queued then Transcribed — did it transcribe again? | [P] | Status-drift heal (ba48bd2b, 3f45bc74); re-transcribe confusion not confirmed resolved. ACTION ITEM: verify no phantom re-transcribe. |
| R129 | 214 | transcription fail: one Speaker for many turns, cramped one line | [P] | 72ba2a66 robust diarization for fresh runs; legacy transcripts still affected. ACTION ITEM: fix legacy single-speaker transcripts. |
| R130 | 214 | "Follow" with audio not loaded should go to position 0 | [D] | eb559e86 Follow-to-top. |
| R131 | 214 | old recording: date has no YEAR; not selected -> scroll 1911 captures; no Transcribe button | [P] | 3284f12e/f5499aca add year + relative date + scroll-to-open; missing-Transcribe not confirmed. ACTION ITEM: Transcribe on old recordings + auto-select. |
| R132 | 214 | "VibeVoice" button should read "Local transcription" under a Transcribe menu | [P] | eb559e86 Transcribe picker exists; relabel/placement not confirmed. ACTION ITEM: relabel VibeVoice. |
| R133 | 215 | screenshot it yourself — still connecting; FIX IT, I will restart when fixed | [D] | Fixed via 4fb3b227; MSG216 confirms cleared without a boot. |
| R134 | 216 | fresh boot!? I did not boot the device — how did you fix it? | [D] | Explained (main-side timeout resolves stuck state). |
| R135 | 217 | title not "Meeting Intelligence" — worse; no fix on Operations/Activity Log/Restart/QA Logs | [P] | cb434508 Activity Log-to-badge, gated Restart, QA Logs-to-Settings; owner still dissatisfied MSG217. ACTION ITEM: finish Operations/Activity/QA-Logs/title. |
| R136 | 217 | review the ENTIRE session; compile ALL feedback; list fixed vs not vs roadmap | [P] | Prior attempts partial (recent only); THIS document is the intended full delivery. |

### 2026-07-10 night -> 2026-07-11 — library list, titlebar options, waveform, handover, brains

| id | MSG | Request | Status | Evidence / What remains |
|----|-----|---------|--------|--------------------------|
| R137 | 218 | restart! | [D] | Done. |
| R138 | 218 | remove the always-visible select checkbox; show on hover or when 1+ selected; add select/deselect-all | [D] | H4 f1db2204 removes per-row checkbox (reveal-on-hover later removed too). |
| R139 | 218 | remove the per-row Play button (clicking it selects the file) | [D] | a3779ec7/f5e8c264 drop per-row Play. |
| R140 | 218 | where is the participants list + invited list (ICS/Outlook)? | [P] | 93a9cc96/d0c3fd8e participants+invited in detail; not on all surfaces. ACTION ITEM: participants + invited on every relevant surface. |
| R141 | 219 | add ability to run diarization for a SPECIFIC audio | [D] | 1dd08d4e recordings:reDiarize IPC. |
| R142 | 219 | complete titlebar+sidebar redesign; 5+ HTML options; use impeccable + frontend-design; add native-app-designer | [IP] | Options iterated MSG222/229/230/234; owner chose 01 (MSG234) but still correcting (MSG233/235). ACTION ITEM: finalize option 01. |
| R143 | 219 | dislike the 3-section split, the button next to the app icon, and the weak title prominence | [IP] | Under active redesign; unresolved. |
| R144 | 219 | clicking one file makes ALL files show the checkbox; wasted checkbox space | [D] | f1db2204 (H4) removes the checkbox; view-vs-select decoupled (f141c47f). |
| R145 | 219 | remember column width; responsive collapsing list like the assistant | [P] | f141c47f persist+collapse list column; width re-raged at MSG225. ACTION ITEM: responsive collapsing list + remembered width. |
| R146 | 219 | docked waveform is obscenely huge; compact it 50%+; dock a small field set + CTAs | [P] | d0c3fd8e compact docked player + 3c60511b single morphing waveform; compaction contested (MSG228). ACTION ITEM: H2 compact docked waveform + docked fields/CTAs. |
| R147 | 220 | docked waveform could reduce to a compact pill | [P] | Docked-pill direction is H2 open work. ACTION ITEM: H2 docked pill. |
| R148 | 220 | full waveform useful: time position, per-speaker colors, numbered markers linked to summary, sentiment curve | [P] | 364c769d/e395f65f/87202b89 speaker colors + markers + sentiment (thumbs-up MSG222); regressed -> H2 reopened MSG228/236. ACTION ITEM: H2 full waveform to match mockup. |
| R149 | 222 | assistant must be a floating chat-BUBBLE (not the docking pane); click-to-float; pin-to-embed; collapse-to-icon; expose in Settings | [P] | 4e921800 floating bubble + pin-to-embed + collapse; Settings placement toggle not confirmed shipped. ACTION ITEM: Settings placement toggle. |
| R150 | 222 | timeline full-mode good (approved); also pin/expand it; build ALL now | [P] | 364c769d pin in full mode; build-all contradicted by later regressions. ACTION ITEM: pin/expand full-mode reliably. |
| R151 | 222 | I need MORE titlebar options; it must be a CUSTOM integrated bar (like Office), NOT a split window titlebar | [IP] | Integrated direction pursued (70d9715a, 529bcdae); 5-option round still iterating. |
| R152 | 223 | move the doc button right of "Knowledge"; align the icon vertically with other sidebar icons | [P] | a5132b5a/529bcdae chrome moves; placement + alignment re-raised MSG231. ACTION ITEM: doc-button placement + icon alignment. |
| R153 | 223 | no separator between the filters and the library | [D] | 5ce0e648 add separator. |
| R154 | 224 | hide the Restart button inside the device dropdown | [P] | Restart reachable/gated (a6b14877/cb434508); hide-into-dropdown not confirmed. ACTION ITEM: move Restart into device dropdown. |
| R155 | 225 | library list must NOT need horizontal scrolling (min width); remove left padding; move left icons to the right | [P] | f5e8c264 no-horizontal-scroll (Jul10 19:09) yet re-reported 22:02 (MSG225). ACTION ITEM: guarantee no horizontal scroll + move icons right + remove left padding. |
| R156 | 225 | the row separator line does not reach the far left/right | [P] | f5e8c264 full-bleed rows target this; owner still saw it (MSG225). ACTION ITEM: full-bleed separators to both edges. |
| R157 | 226 | tired of repeating; MAP all I asked and where we stand | [P] | The mapping is THIS document (prior attempts insufficient). |
| R158 | 227 | you REMOVED the what's-next meeting agenda; now a list of dates spanning a year | [P] | Stream (527af57e) reverted (5091ad4d); 9cbc115c may still produce the year-span list. ACTION ITEM: restore the meeting agenda; stop the year-span list. |
| R159 | 228 | what happened with the waveform? (regressed) | [P] | Waveform regression = H2. ACTION ITEM: H2 waveform. |
| R160 | 229 | give me 5 titlebar options to choose from | [IP] | Options produced + iterated; not finalized. |
| R161 | 230 | chose 04 for collapse-icon placement; 03 for the rest of the top bar | [IP] | Selections logged; implementation iterating. |
| R162 | 231 | center the app icon vertically with menu icons; produce logo variants (sidebar / titlebar / both) | [IP] | Not confirmed all produced. ACTION ITEM: center app icon + 3 logo-integration variants. |
| R163 | 232 | NO! NO! and NO! (rejecting options) | [IP] | Iteration continued. |
| R164 | 233 | collapse-button placement differs per version; change the gradient when removing the split; shadows must differ per version | [IP] | Feedback logged. ACTION ITEM: consistent collapse placement + revised gradient + per-version shadows. |
| R165 | 234 | 01 (chose option 01) | [IP] | Option 01 selected; finishing pending. |
| R166 | 235 | FOLLOW MY INSTRUCTIONS! CLEAN, COMPACT, PLAN, then WORK ALL NIGHT | [IP] | Nightly roadmap is the plan; execution in progress. |
| R167 | 236 | stop the transcriptions | [D] | H1 done — queue cancelled/emptied. |
| R168 | 236 | properly build the Claude Code handover (only copies to clipboard / creates a file) | [N] | H9 open. CTA/generation exists (19f3292c) but a real usable handoff is not built. ACTION ITEM: build the real handoff (H9). |
| R169 | 236 | add pluggable AI brains: Claude Code SDK, Codex SDK, Gemini CLI SDK, toggleable, for all in-app LLM work | [P] | @hidock/ai-providers exists (anthropic/bedrock/gemini/ollama/openai API) but the CLI/SDK brains + Settings toggle are NOT built. H10 open. ACTION ITEM: add CLI/SDK brains + toggle (H10). |
| R170 | 236 | fix the waveform to match the mockup (colored bars, sentiment curve, numbered markers on the curve, event list) | [N] | H2 open — looks nothing like the mockup. ACTION ITEM: H2. |
| R171 | 236 | action items are repeated — remove them from the transcript | [N] | H3 open — de-dup not implemented. ACTION ITEM: H3. |
| R172 | 236 | remove the on-hover checkbox (library rows) | [D] | H4 done — f1db2204 renders no checkbox in any state. |
| R173 | 236 | remove the "Loading waveform" image; generate peaks once, cache on disk, load instantly | [N] | H5 open — disk-cache not implemented. ACTION ITEM: H5. |
| R174 | 236 | "no color" waveform + "transcript not available" when clicking Library in the sidebar | [N] | H6 open — load-on-navigation not fixed. ACTION ITEM: H6. |
| R175 | 236 | meeting icons suddenly disappeared; lists take forever / never load | [P] | eeed308d non-blocking calendar sync (H7) landed post-message. ACTION ITEM: verify H7 live. |
| R176 | 236 | "Refresh" spins with no activity in the log | [P] | Part of H7 (eeed308d). ACTION ITEM: verify Refresh works. |
| R177 | 236 | app randomly auto-navigates to Today with no input | [P] | eeed308d route persistence (H8) landed post-message. ACTION ITEM: verify H8 live. |

---

## Section 2 — Per-Component KPI Index (satisfies owed item J3)

Requests grouped by app surface/component. "Open items" lists the highest-signal unfinished asks.

| Component / Surface | # Req | Done | Partial+IP | Not done | Top open items |
|---------------------|------:|------:|-----:|---:|----------------|
| Transcription pipeline | 12 | 7 | 4 | 1 | Legacy transcripts still single-speaker walls (R016/R129); importance-gated cheap reformat NOT built (R081); action-item de-dup from transcript (R171/H3). |
| Library list (rows/filters/sort) | 12 | 4 | 8 | 0 | Horizontal-scroll/min-width STILL contested (R155); separator lines not reaching edges (R156); quality/duration filters+sort (R105); dup search box (R104). |
| Library reader / waveform | 13 | 3 | 6 | 4 | Waveform vs mockup (R170/H2); Loading-waveform + disk cache (R173/H5); transcript-not-available on nav (R174/H6); duration Unknown (R127). |
| Titlebar / chrome | 12 | 3 | 9 | 0 | Full titlebar+sidebar redesign, 5 options, pick 01 — NOT finalized (R142/R151/R160-R166); app-icon centering (R162); Operations/Activity/QA-Logs affordances (R135). |
| Today / Stream | 12 | 2 | 9 | 1 | Recording light + ongoing/late-join indicator (R051/R057/R058/R124); rolling time-window redesign + theme switch (R069); removed agenda / year-span regression (R158); all-day Feriado placement (R064/R067). |
| Calendar | 6 | 1 | 4 | 1 | Conflicts should hang not shrink (R013); live meeting not shown (R066); recordings not signaled on calendar (R065); go-to-calendar wrong target time (R012). |
| MeetingDetail | 4 | 1 | 2 | 1 | Meeting fields not editable — time/duration/date/link (R049); description formatting/links (R048). |
| People / identity / merge | 15 | 5 | 10 | 0 | Merge UI must show both-sides context + impact count (R056/R071); recording-level disambiguation (R083); global find-and-correct (Noman/Nouman) + transcript-body linking (R101); confidence in UI (R027). |
| Projects | 2 | 1 | 1 | 0 | Auto-detection + rich metadata (repo/webpage/risks) (R008). |
| Context / Knowledge Graph | 4 | 0 | 4 | 0 | Reasoning/strategy/intent layer (R087); person-lens rename/merge/locate/bulk (R116); edit-to-re-discover trigger (R028). |
| Actionables | 3 | 0 | 3 | 0 | Per-item hover/detail context — approve what? generate what? (R073); one-click backlog processing + cost estimate (R080). |
| Assistant / RAG | 3 | 1 | 2 | 0 | Floating-bubble vs dock exact behavior + Settings placement toggle (R149); pin full-mode timeline (R150). |
| Device / USB sync | 13 | 8 | 5 | 0 | Unblock locked device without replug (R060/R061/R063); downloads-when-off guard (R040); connecting/recording state edge cases (R124). |
| Transcription dock / Operations / Activity Log | 3 | 1 | 2 | 0 | Collapse/expand, pause, go-to-meeting, (de)prioritize (R120); Today/Sync sidebar counters (R119). |
| Connectors | 6 | 1 | 4 | 1 | BambooHR/Kantata/Salesforce/AWS/Jira/Teams/Connect NOT built (R031); Android/WhatsApp/PDF/image NOT built (R035); entity-type extensions (R036). |
| AI brains / providers | 1 | 0 | 1 | 0 | Claude Code SDK / Codex SDK / Gemini CLI SDK toggleable brains — NOT built (R169/H10). |
| Handover (Claude Code) | 2 | 0 | 1 | 1 | Real usable handoff beyond clipboard/file (R168/H9). |
| Dashboard / agent observability | 3 | 0 | 3 | 0 | Interactive agent-status dashboard with clickability + awaited-input (R086/R091). |
| Settings | 2 | 1 | 1 | 0 | Live model list landed (R123); assistant placement toggle (R149). |
| Sean / external (email, WER, hardware) | 8 | 7 | 1 | 0 | Mono/stereo mic-array channel-separation check on real files (R107). |
| Meta (mapping / process / goal.md) | 6 | 1 | 5 | 0 | goal.md artifact (R023); deterministic skills/tooling (R050); THIS full mapping (R044/R136/R157). |

---

## Section 3 — The Un-Answered List (every Not-done / Partial / In-progress, ranked by emphasis)

### Tier 1 — Loudest / most-repeated (raised 3+ times)

1. Library list horizontal scroll, min-width, left padding, edge-to-edge separator lines (R144-R156). "For the millionth time", "I asked you 100 times". A fix landed (f5e8c264) yet re-reported 3 hours later (MSG225). STILL CONTESTED.
2. Waveform must match the mockup (R148/R159/R170, H2). Thumbs-up once (MSG222), then re-spec at MSG228/236. OPEN.
3. Full titlebar + sidebar redesign (R142/R143/R151/R160-R166). 5-option round, chose 01, still correcting. IN PROGRESS, not finalized.
4. Map ALL I asked and where we stand (R044/R136/R157). Asked 4+ times; prior attempts covered recent messages only. THIS document is the answer.
5. Clickability / editability / discoverability everywhere (R017/R030/R072/R115/R116). Through-line of the session; still failing on Context Graph, Actionables, People-list. PARTIAL.

### Tier 2 — Feature-critical, clearly open

6. Claude Code handover, properly built (R076/R168, H9). Called incomplete twice (MSG153, MSG236). OPEN.
7. Pluggable AI brains — Claude Code / Codex / Gemini CLI SDKs + toggle (R169, H10). NOT built.
8. Loading-waveform overlay + generate-once/disk-cache (R173, H5). OPEN.
9. Transcript-not-available + no-color waveform on sidebar Library navigation (R174, H6). OPEN.
10. Action items duplicated (transcript + summary) — de-dup (R171, H3). OPEN.
11. Today recording light + ongoing/late-join attribution (R051/R057/R058/R105). "Still waiting for that simple improvement." PARTIAL.
12. Today redesign: rolling/fading time window, million-dollar polish, theme switch; do NOT remove the agenda (R069/R158). Stream built, reverted, left a year-span date list. PARTIAL/REGRESSED.

### Tier 3 — Repeatedly implied, partially addressed

13. Merge UI needs both-sides context + impact count (R056/R071/R135). PARTIAL.
14. Recording-level disambiguation for ambiguous first-names (R083). PARTIAL.
15. Global find-and-correct (Noman/Nouman) + clickable names in transcript body (R101). PARTIAL.
16. Context Graph = reasoning/strategy/intent, not a Pollock knowledge graph (R087/R116). PARTIAL.
17. Actionables per-item context/hover (R073). PARTIAL.
18. Transcription dock affordances (R120). PARTIAL (backend pause/resume exists; UI does not).
19. Interactive agent/roadmap dashboard with clickability + awaited-input (R086/R091). PARTIAL.
20. Legacy transcripts still render as single-speaker walls (R016/R129). PARTIAL (fresh runs fixed).

### Tier 4 — Named once, still open

21. Calendar conflicts should hang, not shrink (R013). NOT DONE.
22. Meeting fields editable — time/duration/date/link (R049). NOT DONE.
23. Importance-gated cheap reformat of old transcripts (R081). NOT DONE.
24. BambooHR/Kantata/Salesforce/AWS/Jira/Teams/Connect + Android/WhatsApp/PDF/image connectors (R031/R035). NOT DONE.
25. goal.md as a literal artifact (R023). PARTIAL.
26. Duplicate Search-captures vs top search box (R104). PARTIAL.
27. Quality low-value filter + sort-by-duration cleanup (R105). PARTIAL.
28. One-click backlog processing control + cost estimate (R080). PARTIAL.
29. Today/Sync sidebar counters (R119). PARTIAL.
30. Mono/stereo mic-array channel-separation check on real H1E files (R107). PARTIAL.

---

_Audit compiled 2026-07-11 from 107 owner-typed messages (of 236 harness-surfaced), the nightly roadmap, git log, and codebase spot-checks. PARTIAL items marked "not confirmed" need a live dogfood pass to promote to Done or demote to Not-done._
