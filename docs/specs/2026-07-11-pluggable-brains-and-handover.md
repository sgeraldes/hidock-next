# Pluggable AI Brains + Proper Claude Code Handover

**Spec ID:** 2026-07-11-pluggable-brains-and-handover
**Status:** Design (no code changed)
**Owner asks:** H10 (pluggable AI "brains") + H9 (proper Claude Code handover)
**App:** `apps/electron` (Universal Knowledge Hub)
**Author:** design pass, 2026-07-11

---

## 0. TL;DR

Today every LLM task in the Electron app is hard-wired to **Gemini-API-first / Ollama-fallback**,
and that routing is **re-implemented three separate times** (`chat-llm.ts`, `embeddings.ts`,
`output-generator.ts`) plus **inlined directly** in `transcription.ts` and `artifact-types.ts`.
The "Claude Code handover" is a one-way dump: generate a markdown prompt, copy to clipboard / write a
file, and (optionally) shell out to an external terminal running `claude`.

This spec introduces:

- **H10 — an `AIBrain` provider abstraction** in the main process, with adapters for the current
  Gemini-API and Ollama paths **plus** three toggleable "brains": **Claude Code SDK**
  (`@anthropic-ai/claude-agent-sdk`), **Codex SDK** (`@openai/codex-sdk`), and **Gemini CLI**
  (`@google/gemini-cli`). A `BrainRouter` chooses a brain per task (global default + per-task
  override) with **capability-aware fallback** (audio + embeddings always route to a capable brain).
  A new Settings "AI Brains" card toggles each brain, shows its auth status, and sets routing.
- **H9 — a real handover**: produce a self-contained **handover bundle** (prompt + transcript +
  summary + action items + metadata) written into the target repo, and **start the coding session
  in-app** via the Claude Code / Codex SDK with streamed progress — instead of only clipboard/file +
  external terminal (both kept as fallbacks).

**Phase-1 slice (recommended first PR):** ship the `AIBrain` interface + `BrainRouter` +
`GeminiApiBrain` + `OllamaBrain` + `BrainCredentialStore` + config migration, and refactor the three
duplicated routers to delegate to the router — **zero behavior change, all existing tests green**.
That creates the seam every later adapter and the handover redesign plug into.

---

## A. Current State — LLM call-site inventory (cited)

All paths are under `apps/electron/electron/main/services/` unless noted.

### A.1 The three duplicated "Gemini-first / Ollama-fallback" routers

| Service | Symbol | Task | Provider logic |
|---|---|---|---|
| `chat-llm.ts` | `ChatLLMService.generate()` / `generateText()` (L69, L89); `geminiChat()` (L93) | Conversational generation for RAG | Gemini (`config.chat.geminiModel`) if `transcription.geminiApiKey` set, else Ollama (L70-86) |
| `embeddings.ts` | `EmbeddingsService.generateEmbeddings()` (L32); `geminiBatch()` (L57) | Text embeddings for vector store / RAG | Gemini `gemini-embedding-001` (3072-dim) if key set, else Ollama (L35-54) |
| `output-generator.ts` | `OutputGeneratorService.generate()` (L55) | Templated documents incl. **handover prompt** | Gemini direct (`transcription.geminiModel`, L190-197) else Ollama (L198-207) |

`chat-llm.ts` reads the key from `getConfig().transcription.geminiApiKey` (L37) — the **same** key as
transcription. `embeddings.ts` and `output-generator.ts` do likewise. This is the key fact for
back-compat: **one Gemini key drives all cloud LLM work today.**

### A.2 Direct Gemini call sites (bypass even the routers)

| Service | Symbol | Task | API used |
|---|---|---|---|
| `transcription.ts` | `transcribeWithGemini()` (L759) | Audio → transcript | `GoogleAIFileManager` (Files API upload, L765-774) + `generateContent` — native audio |
| `transcription.ts` | `analyzeTranscriptWithGemini()` (L1062) | Transcript → summary/analysis JSON | `getGenerativeModel` (L1078) + `generateContent` (L1183) |
| `transcription.ts` | `detectActionables()` (L630) | Transcript → action items | `generateContent` (L686-690) |
| `transcription.ts` | `reanalyzeFailedTranscripts()` (L1426) | Re-run analysis on failures | Gemini (key check L1428) |
| `artifact-types.ts` | (extractor, L214-216) | Artifact extraction | `new GoogleGenerativeAI` + `generateContent` |

