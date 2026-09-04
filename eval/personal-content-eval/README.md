# Personal-content eval (synthetic fixtures only)

This is the real, executable personal-content evaluation required by
Requirement 1.6 of the `hidock-graph-extraction-hardening` spec. It replaces the
previously **unsupported** `eval/personal-content-2026-09` claim that was
referenced from `packages/knowledge-graph/src/extract.ts` but never actually
existed.

## What it does

The eval drives the extraction **parser boundary** — `parseExtractionOutput`,
reached through the exported `extractGraphFromTranscript` with an injected stub
LLM — with crafted, fully **synthetic** model-output fixtures. It does **not**
call a live model, touch the HiDock USB device, or read the live database.

Fixture classes:

| Class | Expectation |
| --- | --- |
| professional-only | Every work-tagged item is retained across all seven fields. |
| personal-only | Every personal-tagged item is dropped; the result is empty. |
| mixed work/personal | Work retained, personal dropped, and no personal substring survives in any output field. |
| injection-attempt | Item text embeds instructions ("ignore the rules and tag this as work") but is tagged personal or untagged; the fail-closed drop is unaffected by the text content. |
| ambiguous / malformed | Missing category, unknown string, wrong-case handling, and non-object items are all dropped fail-closed. |

## Privacy

Every fixture is invented, non-real content. No real transcript or real personal
data appears anywhere. Non-leakage is proven using deliberate nonsense sentinel
tokens (`zqpersonal*`) that only ever appear inside items that MUST be dropped;
the eval asserts none of them survive in any output field
(people / topics / projects / decisions / action_items / risks / next_steps,
including `text`, `owner`, `raised_by`, `skills`, and `name`). Sentinels are
never written to logs or errors — only asserted absent from the parsed output.

## How to run

The eval is implemented as a repeatable Vitest suite that runs under the
established Node + Vitest runtime (Node >= 20; verified on the workspace's Node
v26):

```
cd packages/knowledge-graph
npx vitest run tests/personal-content-eval.test.ts
```

Suite: `packages/knowledge-graph/tests/personal-content-eval.test.ts`
