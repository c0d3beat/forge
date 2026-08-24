---
description: Build approved forge stories — pick a JIRA story, generate code per the artifacts, run unit tests + SonarQube SAST, open a GitHub PR, and keep JIRA status in sync. On re-selection of an in-review story, handle PR review/merge.
argument-hint: "[WO-NNN or JIRA key]"
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Task, Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/*.mjs *), Bash(gh *), Bash(git *), Bash(dotnet *), Bash(npm *), Bash(npx *), Bash(sonar-scanner *)
---

# /forge:build — build stories to shipped code

**Preconditions:** `/forge:init` is complete (`state.json` mode = `build`; stories exist in JIRA + state). Run from the **application repository** (single repo: `forge/` state + app code together). `/forge:doctor` should be green. Stops at **code shipping** — no deployment.

`FD` = the forge dir; connectors auto-locate it, or pass `--forge-dir`.

## 1. Reconcile + present stories
1. Live JIRA statuses: `node ${CLAUDE_PLUGIN_ROOT}/connectors/jira.mjs jql --jql "project = <projectKey> ORDER BY key ASC" --fields key,status,summary --max 200`.
2. Cross-reference `state.json` stories (`WO ↔ jiraKey`); update each story's `status` to the live JIRA status (JIRA is the source of truth; mirror into state).
3. Present stories grouped by status — **To Do**, **In Progress**, **In Review**, **Done**. Only **To Do** and **In Review** are selectable; **In Progress** and **Done** are not.
4. Let the user select one (or honor `$ARGUMENTS`). Reject a non-selectable choice.

## 2. To Do → build
1. **Dependency gate:** every `Depends on` WO must be **Done** (merged). If not, warn and refuse unless the user explicitly overrides.
2. Transition JIRA → **In Progress**: `jira.mjs transition --key <key> --to "<statusNames.inProgress>"`; mirror to state.
3. **Conflict scan:** `github.mjs open-prs`; for each open PR branch, `github.mjs conflict-scan --repo-dir . --base <default-branch> --head <prBranch>`; collect a conflict report.
4. **Branch:** `git checkout <default> && git pull && git checkout -b forge/<wo>-<slug>`.
5. **Generate code** via the `forge-builder` subagent (Task tool): pass the Work Order (title/description/AC/deps), artifact paths (`forge/artifacts/*.md`), the stack, and the conflict report. It writes code + unit + integration tests + fixtures satisfying the AC/DoD and confirms unit tests pass.
6. **Unit tests** (stack-adaptive, e.g. `dotnet test` / `npm test`). Loop with the builder until green.
7. **SonarQube SAST:** `node ${CLAUDE_PLUGIN_ROOT}/connectors/sonar.mjs run --project-dir .` → gate = **OK AND zero unresolved vulnerabilities/hotspots**. On failure, surface findings, fix, re-run. **Do not open a PR until SAST passes.**
8. **Commit & push:** `git add -A && git commit -m "<wo>: <title>"`, then `github.mjs push --repo-dir . --head <branch> --base <default>` (this pre-flights the push and handles the token). If the result has `pushed:false` with `blockers`, **do not** create a PR or transition JIRA — surface the blocker to the user verbatim and STOP. The common blocker is `missing-workflow-scope`: a story that adds `.github/workflows/**` needs the token in `credentials.github.token` to carry the `workflow` scope (classic PAT) or `Workflows: write` (fine-grained PAT); tell the user to update the token and re-run build.
9. **Open PR** (only after a successful push): `github.mjs pr-create --head <branch> --base <default> --title "<wo>: <title>" --body-file <pr-body.md>` (body summarizes the WO, how each AC is met, and test/scan evidence). **Only if pr-create returns a URL**, transition JIRA → **In Review** and record `prNumber` + `branch` in state; give the user the PR URL. **STOP** (human review).

## 3. In Review → track review
1. `github.mjs pr-status --number <prNumber>`.
2. **Merged** → transition JIRA → **Done**; mark the story archived in state; announce.
3. **CHANGES_REQUESTED / unresolved threads / comments** → summarize the feedback; fix via the `forge-builder` subagent; re-run unit tests + SonarQube; `git commit` then `github.mjs push --repo-dir . --head <branch>` to the **same** PR branch (no new PR); keep JIRA **In Review**; tell the user updates were pushed.
4. Otherwise (open, no actionable feedback) → report it's still awaiting review. **STOP.**

## Notes
- JIRA is the source of truth for status; mirror every transition into `state.json`.
- Never build/select **In Progress** or **Done** stories.
- Honor the dependency DAG and the unmerged-branch conflict report to avoid conflicting or redundant work.
- Generate CI/CD files (Actions/GitLab YAML + Dockerfile) only when the requirements call for them; never execute them.
- **Never transition JIRA to In Review or record a `prNumber` before the PR actually exists.** Gate every side effect on the *success* of the prior step (push succeeded → PR created → then transition). A failed push must leave JIRA at **In Progress**.
