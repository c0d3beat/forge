---
description: Revise an already-approved forge spec for a new requirement. Walks the 7 artifacts in order (Intent → RTM), patching only the ones the change affects, re-publishing each to Confluence and gating on human re-approval before continuing. Stories are add-only. Re-invoke to resume.
argument-hint: "[new requirement in prose]"
disable-model-invocation: true
allowed-tools: Read, Write, Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/confluence.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/jira.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/stories.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/screenshot.mjs *)
---

# /forge:revise — approval-gated spec revision

You revise an existing, fully-approved forge spec to absorb a **new requirement**. Same hard rules as `/forge:init`: **strictly sequential and approval-gated**, **no assumptions** (clarify with the user, recommended option first). The difference: the 7 artifacts already exist and are approved, so you walk them **in order (Intent → RTM)** and touch **only the phases the new requirement actually changes** — each changed phase is patched as a delta, re-published (version++), and **re-gated on human approval before you move to the next phase**. Unchanged phases are skipped without re-approval. **Stories are add-only**: append new `WO-NNN`; never modify or remove an existing story.

Connectors emit JSON on stdout; parse it. `${FD}` = the resolved forge dir (pass `--forge-dir` if known; else connectors auto-locate `forge/` from cwd). The revision **cursor** (which phase you're on) lives in `state.json` so a re-invoke after approval resumes exactly where you stopped.

## 1. Determine where you are

Run `node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs revision-cursor`.

- **`revision` is `null`** → no revision in progress → go to §2 (Start).
- **`revision` is set** → a revision is already underway → skip to §3 (Walk) and resume at `cursorPhase`.

## 2. Start a new revision (only when none is in progress)

1. **Precondition:** the spec must be fully approved first. `state.mjs show`; if any phase's `status` ≠ `approved` (i.e. `/forge:init` isn't finished), tell the user to complete `/forge:init` before revising and **STOP**.
2. **Capture the requirement.** If `$ARGUMENTS` is non-empty, that's the new requirement. Otherwise ask the user to describe it in prose and wait for their reply. Restate it back in one or two sentences and get their confirmation — this becomes the revision's `summary` and the lens for every phase's impact check.
3. `node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs start-revision --summary "<the requirement>"` (sets `mode=revise`, cursor at phase 1). Then go to §3.

## 3. Walk the phases from the cursor

Re-read the cursor: `state.mjs revision-cursor`. Let **P** = `cursorPhase`.

- If `cursorPhase` is `null` (`done: true`) → every phase has been examined → go to §5 (Finalize).
- Else branch on **P.status**:
  - `approved` → P hasn't been examined for this revision yet → §3a (Assess & maybe patch).
  - `in_review` → P was patched in an earlier invoke and is awaiting re-approval → §4 (Check the gate).

### 3a. Assess phase P, and patch only if it changes

1. **Load context:** read P's current artifact (`forge/artifacts/<NN-key>.md`), the new requirement, and every **other** artifact already updated in this revision (`revision.touched`) plus the remaining approved upstream artifacts — P must stay consistent with the revised upstream.
2. **Impact check — does this requirement change P?** Decide honestly. Examples: a changed persona or new core feature cascades from Intent downward; a new feature adds `US-xxx` (PRD), components (Architecture), screens (UI Design), `WO-NNN` (User Stories), test cases (Testing), and an RTM row; a pure wording tweak may touch only one phase. Consider what upstream `touched` phases changed.
   - **No change** → do **not** touch Confluence. `state.mjs advance-cursor`, then **loop back to §3** (continue in this same run — no approval needed for an untouched phase).
   - **Change** → continue below.