Local (non-cloud) transcription alternatives already exist and are selected by
`config.transcription.provider`: `transcribeWithLocalAsr()` (L838, mcp-asr) and
`transcribeWithVibeVoice()` (L942). These are important: **audio transcription already has a
provider switch** — the brain abstraction generalizes it.

### A.3 Consumers of the routers (no direct provider knowledge)

- `rag.ts` → `getChatLLMService()` in `chat()` (L347), `summarizeMeeting()` (L403),
  `findActionItems()` (L437); `getEmbeddingsService()` in `chat()` (L222). Retrieval→generate flow;
  also grounds with `knowledge-graph-service` facts (L314).
- `vector-store.ts` → `getEmbeddingsService()` (indexing).
- `self-identification.ts` → `getChatLLMService().generate()` (L467) — speaker/self identification.
- `transcript-upgrade.ts` → `getChatLLMService()` (L346) — transcript improvement.

Services that do **not** call an LLM directly (they compose already-stored transcripts/analysis):
`meeting-wiki.ts`, `timeline-analysis.ts`, `transcript-triage-core.ts`, `entity-resolver.ts`,
`identity-discovery.ts`, `re-diarize.ts`, `quality-assessment.ts`. These need no change.

### A.4 The current handover (H9 today)

Path: `electron/main/ipc/outputs-handlers.ts` + `services/output-templates.ts`.

1. Template `claude_code_prompt` (`output-templates.ts` L119-166) produces a structured markdown
   handoff prompt (classify call → context → objective → facts → decisions → action items → first
   steps). Generated by `output-generator.generate()` (Gemini/Ollama).
2. `outputs:generate` (L229) auto-exports the result to
   `<transcripts>/outputs/<date>-<templateId>-<slug>.md` via `exportOutputToFile()` (L36).
3. `outputs:copyToClipboard` (L304) → `clipboard.writeText`.
4. `outputs:launchClaudeCode` (L448): resolves a `cwd`
   (`resolveProjectFolderForActionable()` L67 → `integrations.handoffDirectory` → ask renderer),
   verifies `claude` is on PATH (`findClaudeCli()` L109), then `launchClaudeTerminal()` (L131) spawns
   an **external terminal** (`wt.exe` / `cmd /k` / `osascript` / `x-terminal-emulator`) running
   `claude "<prompt that says: read the handoff file>"`.

Renderer surface (`electron/preload/index.ts` L1386-1393): `outputs.getTemplates/generate/
getByActionableId/copyToClipboard/saveToFile/openInFolder/launchClaudeCode`.

**Gaps:** the agent gets a terse "read this file" prompt in a terminal we can't observe; no bundling
of transcript/summary/context; only Claude Code (no Codex); no in-app run/streaming; a single
`integrations.handoffDirectory` string is the only memory.

### A.5 Config + secret storage (today)

`services/config.ts` — `AppConfig` (L24-84), persisted to `<userData>/config.json` via `saveConfig()`
(L229). Relevant sections:

- `transcription.geminiApiKey` (**plaintext**), `transcription.geminiModel`,
  `transcription.provider: 'gemini' | 'local-asr' | 'vibevoice'` (L38-53).
- `chat.provider: 'gemini' | 'ollama'`, `chat.geminiModel`, `chat.ollamaModel` (L61-66).
- `embeddings.provider: 'ollama'`, `embeddings.ollamaBaseUrl/ollamaModel` (L54-60).
- `integrations.handoffDirectory` (L71-75).

**Secret encryption:** only `calendar.icsUrl` is encrypted at rest (`encryptSensitive`/`safeStorage`,
L6-22, CS-007). **`geminiApiKey` is stored in plaintext today.** The app already has a clean
OS-keychain-backed secret store: `services/connectors/connector-store.ts`
(`ConnectorStore.getSecret/setSecret`, `__enc__` prefix + `safeStorage`, L28-140) — the template for
per-brain credentials.

Config IPC (`ipc/config-handlers.ts`, exposed in preload L1112-1117):
`config:get`, `config:set`, `config:update-section`, `config:get-value`, `config:listGeminiModels`.
Live model discovery: `services/gemini-models.ts` `listGeminiTranscriptionModels()`.

### A.6 Settings surface

