<!--
  UI Design template (phase 4). FIXED clarify question: choose the UI framework — present 3
  options (e.g. Material Design, Fluent UI, Carbon/Ant/etc.) with a recommendation derived from
  the spec. Then, for each key screen (derive from the approved PRD's P0 stories), author a
  self-contained HTML+inline-CSS prototype in the chosen framework's visual language under
  forge/artifacts/ui/<key>.html, screenshot it via screenshot.mjs at a device viewport to
  forge/artifacts/ui/screen-<key>.png, and embed it here via ![Screen name](screen-<key>.png).
  On publish, forge uploads those PNGs as page attachments (the image refs resolve to them).
  Stay consistent with the PRD (cover P0 screens) and Architecture (responsive PWA).
  {{...}} placeholders are filled by forge.
-->
# UI Design

**Status:** {{status}}

**Artifact:** {{artifact_uuid}}

## Design Framework

**Chosen framework:** <Material Design | Fluent UI | ...> — <one-line rationale tied to the product/users/spec>.

**Design tokens (summary):** colors <...>, typography <...>, spacing/density <...>, primary/secondary/status colors <...>. **Target:** mobile-first responsive PWA (per Architecture).

## Layouts

<One subsection per key screen. Derive the screen list from the PRD's P0 user stories
(e.g. OTP sign-in, vehicle registration, document upload, status/QR, admin review). Each screen
embeds its screenshot and describes purpose, key elements, and states.>

### <Screen name>

![<Screen name>](screen-<key>.png)

- **Purpose:** <what the user does here>
- **Key elements:** <primary controls/fields/actions>
- **States & validation:** <empty/loading/error/success; validation messages>

## Accessibility & Responsiveness

- **Accessibility:** <WCAG 2.2 AA notes — labels, focus order, contrast, error announcement>.
- **Responsiveness:** <breakpoints for mobile/tablet/desktop; what reflows>.

## Confidence

Overall: **{{confidence}}%**

> <one-line assessment, incl. how well the screens cover the PRD's P0 stories>

| Section | Score | Why | How to Improve |
| --- | --- | --- | --- |
| PRD story coverage | <n>% | <do the screens cover all P0 stories?> | <missing screens> |
| Framework fit | <n>% | <why this framework fits the spec> | <open points> |
| Accessibility | <n>% | <WCAG considerations addressed?> | <gaps> |
| Structural completeness | <n>% | <all key screens designed?> | <how> |

---

**Changelog** ({{iso_timestamp}}): UI Design: <n> section(s) changed.

- **Created:** initial UI Design for <project>
