<!--
  User Stories (Work Orders) template (phase 5). Decompose the APPROVED PRD user stories +
  Architecture components/modules into fine-grained, buildable Work Orders. Group by epic
  (## section). Each story: ### WO-NNN — [Pn] Title, a description, a field table, Acceptance
  Criteria (Given/When/Then + the 3 standard DoD lines), and Depends on. Assign explicit
  sequential WO IDs (never reuse; /forge:revise only APPENDS). Labels MUST include
  epic:EPIC-NNN so forge creates the JIRA epic and links stories to it. At finalize these
  become JIRA epics + stories (via stories.mjs). {{...}} placeholders are filled by forge.
-->
# User Stories

**Status:** {{status}}

**Artifact:** {{artifact_uuid}}

## <Epic name, e.g. Identity, Access & Segregation>

### WO-001 — [P0] <Story title>

<One-paragraph description of scope and intent, grounded in the PRD and Architecture.>

| Field | Value |
|---|---|
| Story Points | 5 |
| Hours | 50h |
| Priority | P0 |
| Labels | epic:EPIC-001, module:<module>, complexity:<low\|medium\|high> |

**Acceptance Criteria**
- Given <context>, When <action>, Then <outcome>.
- Unit tests written and passing: <coverage focus>.
- System integration tests written and passing: <boundary(ies) validated>.
- Mock data and fixtures generated and committed: <fixtures>.

**Depends on:** <none \| WO-000, WO-000>

<!-- Repeat ### WO-NNN per story; start a new ## per epic. -->

## Confidence

Overall: **{{confidence}}%**

> <one-line assessment incl. how fully these Work Orders cover the PRD's P0 stories and the Architecture's modules>

| Section | Score | Why | How to Improve |
| --- | --- | --- | --- |
| PRD coverage | <n>% | <is every P0 story decomposed into WOs?> | <gaps> |
| Architecture coverage | <n>% | <does each module/component have WOs?> | <gaps> |
| Story quality (AC + DoD) | <n>% | <AC testable; 3 DoD lines present?> | <gaps> |
| Dependency integrity | <n>% | <do Depends-on refs form a valid build order?> | <cycles/missing> |

---

**Changelog** ({{iso_timestamp}}): User Stories: <n> section(s) changed.

- **Created:** initial Work Orders for <project>
