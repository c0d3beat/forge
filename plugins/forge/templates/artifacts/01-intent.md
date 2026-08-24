<!--
  Intent template (phase 1). The /forge:init skill fills this in with the user, then writes
  the result to forge/artifacts/01-intent.md. Keep the section set and the header/Confidence/
  Changelog blocks. Replace <angle-bracket guidance> with real content. Do NOT invent a tech
  stack or scope — clarify anything uncertain with the user (recommended options), never assume.
  {{artifact_uuid}} is supplied by forge (state.json); {{confidence}} is your self-assessment.
-->
# Intent profile

**Status:** {{status}}

**Artifact:** {{artifact_uuid}}

## Vision

<One to three short paragraphs: what the product is, who it serves, the core problem it solves,
and the measurable business outcome(s). Concrete and specific to this project.>

## Target personas

- <Persona — their role and primary goal>
- <Persona — ...>

## Core features

<Prioritised, most-important first. Each is a bold capability + a (priority N) suffix.>

- **<Capability>** (priority 1)
- **<Capability>** (priority 2)
- **<Capability>** (priority 3)

## Technical constraints

<Hosting, runtime/stack, data platform, identity, scale, availability, compliance, integrations.
CLARIFY the tech stack and constraints with the user — do not assume. If the user defers, record
the chosen option and that it was a recommendation, not an assumption.>

- <Constraint>
- <Constraint>

## Confidence

Overall: **{{confidence}}%**

> <One-line overall assessment of how complete/aligned this Intent is.>

| Section | Score | Why | How to Improve |
| --- | --- | --- | --- |
| Vision | <n>% | <why> | <what would raise it> |
| Target personas | <n>% | <why> | <what would raise it> |
| Core features | <n>% | <why> | <what would raise it> |
| Technical constraints | <n>% | <why> | <what would raise it> |

---

**Changelog** ({{iso_timestamp}}): Intent profile: <n> section(s) changed.

- **Created:** initial Intent profile
