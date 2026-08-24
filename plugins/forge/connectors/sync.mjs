// sync.mjs — handover reconcile. Pull live truth from Confluence (approval + version),
// JIRA (story statuses), and GitHub (open PRs + merge state) back into forge/state.json,
// then emit a "where we are / what's left / next action" briefing. Reuses the validated
// confluence/jira/github connectors (shells out, same as stories.mjs). Read-only on the
// remote systems; the only local write is state.json (atomic).
//
//   run   [--forge-dir DIR] [--jql "…"]     reconcile all three systems and rewrite state.json
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findForgeDir, loadConfig, section } from "./lib/config.mjs";
import { loadState, saveState, allApproved, currentRevision, currentPhase, phaseById } from "./lib/state.mjs";
import { args, ok, run } from "./lib/cli.mjs";

function conn(forgeDir, script, sub, extra = []) {
  const p = fileURLToPath(new URL(`./${script}`, import.meta.url));
  let out;
  try {
    out = execFileSync("node", [p, sub, "--forge-dir", forgeDir, ...extra], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (e) {
    out = e.stdout?.toString?.() || "";
    if (!out) throw new Error(`${script} ${sub}: ${(e.stderr?.toString?.() || e.message || "").slice(-200)}`);
  }
  let j;
  try { j = JSON.parse(out); } catch { throw new Error(`${script} ${sub} returned non-JSON: ${out.slice(-200)}`); }
  if (!j.ok) throw new Error(`${script} ${sub} failed: ${j.error}`);
  return j;
}

function main() {
  const { flags } = args({ "forge-dir": { type: "string" }, jql: { type: "string" } });
  const forgeDir = flags["forge-dir"] || findForgeDir();
  // requireCreds: a fresh clone won't have .credentials.* (gitignored) — fail with a clear message.
  const { config } = loadConfig({ forgeDir, requireCreds: true });
  const j = section(config, "jira");
  const S = {
    todo: j.statusNames?.todo || "To Do",
    inProgress: j.statusNames?.inProgress || "In Progress",
    inReview: j.statusNames?.inReview || "In Review",
    done: j.statusNames?.done || "Done",
  };
  const state = loadState(forgeDir);
  const warnings = [], storyChanges = [], divergences = [], recovered = [];

  // --- Confluence: approval verdict + current version per published phase ---
  const phaseReport = [];
  for (const ph of state.phases) {
    if (!ph.confluencePageId) { phaseReport.push({ key: ph.key, name: ph.name, published: false, status: ph.status }); continue; }
    try {
      const a = conn(forgeDir, "confluence.mjs", "approval-status", ["--id", String(ph.confluencePageId)]);
      ph.status = a.verdict === "approved" ? "approved" : "in_review"; // published + not-approved => awaiting review
      try {
        const g = conn(forgeDir, "confluence.mjs", "get-page", ["--id", String(ph.confluencePageId)]);
        if (g.version != null) ph.confluenceVersion = g.version;
      } catch (e) { warnings.push(`confluence get-page ${ph.key}: ${e.message}`); }
      phaseReport.push({ key: ph.key, name: ph.name, published: true, status: ph.status, verdict: a.verdict, version: ph.confluenceVersion, commentCount: a.commentCount });
    } catch (e) {
      warnings.push(`confluence approval-status ${ph.key}: ${e.message}`);
      phaseReport.push({ key: ph.key, name: ph.name, published: true, status: ph.status, error: e.message });
    }
  }

  // --- JIRA: live story statuses ---
  let jiraIssueCount = null;
  try {
    const projectKey = j.projectKey;
    const res = conn(forgeDir, "jira.mjs", "jql", ["--jql", flags.jql || `project = ${projectKey} ORDER BY key ASC`, "--fields", "key,status,summary", "--max", "500"]);
    jiraIssueCount = res.count;
    const liveStatus = Object.fromEntries((res.issues || []).map((i) => [i.key, i.status]));
    for (const s of state.stories) {
      if (s.jiraKey && liveStatus[s.jiraKey]) {
        const before = s.status;
        s.status = liveStatus[s.jiraKey];
        if (before !== s.status) storyChanges.push(`${s.wo}/${s.jiraKey}: ${before || "—"} → ${s.status}`);
      } else if (s.jiraKey) {
        warnings.push(`JIRA has no status for ${s.jiraKey} (${s.wo}) — deleted or out of project?`);
      }
    }
    for (const s of state.stories) if (s.status === S.done) s.archived = true; // Done == archived in forge's model
  } catch (e) { warnings.push(`jira jql: ${e.message}`); }

  // --- GitHub: open PRs, merge state, and recover PR<->story links from branch names ---
  let openPRs = [];
  try {
    const prs = conn(forgeDir, "github.mjs", "open-prs");
    openPRs = (prs.prs || []).map((p) => ({ number: p.number, head: p.headRefName, base: p.baseRefName, draft: p.isDraft }));
    // Recover linkage: a branch like forge/wo-002-ci maps to WO-002.
    for (const pr of openPRs) {
      const m = pr.head.match(/wo-?0*(\d+)/i);
      if (!m) continue;
      const wo = "WO-" + String(m[1]).padStart(3, "0");
      const s = state.stories.find((x) => x.wo === wo);
      if (s && !s.prNumber) { s.prNumber = pr.number; s.branch = pr.head; recovered.push(`${wo} ← PR #${pr.number} (${pr.head})`); }
    }
    for (const s of state.stories) {
      if (!s.prNumber) continue;
      try {
        const st = conn(forgeDir, "github.mjs", "pr-status", ["--number", String(s.prNumber)]);
        s.prMerged = st.merged;
        if (st.merged && s.status !== S.done) divergences.push(`${s.jiraKey} PR #${s.prNumber} is MERGED but JIRA status is "${s.status}" — transition to ${S.done}?`);
        if (!st.merged && st.state === "OPEN" && s.status !== S.inReview && s.status !== S.done) divergences.push(`${s.jiraKey} PR #${s.prNumber} is OPEN but JIRA status is "${s.status}"`);
      } catch (e) { warnings.push(`github pr-status #${s.prNumber}: ${e.message}`); }
    }
  } catch (e) { warnings.push(`github open-prs: ${e.message}`); }

  // --- Mode + next action ---
  const rev = currentRevision(state);
  const mode = rev ? "revise" : (allApproved(state) ? "build" : "init");
  state.mode = mode;

  const statusCounts = {};
  for (const s of state.stories) statusCounts[s.status || "unknown"] = (statusCounts[s.status || "unknown"] || 0) + 1;
  const doneWo = new Set(state.stories.filter((s) => s.status === S.done).map((s) => s.wo));
  const knownWo = new Set(state.stories.map((s) => s.wo));
  const depsMet = (s) => (s.dependsOn || []).every((d) => !knownWo.has(d) || doneWo.has(d));
  const inReview = state.stories.filter((s) => s.status === S.inReview);
  const buildable = state.stories.filter((s) => s.status === S.todo && depsMet(s));
  const blocked = state.stories.filter((s) => s.status === S.todo && !depsMet(s));

  let nextAction;
  if (mode === "revise") {
    const cp = rev.cursorPhaseId <= state.phases.length ? phaseById(state, rev.cursorPhaseId) : null;
    nextAction = `Run /forge:revise to resume revision #${rev.version} ("${rev.summary}")` + (cp ? ` — next phase: ${cp.name} (${cp.status})` : " — ready to finalize");
  } else if (mode === "init") {
    const cp = currentPhase(state);
    nextAction = `Run /forge:init to continue — next phase: ${cp ? `${cp.name} (${cp.status})` : "—"}`;
  } else {
    const parts = [];
    if (inReview.length) parts.push(`track In Review: ${inReview.map((s) => `${s.wo}/${s.jiraKey} (PR #${s.prNumber || "?"})`).join(", ")}`);
    if (buildable.length) parts.push(`build next: ${buildable.slice(0, 5).map((s) => `${s.wo}/${s.jiraKey}`).join(", ")}${buildable.length > 5 ? ` (+${buildable.length - 5} more)` : ""}`);
    nextAction = `Run /forge:build — ${parts.join("; ") || "no selectable stories (all In Progress or Done)"}.`;
  }

  state.lastSync = new Date().toISOString();
  saveState(forgeDir, state);

  const approvedCount = state.phases.filter((p) => p.status === "approved").length;
  return ok({
    forgeDir,
    mode,
    project: state.project?.name || null,
    phaseProgress: `${approvedCount}/${state.phases.length} approved`,
    phases: phaseReport,
    stories: {
      total: state.stories.length,
      byStatus: statusCounts,
      inReview: inReview.map((s) => `${s.wo}/${s.jiraKey}`),
      buildable: buildable.map((s) => `${s.wo}/${s.jiraKey}`),
      blocked: blocked.map((s) => `${s.wo}/${s.jiraKey} (needs ${(s.dependsOn || []).filter((d) => knownWo.has(d) && !doneWo.has(d)).join(", ")})`),
    },
    jiraIssueCount,
    openPRs,
    changes: { storyStatus: storyChanges, recoveredPRLinks: recovered },
    divergences,
    warnings,
    lastSync: state.lastSync,
    nextAction,
  });
}

run(main);
