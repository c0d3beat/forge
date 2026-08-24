---
description: Validate forge configuration, credentials, and connectivity to Confluence, JIRA, SonarQube, and GitHub. Use after setting up forge/config.json + forge/.credentials.json, or whenever a forge integration misbehaves.
argument-hint: ""
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/connectors/doctor.mjs*), Bash(gh auth status), Bash(gh repo view *)
---

# /forge:doctor — connectivity & credential check

Run the forge doctor connector from the user's project directory and report results. It locates `forge/config.yaml` (or `.yml`/`.json`) by walking up from the current directory (or honors the `FORGE_DIR` env var).

1. Run:

   !`node ${CLAUDE_PLUGIN_ROOT}/connectors/doctor.mjs`

2. Parse the JSON report `{ ok, summary, checks[] }`. Present each check — `config`, `confluence`, `jira`, `sonarqube`, `github` — with its status (`pass` / `warn` / `fail`) and `detail`, as a short checklist.

3. For any failure, give the specific fix:
   - **config** → `forge/config.yaml` or `forge/.credentials.yaml` is missing/invalid. Point the user at the plugin's `templates/config.example.yaml` and `templates/.credentials.example.yaml`; the files belong in the project's `forge/` directory (`.credentials.yaml` must be gitignored).
   - **confluence** → check `confluence.baseUrl` (should end in `/wiki` for Cloud), `spaceKey`, and the Atlassian email + API token.
   - **jira** → check `jira.baseUrl`, `projectKey`, and the same Atlassian credentials.
   - **sonarqube** → confirm the SonarQube URL is reachable (Podman container up) and the token is valid.
   - **github** → run `gh auth login`, and confirm `github.repo` is `owner/repo`.

4. End with a one-line verdict (all green, or the exact next step). Never print token values.