3. **Clarify loop** (same as init): self-assess the affected sections' confidence; for anything below `config.confidenceThreshold` (default 90) or any would-be assumption, ask the user with **AskUserQuestion**, recommended option first. Re-score until confident. Never assume the tech stack or other locked decisions — confirm changes to them.
4. **Snapshot the current version:** `state.mjs snapshot --key <P.key>` (preserves the pre-revision artifact under `forge/versions/`).
5. **Patch the artifact as a delta.** Edit `forge/artifacts/<NN-key>.md` so the document stays a coherent, complete spec that reflects the new requirement, and **append a `**Changelog**` entry**: `**Changelog** (<ISO now>): <phase name> — rev <revision.version>` followed by explicit `- ADDED: …` / `- MODIFIED: …` / `- REMOVED: …` bullets describing exactly what changed. Refresh the `## Confidence` block.
   - **Phase 5 (User Stories) is ADD-ONLY:** append new `WO-NNN` work orders (continue the numbering after the highest existing `WO-`), each with the full field table + AC + the 3 DoD lines + any `Depends on`. **Never** edit or delete an existing Work Order. Preserve existing epics; add new ones only if the requirement introduces a new area.
6. `state.mjs set-phase --key <P.key> --artifact-version <prev+1>` (bump the version).
7. **Local review:** show the user the delta (the new Changelog bullets + the changed sections) and get explicit confirmation before publishing. Revise on request.
8. **Re-publish to Confluence** (updates the existing page, version++; auto-renders any ```mermaid fences to PNG attachments): `confluence.mjs publish-artifact --title "<project.name> — <P.name>" --parent-id <parentId> --body-file forge/artifacts/<NN-key>.md`. Read `parentId`/`project.name` from `state.mjs show`. Capture the new `version`.
   - **UI Design (phase 4) only:** if screens changed, re-author/adjust the HTML prototypes under `forge/artifacts/ui/`, re-render with `screenshot.mjs render … --width 390 --height 844`, and re-upload each with `confluence.mjs upload-attachment --id <pageId> --file <png> --name <same-name.png>` (reuse the same attachment names so they replace).
9. `state.mjs set-phase --key <P.key> --status in_review --conf-version <version> --published` and `state.mjs mark-touched --key <P.key>`.
10. **STOP.** Give the user the page URL (`<confluence.baseUrl>/spaces/<spaceKey>/pages/<pageId>`) and tell them: review the update; to approve add the **`<config.approval.approvedLabel>`** label; to request changes add **`<changesLabel>`** or leave footer comments. Then **re-run `/forge:revise`** to continue. Do not advance to the next phase now.

## 4. Check the gate for phase P (status: in_review)

1. `node ${CLAUDE_PLUGIN_ROOT}/connectors/confluence.mjs approval-status --id <P.confluencePageId>` → `{ verdict, approved, changesRequested, commentCount }`.
2. Branch on `verdict`:
   - **approved** → `state.mjs set-phase --key <P.key> --status approved`; then `state.mjs advance-cursor`. Tell the user phase P's revision is approved, and **loop back to §3** for the next phase in this same run.
   - **changes-requested** → `confluence.mjs get-comments --id <id>`; address the feedback by re-doing §3a steps 4–9 (bump `--artifact-version` again, append another Changelog entry), leave status `in_review`, and **STOP** awaiting re-approval.
   - **pending** → tell the user the updated page is still awaiting review. **STOP.**

## 5. Finalize (all phases examined; every touched phase approved)

1. **Add-only story publish** — only if `user-stories` is in `revision.touched`: `node ${CLAUDE_PLUGIN_ROOT}/connectors/stories.mjs publish --file forge/artifacts/05-user-stories.md`. This is idempotent: already-mapped epics/stories are skipped, so **only the newly-added `WO-NNN`** (and their epics + dependency links) are created in JIRA. Report the created counts. If `user-stories` wasn't touched, skip this step.
2. `node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs complete-revision` (closes the revision, sets `mode=build`).
3. Summarize the revision: which phases were touched, versions bumped, and which new JIRA stories were created. Tell the user to run `/forge:build` to implement the new work.

## Notes

- **One revision at a time.** If the user raises another requirement mid-revision, finish (or explicitly abandon) the current one first — `start-revision` refuses to open a second.
- **Add-only is absolute for stories** — existing `WO-NNN`/JIRA issues are never modified or deleted by revise; that keeps dependency links, in-flight PRs, and RTM traceability stable.
- The cursor + `touched` list persist in `state.json`, so every STOP-for-approval is safely resumable by re-invoking `/forge:revise`.
- Mirror every state change through the `state.mjs` CLI (atomic writes) — don't hand-edit `state.json`.
