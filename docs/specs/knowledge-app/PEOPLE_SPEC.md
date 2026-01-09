# People Specification (Knowledge App)

**Route:** `/people`
**Related Numbered Spec:** [04_PEOPLE.md](../04_PEOPLE.md)
**References:** [11_CONCEPTUAL_FRAMEWORK.md](../11_CONCEPTUAL_FRAMEWORK.md)

---

## 1. Purpose

People is the canonical UI for the **Person entity**. It aggregates speakers, attendees, and mentions derived from Sources into a stable identity record.

### Vision alignment (do not mirror the current UI)
- People is about *identity and navigation*: a person page should answer “who is this” and “where did they appear” with deep-links to evidence.
- Keep identity stable even if extraction improves over time (merge/split should not break links).
- Any surfaced “facts” about a person should be attributable (derived from Sources or explicitly user-edited).

---

## 2. Scope

- List/search people.
- Open person detail view (`/person/:id`) that summarizes interactions and linked knowledge.
- Minimal manual edits (name normalization, merge duplicates) can be staged later.

---

## 3. Data contract (minimum)

```ts
interface Person {
  id: string;
  name: string;
  email?: string;
  company?: string;
  role?: string;
  type: 'team' | 'candidate' | 'customer' | 'external';
  interactionCount: number;
  lastSeenAt: string; // ISO
  tags: string[];
}
```

---

## 4. Implementation requirements

- People should be auto-populated from transcript processing + calendar attendees.
- Identity resolution must support merging duplicates (design later; store must support it).
- UI must use theme tokens only.

---

## 5. Acceptance criteria

- Search reliably finds people by name/email.
- Clicking a person shows linked knowledge captures and recent interactions.

## Appendix A: Migration pointers (non-normative)
- Current route implementation: `apps/electron/src/pages/People.tsx`.
