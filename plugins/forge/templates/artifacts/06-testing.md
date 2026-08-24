<!--
  Testing template (phase 6). FIXED clarify question: which test categories to generate
  (e.g. Functional, Smoke, Regression, Performance; optionally Security, Accessibility, E2E) —
  present the set with a recommendation. Then generate ONE test case per (Work Order × selected
  category). Every case traces to its Work Order via "- User Story: WO-NNN". Derive Functional/
  Regression steps from the Work Order's acceptance criteria; Smoke = deploy/execute/verify;
  Performance = identify-path/benchmark/compare. {{...}} placeholders are filled by forge.
-->
# Testing

**Status:** {{status}}

**Artifact:** {{artifact_uuid}}

**Selected Categories:** <e.g. Functional test cases, Smoke test suite, Regression test suite, Performance test scenarios>

**Total Test Cases:** {{total}}

---

## <Category name> (<count>)

### <CATEGORY>-001 — <Work Order title>

- User Story: WO-001
- Objective: <what this case validates for that Work Order>
- Expected: <expected outcome / pass condition>

**Steps**
- <step 1 — for Functional/Regression, each step checks one acceptance criterion of the Work Order>
- <step 2>
- <step 3>

<!-- Repeat ### per (Work Order × category), numbered within the category; new ## per category. -->

## Confidence

Overall: **{{confidence}}%**

> <one-line assessment incl. whether every Work Order is covered across the selected categories>

| Section | Score | Why | How to Improve |
| --- | --- | --- | --- |
| Work Order coverage | <n>% | <does every WO have cases in each selected category?> | <uncovered WOs> |
| AC-to-test fidelity | <n>% | <do Functional/Regression steps mirror the WО acceptance criteria?> | <gaps> |
| Category completeness | <n>% | <were all selected categories generated?> | <missing categories> |

---

**Changelog** ({{iso_timestamp}}): Testing: <n> section(s) changed.

- **Created:** initial test catalog for <project>
