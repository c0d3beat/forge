# forge

An OpenSpec-style, **approval-gated spec-driven-development** workflow, delivered as a Claude Code plugin. Forge generates seven review artifacts in strict sequence, publishes each to **Confluence** for human approval, turns approved user stories into **JIRA** issues, and ships code as **GitHub** PRs gated by a local **SonarQube** SAST scan.

**No MCP.** Every integration is a zero-dependency Node.js REST connector (Confluence, JIRA, SonarQube) or the `gh` CLI (GitHub). Secrets live in a gitignored config file the connectors read directly.

> **Status:** feature-complete (v0.0.1). All five commands are implemented and have been exercised against live Atlassian Cloud, a Podman SonarQube, and GitHub. `/forge:init`, `/forge:build`, and `/forge:sync` have been run end-to-end live; `/forge:revise` is implemented and its state machine tested.

## Commands

| Command | Purpose |
|---|---|
| `/forge:init` | Generate the 7 artifacts (Intent → PRD-Spec → Architecture → UI Design → User Stories → Testing → RTM) one at a time, each gated on Confluence approval; then publish stories to JIRA and switch to build mode. |
| `/forge:build` | Pick a JIRA story (status-aware, dependency-DAG-aware) → build code → unit tests → SonarQube SAST → GitHub PR → track review/merge → Done. Stops at code shipping. |
| `/forge:revise` | Capture a new requirement, walk the 7 artifacts in order patching only those it affects (each re-gated on approval), and **add** (never change) stories. |
| `/forge:sync` | Handover / catch-up: reconcile live Confluence approvals, JIRA statuses, and GitHub PR state back into local `state.json` and brief you on where things stand and what's next. |
| `/forge:doctor` | Validate config, credentials, and connectivity to all four systems. |

**Hard rules forge follows:** strictly sequential, approval-gated phases (never generate phase N+1 until phase N carries the `approved` label on its Confluence page); no assumptions (it clarifies ambiguities — the tech stack especially — with recommended options); stories carry stable `WO-NNN` IDs and are add-only across revisions; the SAST gate is *Quality Gate OK **and** zero unresolved vulnerabilities/hotspots*; and the workflow stops at code shipping — CI/CD files and Dockerfiles are generated as deliverables, never executed.

## How it runs

State lives in the **app project's** repo under `forge/` (committed, so it travels on `git clone`); remote systems are the source of truth for approval and status. A typical arc: `/forge:doctor` → `/forge:init` (7 gated artifacts → Confluence → JIRA) → `/forge:build` per story → `/forge:revise` for new requirements → `/forge:sync` when a teammate picks the repo up. Mermaid diagrams and UI-prototype screenshots are rendered to PNG (reusing an installed Chrome) and attached to the Confluence pages.

## Repository layout

```
.claude-plugin/marketplace.json          # marketplace manifest (this repo IS the marketplace)
plugins/forge/
├── .claude-plugin/plugin.json            # plugin manifest (namespace: "forge")
├── skills/
│   ├── init/SKILL.md  build/SKILL.md  revise/SKILL.md  sync/SKILL.md  doctor/SKILL.md
├── agents/
│   └── builder.md                        # story implementer (full artifact + conflict context)
├── connectors/                           # Node 22, zero-dependency
│   ├── lib/{http,config,state,cli,md,wo,yaml}.mjs   # shared libraries
│   ├── confluence.mjs                    # pages, labels, comments, attachments, md→storage, publish-artifact
│   ├── jira.mjs                          # epics, issues (md→ADF), transitions, jql, links
│   ├── sonar.mjs                         # sonar-scanner run + CE wait + SAST gate
│   ├── github.mjs                        # gh-backed PRs, status, conflict-scan, push pre-flight
│   ├── stories.mjs                       # User Stories artifact → JIRA epics/stories/links (idempotent)
│   ├── sync.mjs                          # reconcile Confluence/JIRA/GitHub → state.json
│   ├── mermaid.mjs  screenshot.mjs       # Mermaid→PNG and HTML-prototype→PNG (reuse installed Chrome)
│   ├── state.mjs                         # phase/revision state machine CLI
│   └── doctor.mjs                        # connectivity/credential check
└── templates/
    ├── config.example.yaml  .credentials.example.yaml
    └── artifacts/01-intent.md … 07-rtm.md   # style templates for each phase
```

## Install (into an app project)

```
claude plugin marketplace add c0d3beat/forge
claude plugin install forge@forge-marketplace
```

(For local development: add the checkout path as a marketplace — `claude plugin marketplace add /path/to/forge` — or load it directly with `claude --plugin-dir /path/to/forge/plugins/forge`.)

## Per-project setup

Forge keeps its state in the app project's repo under `forge/` (committed, so it travels on `git clone`):

1. Run `/forge:init` — its first step scaffolds `forge/` and seeds `config.yaml` + `.credentials.yaml` from the templates, and wires `.gitignore`.
2. Fill in `forge/config.yaml` — Confluence/JIRA/GitHub/SonarQube URLs, space/project keys, repo, and SonarQube project key. (Safe to commit.)
3. Fill in `forge/.credentials.yaml` — Atlassian email + API token, SonarQube token, and a GitHub token. **Never committed** (gitignored). A GitHub token needs the `repo` scope, plus `workflow` if any story will push `.github/workflows/**`.
4. Run `/forge:doctor` — expect all four systems green before `/forge:init` proceeds to publishing.

A teammate joining later clones the repo, drops in their own `forge/.credentials.yaml`, and runs `/forge:sync` to reconcile live state and get a "where we are / what's left / next" briefing.

> Config/credentials may be YAML (`.yaml`/`.yml`) or JSON (`.json`) — the loader accepts either. `state.json` is always JSON (machine-managed).

## Requirements

Node 22+ (for global `fetch`), the `gh` CLI, and `sonar-scanner` on PATH; a reachable SonarQube instance; and an installed Chrome/Chromium (used to render Mermaid diagrams and UI screenshots — no Playwright install needed).
