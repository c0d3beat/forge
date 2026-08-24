<!--
  RTM template (phase 7) — the traceability consolidation, ASSEMBLED from the approved artifact
  chain (no new elicited content). Each row is an Intent core feature (REQ-NNN, in Intent priority
  order). Trace each feature to the PRD sections that specify it, the Architecture components that
  implement it, and the Work Orders (WO-NNN) that build it. Verify every Intent feature has ≥1
  covering Work Order and maps to architecture; flag gaps in Confidence. {{...}} filled by forge.
-->
# Requirements Traceability Matrix

**Status:** {{status}}

**Artifact:** {{artifact_uuid}}

| Req ID | Feature | PRD Sections | Arch Components | User Stories | Status | Priority |
|---|---|---|---|---|---|---|
| REQ-001 | [P1] <Intent core feature 1> | <PRD sections covering it> | <Architecture components/modules> | <WO-001, WO-00N> | draft | P0 |
| REQ-002 | [P2] <Intent core feature 2> | <...> | <...> | <WO-...> | draft | P0 |
| REQ-NNN | [Pn] <Intent core feature N> | <...> | <...> | <WO-...> | draft | <P0/P1> |

## Confidence

Overall: **{{confidence}}%**

> <one-line assessment: every Intent feature is traced to PRD sections, Architecture components, and at least one Work Order; call out any uncovered feature>

| Section | Score | Why | How to Improve |
| --- | --- | --- | --- |
| Feature → stories coverage | <n>% | <does every REQ map to ≥1 Work Order?> | <uncovered features> |
| Feature → architecture coverage | <n>% | <does every REQ map to components?> | <gaps> |
| Completeness | <n>% | <are all Intent core features present as REQ rows?> | <missing features> |

---

**Changelog** ({{iso_timestamp}}): RTM: <n> row(s) changed.

- **Created:** initial RTM for <project>