`src/pages/Settings.tsx` — a single scrolling page of `<Card>`s: **Assistant** (L574), **Calendar**
(L670), **Transcription** (L765, holds the Gemini API key input L812 + live model picker L852),
**Chat / RAG** (L998, `chatProvider` gemini|ollama L1003), **Storage** (L1091), **Capture** (L1174),
**Developer** (L1203). Sub-components in `src/components/settings/*` (e.g. `ConnectorsSettings.tsx`).
This is exactly where a new **"AI Brains"** card slots in, and where the Transcription / Chat cards
gain a per-task brain selector.

### A.7 Installed SDK/CLI reality on this machine (verified 2026-07-11)

| Vendor | npm package (npm view) | CLI installed | Auth present |
|---|---|---|---|
| Anthropic | `@anthropic-ai/claude-agent-sdk` **0.3.207**; CLI `@anthropic-ai/claude-code` 2.1.207 | `claude` **2.1.205** | Claude Code login active |
| OpenAI | `@openai/codex-sdk` **0.144.1** (wraps `@openai/codex` CLI 0.144.1) | `codex` **0.144.1** | ChatGPT login active; companion at `~/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs` |
| Google | `@google/gemini-cli` **0.50.0** (+ `@google/gemini-cli-core` 0.50.0) | `gemini` **0.49.0** | `GEMINI_API_KEY` or OAuth login |

---

## B. Brain provider abstraction (H10)

### B.1 Where it lives

New folder **`electron/main/services/brains/`** (main process only — renderer never touches SDKs):

```
brains/
  types.ts               # AIBrain interface + shared types (below)
  brain-router.ts        # BrainRouter: task → brain, with capability fallback
  brain-registry.ts      # instantiates + caches enabled brains, exposes auth status
  brain-credential-store.ts  # safeStorage-backed per-brain secrets (mirrors ConnectorStore)
  gemini-api-brain.ts    # wraps @google/generative-ai (current path)
  ollama-brain.ts        # wraps existing OllamaService
  claude-code-brain.ts   # @anthropic-ai/claude-agent-sdk   (Phase 2)
  codex-brain.ts         # @openai/codex-sdk                (Phase 3)
  gemini-cli-brain.ts    # @google/gemini-cli via child_process (Phase 4)
  __tests__/…
```

### B.2 The interface (`brains/types.ts`)

```typescript
export type BrainId =
  | 'gemini-api'   // @google/generative-ai (current)
  | 'ollama'       // local (current fallback)
  | 'claude-code'  // @anthropic-ai/claude-agent-sdk
  | 'codex'        // @openai/codex-sdk
  | 'gemini-cli'   // @google/gemini-cli

export type BrainCapability =
  | 'generate'      // one-shot text generation
  | 'chat'          // multi-turn conversation
  | 'analyzeAudio'  // native audio input → text (transcription/analysis)
  | 'embed'         // text → vector
  | 'agentic'       // run a coding task in a working directory (write files)

export interface BrainMessage { role: 'system' | 'user' | 'assistant'; content: string }

export interface GenerateOptions {
  systemPrompt?: string
  temperature?: number
  maxTokens?: number
  model?: string          // brain-specific model override
  json?: boolean          // ask for JSON output where the brain supports it
  signal?: AbortSignal
}

export interface AudioAnalyzeInput {
  filePath: string        // local audio file on disk
  mimeType: string        // e.g. 'audio/mp3' (HiDock .wav are MP3 content — see memory)
  prompt: string
  systemPrompt?: string
  model?: string
  signal?: AbortSignal
}

export interface AgenticTask {
  cwd: string             // working directory / target repo
  prompt: string          // instruction (the handoff)
  contextFiles?: string[] // absolute paths to attach / point the agent at
  model?: string
  signal?: AbortSignal
  onEvent?: (e: BrainAgentEvent) => void  // streamed progress
}

export type BrainAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; detail?: string }
  | { type: 'file'; path: string; change: 'created' | 'edited' }
  | { type: 'done'; subtype: string }
  | { type: 'error'; message: string }

export interface AgenticResult {
  finalResponse: string
  sessionId?: string      // to resume the session later
  filesChanged?: string[]
}

export interface BrainAuthStatus {
  configured: boolean
  method: 'api-key' | 'cli-login' | 'oauth' | 'none'
  detail?: string         // "key set", "logged in", "claude not on PATH", …
}

export interface AIBrain {
  readonly id: BrainId
  readonly label: string
  capabilities(): ReadonlySet<BrainCapability>
  /** Cheap, cached; never throws. Drives Settings status + router availability. */
  authStatus(): Promise<BrainAuthStatus>

  generate(messages: BrainMessage[], opts?: GenerateOptions): Promise<string | null>
  chat(messages: BrainMessage[], opts?: GenerateOptions): Promise<string | null>
  analyzeAudio?(input: AudioAnalyzeInput): Promise<string | null>
  embed?(texts: string[]): Promise<(number[] | null)[]>
  runAgentic?(task: AgenticTask): Promise<AgenticResult>
}
```

