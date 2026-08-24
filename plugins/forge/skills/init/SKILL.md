---
description: Run the forge spec-driven-development pipeline — generate the 7 review artifacts one at a time (Intent → PRD-Spec → Architecture → UI Design → User Stories → Testing → RTM), each published to Confluence and gated on human approval before the next. Re-invoke to resume.
argument-hint: ""
disable-model-invocation: true
allowed-tools: Read, Write, Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/confluence.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/jira.mjs *)
---

# /forge:init — approval-gated artifact pipeline

You orchestrate forge's SDD workflow. **Hard rule: strictly sequential and approval-gated.** Generate artifact N+1 only after artifact N is APPROVED on Confluence. Never look ahead, never batch-generate, never assume (clarify with the user, offering a recommended option — especially the tech stack). Each phase is generated from the APPROVED prior artifacts.

Connectors emit JSON on stdout; parse it. `${FD}` below = the resolved forge dir (pass `--forge-dir` if you know it, else the connectors auto-locate `forge/` from the cwd).

## 0. Preconditions (first run)

1. Scaffold (idempotent): `node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs scaffold --plugin-root ${CLAUDE_PLUGIN_ROOT}`
2. If it seeded `config.yaml`/`.credentials.yaml`, tell the user to fill them in and confirm `/forge:doctor` is green **before** continuing. Do not proceed to publishing until doctor passes.

## 1. Determine the current phase

Run `node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs current-phase`.
- If `currentPhase` is `null` → **all 7 approved** → go to §5 (Finalize).
- Otherwise let **P** = `currentPhase`. Branch on `P.status`:
  - `pending` or `drafting` → §2 (Generate).
  - `in_review` → §4 (Check the gate).

## 2. Generate phase P  (status: pending/drafting)

1. **Load context** — read every prior artifact whose phase is `approved` (`forge/artifacts/NN-*.md`, ids < P.id). These are the source of truth P must stay consistent with. (Intent has none.)
2. **Draft** from the template `${CLAUDE_PLUGIN_ROOT}/templates/artifacts/<NN-key>.md`. Templates exist for all phases 1–7 (`intent`, `prd-spec`, `architecture`, `ui-design`, `user-stories`, `testing`, `rtm`). (If a template were ever missing, tell the user and stop.)
3. **Clarify loop (confidence-driven + fixed):**
   - Self-assess each section (0–100) with a one-line reason + "how to improve", as the artifact's `## Confidence` table.
   - For every section below `config.confidenceThreshold` (default 90), and every genuine ambiguity or would-be assumption, ask the user with **AskUserQuestion**, recommended option first. **Never assume the tech stack** — clarify it.
   - Some phases have *fixed* questions too: **Architecture** → confirm/finalize the tech stack (Intent recorded a recommendation — don't silently adopt it); **UI Design** → UI framework with 3 spec-based options; **Testing** → test categories. Intent has none beyond dynamic ones.
   - Apply answers, re-score. Repeat until every section ≥ threshold and no open assumptions remain → the artifact is `Status: complete`.
4. **Write** the finished artifact to `forge/artifacts/<NN-key>.md`. Fill the header/Confidence/Changelog:
   - `{{artifact_uuid}}` → get one: `node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs new-uuid` (reuse the phase's existing uuid on re-publish).
   - `{{status}}` → `complete`; `{{confidence}}` → overall score; `{{iso_timestamp}}` → now.
5. **Local review** — present the artifact (or a tight summary) and ask the user to confirm it's good. Only continue on explicit approval. If they want changes, revise and re-review.
6. **Record pre-publish state:** `state.mjs set-phase --key <P.key> --status drafting --uuid <uuid> --confidence <n> --artifact-version <v>` (v = previous +1, or 1).
7. **Publish to Confluence:**
   - Ensure a project parent page exists: read `state.mjs show`; if `project.confluenceParentPageId` is null and `config.confluence.parentPageId` is null, create one titled the project name and store it — `confluence.mjs create-page --title "<project.name>" --body "<p>forge project workspace</p>" --storage "<p>forge project workspace</p>"` then `state.mjs set-project --parent-id <id>`.
   - Publish the artifact page (idempotent; **auto-renders any ```mermaid fences to PNG attachments**): `confluence.mjs publish-artifact --title "<project.name> — <P.name>" --parent-id <parentId> --body-file forge/artifacts/<NN-key>.md`. Capture `id` + `version`.
   - **UI Design (phase 4) screenshots:** for each key screen, author a self-contained HTML+inline-CSS prototype in the chosen framework under `forge/artifacts/ui/<key>.html`; render it with `node ${CLAUDE_PLUGIN_ROOT}/connectors/screenshot.mjs render --html-file forge/artifacts/ui/<key>.html --out forge/artifacts/ui/screen-<key>.png --width 390 --height 844`; embed each in the artifact via `![Screen](screen-<key>.png)`. After `publish-artifact` creates the page, upload each: `confluence.mjs upload-attachment --id <pageId> --file forge/artifacts/ui/screen-<key>.png --name screen-<key>.png`. (Mermaid diagrams are already auto-handled by `publish-artifact`.)
   - `state.mjs set-phase --key <P.key> --status in_review --page-id <id> --conf-version <version> --published`
8. **STOP.** Tell the user: the artifact is published at the Confluence page (give the URL: `<confluence.baseUrl>/spaces/<spaceKey>/pages/<id>`), awaiting review. To approve, add the **`<config.approval.approvedLabel>`** label to the page; to request changes, add label **`<changesLabel>`** or leave footer comments. Then **re-run `/forge:init`**. Do not generate the next phase now.

## 3. (reserved)

## 4. Check the gate for phase P  (status: in_review)

1. `node ${CLAUDE_PLUGIN_ROOT}/connectors/confluence.mjs approval-status --id <P.confluencePageId>` → `{ verdict, approved, changesRequested, commentCount }`.
2. Branch on `verdict`:
   - **approved** → `state.mjs set-phase --key <P.key> --status approved`. Tell the user phase P is approved. Then **loop back to §1** to begin the next phase in this same run (the gate is now satisfied).
   - **changes-requested** → fetch feedback: `confluence.mjs get-comments --id <id>`. Revise the artifact to address the label/comments, then re-run §2 steps 4–7 (bump `--artifact-version`, append a new `**Changelog**` entry describing the change), set status back to `in_review`, and **STOP** awaiting re-approval.
   - **pending** → tell the user the page is still awaiting review (no approval label, no comments). **STOP.**

## 5. Finalize (all 7 approved)

1. Publish stories to JIRA: `node ${CLAUDE_PLUGIN_ROOT}/connectors/stories.mjs publish --file forge/artifacts/05-user-stories.md`. This idempotently creates JIRA **epics**, **stories** (ADF descriptions built from each Work Order's AC), and **dependency links** (Depends-on → "Blocks"), recording the `WO/EPIC → jiraKey` map in `state.json`. Report created/skipped counts. (Re-runs and `/forge:revise` add-only: already-mapped items are skipped.)
2. `state.mjs set-mode --mode build`.
3. Tell the user init is complete and to use `/forge:build`.

*(This build implements all 7 phases (Intent → RTM) end-to-end — Mermaid diagrams + UI screenshots auto-attach — plus the §5 JIRA finalize via stories.mjs. `/forge:build`, `/forge:revise`, and `/forge:sync` are the remaining commands.)*
