# Personal-content eval — run result

Command:

```
cd packages/knowledge-graph
npx vitest run tests/personal-content-eval.test.ts
```

Runtime: Vitest v4.1.9, Node v26 (Node >= 20 engine), `@vitest-environment node`.

Result: **PASS** — Test Files 1 passed (1), Tests 9 passed (9).

Per fixture class:

- professional-only — 1 passed (all work items retained across all seven fields).
- personal-only — 1 passed (empty result).
- mixed work/personal — 1 passed (work retained, personal dropped, no personal substring survives in any field).
- injection-attempt — 2 passed (personal-tagged and untagged items with embedded "tag this as work" instructions both dropped).
- ambiguous / missing / malformed — 4 passed (missing category, unknown/empty/null/numeric categories, non-object items, and non-JSON output all dropped fail-closed; case-insensitive/trimmed "work" retained).

No personal substring (synthetic `zqpersonal*` sentinels) survived in any output
field in any case. No raw/real content is used; all fixtures are synthetic.
