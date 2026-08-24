# forge

An OpenSpec-style, **approval-gated spec-driven-development** workflow, delivered as a Claude Code plugin. Forge generates seven review artifacts in strict sequence, publishes each to **Confluence** for human approval, turns approved user stories into **JIRA** issues, and ships code as **GitHub** PRs gated by a local **SonarQube** SAST scan.

**No MCP.** Every integration is a zero-dependency Node.js REST connector (Confluence, JIRA, SonarQube) or the `gh` CLI (GitHub). Secrets live in a gitignored config file the connectors read directly.

> Status: **Milestone 0 (foundation)** — plugin skeleton, connector libraries, and `/forge:doctor` connectivity check. See the full plan for the roadmap.

## Commands (target)

| Command | Purpose |
|---|---|
| `/forge:init` | Generate the 7 artifacts (Intent → PRD-Spec → Architecture → UI Design → User Stories → Testing → RTM) one at a time, each gated on Confluence approval; then publish stories to JIRA. |
| `/forge:build` | Pick a JIRA story → build → unit test → SonarQube SAST → GitHub PR → track review/merge. Stops at code shipping. |
| `/forge:revise` | Capture new requirements, revise artifacts through the same gated loop, add (never change) stories. |
| `/forge:sync` | Handover: reconcile Confluence/JIRA/GitHub into local state and rebuild context. |
| `/forge:doctor` | Validate config, credentials, and connectivity to all four systems. |

## Repository layout

```
.claude-plugin/marketplace.json      # marketplace manifest (this repo IS the marketplace)
plugins/forge/
├── .claude-plugin/plugin.json        # plugin manifest (namespace: "forge")
├── skills/<cmd>/SKILL.md             # commands (skills) — doctor implemented; init/build/revise/sync WIP
├── connectors/
│   ├── lib/{http,config,state,cli}.mjs   # shared zero-dep libraries
│   └── doctor.mjs                        # connectivity/credential check
└── templates/                        # config.example.yaml, .credentials.example.yaml, artifact templates (WIP)
```

## Install (into an app project)

```
claude plugin marketplace add <owner>/forge-marketplace
claude plugin install forge@forge-marketplace
```

(For local development: `claude --plugin-dir ./plugins/forge`, or add this repo path as a marketplace.)

## Per-project setup

Forge keeps its state in the **app project's** repo under `forge/` (committed, so it travels on `git clone`):

1. `cp` the plugin's `templates/config.example.yaml` → `forge/config.yaml` and fill in the Confluence/JIRA/GitHub/SonarQube pointers. (Safe to commit.)
2. `cp` `templates/.credentials.example.yaml` → `forge/.credentials.yaml` and fill in your Atlassian email + API token and SonarQube token. **Add `forge/.credentials.yaml` to `.gitignore`.**
3. `gh auth login` (GitHub uses the `gh` CLI's own auth).
4. Run `/forge:doctor` — expect all checks green before running `/forge:init`.

> Config/credentials may be YAML (`.yaml`/`.yml`) or JSON (`.json`) — the loader accepts either. `state.json` is always JSON (machine-managed).

Requirements: Node 22+ (for global `fetch`), `gh`, and `sonar-scanner` on PATH; a reachable SonarQube instance.