`generate`/`chat`/`embed` intentionally return `null` on failure/cancel — matching the existing
`ChatLLMService.generate` and `EmbeddingsService.generateEmbeddings` contracts, so the router and its
consumers keep the same error semantics.

### B.3 How each provider implements it (verified SDK APIs)

**`gemini-api-brain.ts`** — lift the existing code, no new deps (`@google/generative-ai` already used):
- `generate/chat` → `genAI.getGenerativeModel({ model, systemInstruction }).generateContent(...)`
  (as in `chat-llm.ts` `geminiChat` L93 and `output-generator.ts` L191).
- `analyzeAudio` → `GoogleAIFileManager` upload + `generateContent` (as in `transcription.ts`
  `transcribeWithGemini` L759). **Only brain that does audio.**
- `embed` → `model.batchEmbedContents` with `gemini-embedding-001` (as in `embeddings.ts` L57).
- Capabilities: `{ generate, chat, analyzeAudio, embed }`. (No `agentic`.)
- Auth: `api-key` from credential store → falls back to `config.transcription.geminiApiKey`.

**`ollama-brain.ts`** — wrap the existing `OllamaService` (`services/ollama.ts`:
`chat`, `generate`, `generateEmbeddings`, `isAvailable`):
- Capabilities: `{ generate, chat, embed }`. Auth: `cli-login`/none; `configured` = `isAvailable()`.

**`claude-code-brain.ts`** — `@anthropic-ai/claude-agent-sdk` `query()` (async generator):
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk'
// generate/chat: text-only, no tools
for await (const m of query({
  prompt,
  options: { systemPrompt, model, allowedTools: [], settingSources: [], abortController }
})) {
  if (m.type === 'assistant') { /* collect text blocks */ }
  else if (m.type === 'result') { /* subtype = done/… */ }
}
// runAgentic: full Claude Code
query({ prompt, options: {
  cwd: task.cwd, permissionMode: 'acceptEdits',
  systemPrompt: { type: 'preset', preset: 'claude_code' },
  tools: { type: 'preset', preset: 'claude_code' },
  additionalDirectories: task.contextFiles?.map(dirname), abortController
}})
```
- Capabilities: `{ generate, chat, agentic }`. **No `analyzeAudio`, no `embed`.**
- Auth: uses the logged-in `claude` CLI session or `ANTHROPIC_API_KEY`; the SDK spawns the Claude Code
  executable. `authStatus` = CLI on PATH (`findClaudeCli()` already exists) **or** API key present.

**`codex-brain.ts`** — `@openai/codex-sdk` (`Codex` → `startThread` → `run`/`runStreamed`):
```typescript
import { Codex } from '@openai/codex-sdk'
const codex = new Codex({ /* apiKey? — defaults to ChatGPT CLI login */ })
const thread = codex.startThread({ model, workingDirectory: task.cwd, sandboxMode: 'workspace-write' })
const { events } = await thread.runStreamed(task.prompt)     // agentic
for await (const e of events) { /* item.completed / turn.completed → BrainAgentEvent */ }
// generate/chat: thread.run(prompt) in a read-only sandbox; take turn.finalResponse
```
- Capabilities: `{ generate, chat, agentic }`. **No `analyzeAudio`, no `embed`.**
- Structured JSON via `outputSchema` (SDK supports an output schema). Auth: ChatGPT login (active) or
  `OPENAI_API_KEY`; the SDK spawns the `codex` CLI. `authStatus` = `codex` on PATH + login probe.

**`gemini-cli-brain.ts`** — spawn `gemini` headless (no official programmatic SDK; the CLI is the API):
```typescript
// generate: `gemini -p "<prompt>" --model <m> --output-format json` → parse .response
// chat: stateless; emulate multi-turn by flattening history into the prompt
// agentic: `gemini -p "<task>"` inside cwd (has file tools); stream stdout lines → BrainAgentEvent
```
- Capabilities: `{ generate, chat, agentic }` (agentic is weaker/less controllable than Codex/Claude).
  **No `embed`** (CLI has no embed command) — embeddings still go to gemini-api/ollama.
- Auth: `GEMINI_API_KEY` env (reuse the app's Gemini key!) or Google OAuth login. Inject a spawner so
  tests stub stdout.

### B.4 Capability matrix

| Capability | gemini-api | ollama | claude-code | codex | gemini-cli |
|---|:--:|:--:|:--:|:--:|:--:|
| generate (text) | ✅ | ✅ | ✅ | ✅ | ✅ |
| chat (multi-turn) | ✅ | ✅ | ✅ | ✅ | ⚠️ emulated |
| analyzeAudio | ✅ **only** | ❌ | ❌ | ❌ | ❌ |
| embed | ✅ | ✅ | ❌ | ❌ | ❌ |
| agentic (write files in repo) | ❌ | ❌ | ✅✅ | ✅✅ | ✅ |

**Hard fallback rules (enforced by the router, not optional):**
- `analyzeAudio` → **only** `gemini-api` among cloud brains; if the default brain can't, route to
  gemini-api, else fall to the local ASR path already in `transcription.ts`
  (`transcribeWithLocalAsr`/`transcribeWithVibeVoice`). Audio is never sent to Claude/Codex.
- `embed` → `gemini-api` if a Gemini key exists, else `ollama`. Never Claude/Codex/gemini-cli.
- `agentic` (handover) → `claude-code` or `codex` (or `gemini-cli`); never a non-agentic brain.

---

## C. Routing + config

### C.1 BrainRouter

```typescript
// brain-router.ts
export type BrainTask =
  | 'transcribeAnalyze'  // audio → transcript + analysis (transcription.ts)
  | 'chat'               // RAG assistant (rag.ts via chat-llm)
  | 'outputs'            // templated documents (output-generator.ts)
  | 'handover'           // the coding-agent handoff (H9)
  | 'embed'              // vector embeddings
  | 'suggestions'        // titles / smart questions / actionable detection

