---
description: Handover / catch-up. Reconcile live Confluence approvals, JIRA story statuses, and GitHub PR state back into forge's local state.json, then brief the developer on where the project stands, what's left, and the next action. Run after cloning a forge repo, or any time local state may be stale.
argument-hint: ""
disable-model-invocation: true
allowed-tools: Read, Write, Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/sync.mjs *), Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/doctor.mjs *)
---

# /forge:sync — reconcile state & brief the developer

Remote systems are the source of truth for approval and status; `state.json` is committed and travels with the repo but may be stale (a teammate approved a page, merged a PR, or moved a JIRA issue since the last commit). You pull live truth from Confluence + JIRA + GitHub back into `state.json` and hand the developer a clear "where we are / what's left / next" briefing. This is **read-only on the remote systems** — the only local write is `state.json`.

Connectors emit JSON on stdout; parse it. `${FD}` = the resolved forge dir.

## 1. Preconditions — credentials must exist

Secrets are gitignored, so a fresh clone won't have them.

1. `node ${CLAUDE_PLUGIN_ROOT}/connectors/state.mjs scaffold --plugin-root ${CLAUDE_PLUGIN_ROOT}` (idempotent — ensures `forge/` dirs, seeds `config.yaml`/`.credentials.yaml` from templates only if absent, wires `.gitignore`).
2. If `.credentials.yaml` was just seeded (or still holds template placeholders), tell the user to fill in `forge/.credentials.yaml` (Atlassian email+token, Sonar token, GitHub token) and `forge/config.yaml` (URLs, keys, repo), then re-run `/forge:sync`. **STOP** — you can't reconcile without creds.
3. Verify connectivity: `node ${CLAUDE_PLUGIN_ROOT}/connectors/doctor.mjs`. If any system is red, report exactly which and its error, and stop until it's green. (A single red system means that part of the reconcile can't run.)

## 2. Reconcile

Run `node ${CLAUDE_PLUGIN_ROOT}/connectors/sync.mjs run`. It:
- reads each published phase's Confluence **approval verdict + version** → sets phase `status` (`approved`, else `in_review`);
- reads live **JIRA** statuses for every mapped story → updates `story.status` (and marks `Done` stories archived);
- lists **open GitHub PRs**, checks merge state for linked PRs, and **recovers PR↔story links from branch names** (e.g. `forge/wo-002-ci` → WO-002);
- recomputes `mode` (`init` if not all phases approved, `revise` if a revision is in progress, else `build`), writes `state.json`, and returns a structured briefing.

If `sync.mjs` errors on missing credentials, go back to §1. Per-system failures come back as `warnings` (partial reconcile) rather than aborting — surface them.

## 3. Brief the developer

From the returned JSON, present a concise briefing (not raw JSON):

- **Where we are** — `project`, `mode`, `phaseProgress` (e.g. "7/7 approved"), and a one-line-per-phase status list. For `init`/`revise`, name the phase the pipeline is paused on.
- **Stories** — totals by status (`stories.byStatus`), plus the **In Review** and **buildable** lists, and any **blocked** stories with the dependency they're waiting on.
- **What changed this sync** — `changes.storyStatus` (e.g. "WO-001/PER-9: To Do → Done") and `changes.recoveredPRLinks`. If empty, say local state was already current.
- **Needs attention** — surface every `divergences` entry (e.g. a merged PR whose JIRA isn't `Done`) and every `warnings` entry, as recommendations. Do **not** auto-fix them here — sync only reconciles state; closing a divergence is a `/forge:build` (or manual JIRA/GitHub) action. Recommend the specific fix.
- **Next action** — state `nextAction` verbatim as the recommended next step, and offer to run that command.

## Notes

- Sync never mutates Confluence/JIRA/GitHub — it only rewrites local `state.json`. Acting on findings is the job of `/forge:init`, `/forge:revise`, or `/forge:build`.
- JIRA is authoritative for story status; Confluence labels are authoritative for phase approval; a merged PR is authoritative for "work landed". When these disagree with local state, sync adopts the remote truth and flags the disagreement.
- Safe to run repeatedly; it's idempotent and converges local state onto live truth.