export interface BrainRouter {
  /** Resolve the brain for a task: per-task override → global default → capability fallback. */
  resolve(task: BrainTask, need: BrainCapability): Promise<AIBrain>
  /** Convenience wrappers used by consumers (keep old signatures identical). */
  generate(task: BrainTask, messages: BrainMessage[], opts?: GenerateOptions): Promise<string | null>
  chat(task: BrainTask, messages: BrainMessage[], opts?: GenerateOptions): Promise<string | null>
  embed(texts: string[]): Promise<(number[] | null)[]>
  analyzeAudio(input: AudioAnalyzeInput): Promise<string | null>
}
```

**Resolution order for `resolve(task, need)`:**
1. `config.brains.taskRouting[task]` if set, enabled, and `authStatus().configured`, and it advertises
   `need`.
2. else `config.brains.defaultBrain` if it advertises `need` and is configured.
3. else the **capability fallback** for `need` (§B.4): `embed`→gemini-api|ollama;
   `analyzeAudio`→gemini-api (then local-ASR outside the router); `generate/chat`→gemini-api|ollama;
   `agentic`→claude-code|codex|gemini-cli (first configured).
4. else `null` → consumer surfaces the same "no backend available" message it does today.

This preserves today's behavior exactly when `brains` is unset: default resolves to `gemini-api`
(if a Gemini key exists) else `ollama` — identical to the current three routers.

### C.2 Config additions (`config.ts`)

```typescript
brains: {
  enabled: Record<BrainId, boolean>          // add-on toggles; default { 'gemini-api': true, ollama: true, … : false }
  defaultBrain: BrainId                       // default 'gemini-api'
  taskRouting: Partial<Record<BrainTask, BrainId>>  // per-task overrides; empty = use default
  // Non-secret per-brain prefs (models, endpoints). Secrets live in BrainCredentialStore.
  models: Partial<Record<BrainId, string>>
}
```

Defaults chosen so **nothing changes until the user opts in**: only `gemini-api` + `ollama` enabled,
`defaultBrain: 'gemini-api'`, `taskRouting: {}`.

### C.3 Secrets + auth per brain (`brain-credential-store.ts`)

Mirror `ConnectorStore` (§A.5) exactly — `safeStorage` with the `__enc__` prefix, stored in
`<userData>/brains.json` under a `_secrets` map:

```typescript
getSecret(brainId: BrainId, key: string): string | null
setSecret(brainId: BrainId, key: string, value: string | null): void
hasSecret(brainId: BrainId, key: string): boolean
```

Keys: `gemini-api` → `apiKey`; `codex` → optional `OPENAI_API_KEY`; `claude-code` → optional
`ANTHROPIC_API_KEY`; `gemini-cli` → optional `GEMINI_API_KEY` (defaults to the gemini-api key). Claude
Code / Codex primarily use their **CLI login sessions**, so a key is optional for them.

### C.4 Back-compat / migration (must keep the Gemini path working)

1. **Read-through:** `GeminiApiBrain` resolves its key as
   `credentialStore.getSecret('gemini-api','apiKey') ?? config.transcription.geminiApiKey`. The
   existing plaintext key keeps working with **no migration required**.
2. **One-time migration** (in `initializeConfig`, alongside `migrateRetiredGeminiModels`): if
   `transcription.geminiApiKey` is non-empty and no `gemini-api/apiKey` secret exists, copy it into
   the credential store (encrypted) and set `brains.enabled['gemini-api'] = true`. Leave the plaintext
   value in place for one release (belt-and-suspenders) — a later release can null it out. **This
   also fixes the standing "API key stored in plaintext" gap.**
3. Settings' existing Gemini key field (Transcription card) continues to write
   `transcription.geminiApiKey`; a small sync writes it to the credential store too.
4. `config.chat.provider` / `config.transcription.provider` remain authoritative for their existing UX;
   the router treats an unset `brains.taskRouting` as "defer to legacy provider fields", so both the
   old toggles and the new brain toggles coexist during transition.

---

## D. Settings UX (H10)

New **"AI Brains"** card at the top of `Settings.tsx` (above Transcription). The Transcription and
Chat/RAG cards each gain a compact "Brain" selector that writes `brains.taskRouting`.

```
┌─ AI Brains ─────────────────────────────────────────────────────────────┐
│ Toggle a brain to use it for the app's AI work. Default brain handles     │
│ anything without a per-task override.                                      │
│                                                                            │
│  Brain            Status                        Enabled   Default          │
│  ───────────────  ────────────────────────────  ───────   ───────          │
│  Gemini (API key)  ● Key set                      [ ✔ ]     ( • )           │
│  Ollama (local)    ● Running · llama3.2           [ ✔ ]     (   )           │
│  Claude Code SDK   ● Logged in (claude 2.1.205)   [ ✔ ]     (   )   [Test]  │
│  Codex SDK         ● ChatGPT login (codex 0.144)  [   ]     (   )   [Test]  │
│  Gemini CLI        ○ Not authenticated            [   ]     (   )   [Sign in]│
│                                                                            │
│  Per-task routing (optional — blank = use default brain)                   │
│   Transcription & analysis  [ Gemini (API) ▼ ]  (audio needs Gemini/local) │
│   Assistant chat / RAG      [ Default       ▼ ]                             │
│   Document outputs          [ Default       ▼ ]                             │
│   Coding handover           [ Claude Code   ▼ ]                             │
│   Embeddings                [ Gemini (API)  ▼ ]  (Gemini or Ollama only)    │
│   Titles & suggestions      [ Default       ▼ ]                             │
│                                                                            │
│  ▸ Advanced: API keys (optional — Claude/Codex use their CLI login)        │
│      Anthropic API key  [ •••••••••• ]   OpenAI API key [ •••••••••• ]      │
└────────────────────────────────────────────────────────────────────────────┘
```

Behavior:
- Each row's **Status** dot comes from `brain.authStatus()` (green configured / amber degraded /
  grey none). `[Test]` runs a 1-token probe (`generate('ping')`) and shows latency/error.
- **Enabled** = add-on toggle (writes `brains.enabled`). Disabling a brain that's a task's route
  reverts that task to Default (with an inline warning).
- **Default** = radio → `brains.defaultBrain`. Only capability-valid options are selectable per task
  dropdown (audio-only tasks hide brains lacking `analyzeAudio`, etc.).
- The per-task dropdowns only list brains whose `capabilities()` include the task's need; disabled or
  unauthenticated brains appear greyed with a reason tooltip.

Renderer wiring: new `window.electronAPI.brains.*` (list, setEnabled, setDefault, setRouting,
setSecret, testBrain) → `ipc/brains-handlers.ts`. Follows the 3-file IPC pattern in
`.claude/rules/electron-ipc.md`.

---

## E. Handover redesign (H9) — "built properly"

### E.1 What "proper" produces

Replace the "one markdown file + external terminal" flow with a **handover bundle** written into the
target repo, plus an **in-app agentic run**.

**Bundle** written to `<repo>/.hidock-handoff/<date>-<slug>/` (repo resolved by the existing
`resolveProjectFolderForActionable()`; if none, ask the renderer for a folder as today):

```
.hidock-handoff/2026-07-11-acme-sdd/
  HANDOFF.md            # the generated handoff prompt (claude_code_prompt template, brain-generated)
  context/
    transcript.md       # full transcript (from transcripts table)
    summary.md          # analysis summary + decisions
    action-items.md     # extracted actionables
    meeting.json        # { subject, date, attendees, projectId, recordingIds }
  README.md             # "This folder was generated by HiDock Next. Start with HANDOFF.md."
```

`HANDOFF.md` is generated by the **handover brain** (routing task `handover`) — Claude Code / Codex /
Gemini, not necessarily Gemini-API — using the existing `claude_code_prompt` template as the meta-prompt.

### E.2 What "proper" does — step by step

New `services/handover-service.ts` + additions to `outputs-handlers.ts`:

1. **Assemble** the bundle (above) — pure filesystem + DB reads, fully unit-testable.
2. **Generate** `HANDOFF.md` via `brainRouter.generate('handover', …)`.
3. **Run** — two user-chosen modes:
   - **In-app agentic run (the new default).** `brain.runAgentic({ cwd: repo, prompt: "Read
     HANDOFF.md and the context/ folder, then carry out the work.", contextFiles: [HANDOFF.md, …] })`.
     Events stream via `event-bus.ts` → renderer **Handover panel** (live text, tool calls, files
     changed). Uses Claude Code SDK or Codex SDK per routing. No external terminal, observable, cancellable
     (`AbortSignal`).
   - **External terminal (kept).** The existing `launchClaudeTerminal()` path for users who prefer
     their own terminal — now points the terminal at the **bundle folder** instead of a lone file.
   - **Clipboard/file (kept).** `copyToClipboard` / `openInFolder` remain for manual paste.
4. **Record** the run: store bundle path + `sessionId` + `filesChanged` on the actionable/output row
   so the panel can show "resume session" and "open changed files".

### E.3 Renderer

A **Handover panel** (new component under `src/features/…` or `src/components/`) launched from the
Actionables / output CTA. Shows: bundle contents preview, brain selector (defaults to `handover`
routing), a Run button, and a live event log. Reuses the streaming pattern already used elsewhere
(event-bus push events). Existing `Actionables.tsx` "Open in Claude Code" button becomes "Hand
off →" opening this panel.

---

## F. Build plan (phased, ownership-scoped)

Sequenced so adapters are disjoint files (parallelizable) and shared files
(`config.ts`, `preload/index.ts`, `ipc/handlers.ts`, `Settings.tsx`) are each owned by **one** phase.
Follows `.claude/rules/agent-dispatch.md` (one agent per file-set).

**Phase 1 — Abstraction + current providers (the seam). Do first, alone.**
- Files owned: `brains/types.ts`, `brains/brain-router.ts`, `brains/brain-registry.ts`,
  `brains/brain-credential-store.ts`, `brains/gemini-api-brain.ts`, `brains/ollama-brain.ts`,
  `brains/__tests__/*`; edit `config.ts` (add `brains` section + migration), and refactor
  `chat-llm.ts`, `embeddings.ts`, `output-generator.ts` to delegate to the router.
- Also refactor `transcription.ts` audio + analysis + `detectActionables` and `artifact-types.ts` to
  call `brainRouter` (still resolving to `gemini-api` by default → no behavior change).
- Gate: **zero behavior change**; all existing `chat-llm`, `embeddings`, `output-generator`,
  `transcription`, `rag` tests green. This de-duplicates the three routers.

**Phases 2–4 — Adapters (parallelizable after Phase 1; each is one new file + one dep).**
- P2 `brains/claude-code-brain.ts` + dep `@anthropic-ai/claude-agent-sdk`.
- P3 `brains/codex-brain.ts` + dep `@openai/codex-sdk`.
- P4 `brains/gemini-cli-brain.ts` (spawns `gemini`; inject a spawner for tests; no runtime dep).
- Each registers itself in `brain-registry.ts` via a small registration array (append-only, so the
  three don't collide — or the orchestrator merges the registry edits).

**Phase 5 — Settings + IPC (owns the shared UI/IPC files).**
- Files owned: `ipc/brains-handlers.ts` (new), edit `ipc/handlers.ts` (register), edit
  `preload/index.ts` (`brains.*`), edit `Settings.tsx` (AI Brains card + per-task selectors),
  new `src/components/settings/BrainsSettings.tsx`.

**Phase 6 — Handover redesign (H9).**
- Files owned: `services/handover-service.ts` (new), edit `ipc/outputs-handlers.ts`
  (bundle + in-app run + resume), edit `preload/index.ts` outputs section, new Handover panel
  component + edit `Actionables.tsx` CTA. Depends on Phases 1–2 (needs an agentic brain).

### F.1 Test strategy

- **Every adapter is behind `AIBrain`** → unit-test with the interface mocked; no real
  CLI/network/hardware. Router tests assert task→brain resolution + capability fallback
  (audio→gemini-api/local; embed→gemini-api/ollama; agentic→claude/codex).
- **CLI-spawning brains** (`gemini-cli`, and the SDKs that spawn `claude`/`codex`) take an injected
  `spawn`/exec dependency so tests feed canned stdout/JSONL and assert argument construction — no
  child process in CI.
- **Handover** bundle assembly is pure FS/DB → snapshot-test the folder contents; the agentic run is
  tested against a mock brain that emits scripted `BrainAgentEvent`s.
- **Back-compat**: keep the existing suites for `chat-llm`/`embeddings`/`output-generator`/
  `transcription` unchanged and green (they exercise the Gemini-first/Ollama behavior the router must
  preserve). A schema/config test asserts the `brains` defaults + migration copy-through.

### F.2 Risks & caveats

- **Auth model differs per brain.** Gemini-API uses an API key (already have one). Claude Code, Codex,
  and Gemini CLI primarily use **CLI login sessions** (subscription auth), not keys — so "configured"
  means "CLI present + logged in", probed via a cheap call. Surface this clearly in Settings; never
  block the app if a brain isn't authed (fall back).
- **The AWS-Bedrock channel-account caveat does NOT apply here.** These brains call the vendors'
  own hosted endpoints (Anthropic / OpenAI / Google) through their CLIs/SDKs, not Bedrock. No
  cross-account routing needed. (Noted only to pre-empt the standing global rule.)
- **Missing capabilities are load-bearing.** Audio transcription and embeddings must *never* route to
  Claude/Codex — the router enforces this; a mis-set `taskRouting` for audio silently falls back to
  gemini-api/local-ASR rather than failing.
- **Child-process brains** add latency and depend on external binaries; keep agentic brains **opt-in
  per task**, cancellable, and time-boxed. The Codex SDK and Claude Agent SDK both spawn their CLIs —
  ship a clear "install/login" message when absent (reuse `findClaudeCli()` pattern).
- **USB safety unaffected** — this is all main-process LLM plumbing, no device code.

---

## G. Recommended Phase-1 slice (start here)

Ship **only** the abstraction over the *current* providers:

1. `brains/types.ts` + `brain-router.ts` + `brain-registry.ts` + `brain-credential-store.ts`.
2. `gemini-api-brain.ts` (audio + generate + embed) and `ollama-brain.ts` (generate + embed) by
   lifting existing code.
3. `config.ts`: add the `brains` section (defaults = current behavior) + the one-time
   `geminiApiKey → credential store` migration (also closes the plaintext-key gap).
4. Refactor `chat-llm.ts`, `embeddings.ts`, `output-generator.ts`, and the `transcription.ts` /
   `artifact-types.ts` direct calls to go through `brainRouter` — **behavior identical**, all tests
   green.

This collapses three copies of "Gemini-first/Ollama-fallback" into one router, closes the plaintext
API-key gap, and leaves a single seam where Claude Code, Codex, and Gemini CLI plug in (Phases 2–4)
and where the proper handover runs its agent (Phase 6).
