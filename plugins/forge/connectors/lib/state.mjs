// state.mjs — atomic read/write of forge/state.json (the workflow control plane).
// Remote systems (Confluence/JIRA/GitHub) are source-of-truth for approval/status;
// this file is source-of-truth for *workflow* progression and is committed to the repo.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { renameSync } from "node:fs";
import { join } from "node:path";

export const PHASES = [
  { id: 1, key: "intent", name: "Intent" },
  { id: 2, key: "prd-spec", name: "PRD-Spec" },
  { id: 3, key: "architecture", name: "Architecture" },
  { id: 4, key: "ui-design", name: "UI Design" },
  { id: 5, key: "user-stories", name: "User Stories" },
  { id: 6, key: "testing", name: "Testing" },
  { id: 7, key: "rtm", name: "RTM" },
];

// Phase status lifecycle: pending -> drafting -> in_review -> approved
export function defaultState() {
  return {
    version: 1,
    mode: "init", // init | build | revise
    project: { name: null, confluenceParentPageId: null },
    phases: PHASES.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      status: "pending",
      artifactPath: `forge/artifacts/${String(p.id).padStart(2, "0")}-${p.key}.md`,
      artifactUuid: null,
      confluencePageId: null,
      confluenceVersion: null,
      artifactVersion: 0,
      confidence: null,
      lastPublishedAt: null,
    })),
    epics: [],    // { epic: "EPIC-001", jiraKey, name }
    stories: [],  // { wo: "WO-001", jiraKey, epic, title, status, prNumber, branch, artifactVersion }
    revisions: [],// { version, date, summary }
    lastSync: null,
  };
}

export function statePath(forgeDir) {
  return join(forgeDir, "state.json");
}

export function loadState(forgeDir) {
  const p = statePath(forgeDir);
  if (!existsSync(p)) return defaultState();
  return JSON.parse(readFileSync(p, "utf8"));
}

export function saveState(forgeDir, state) {
  const p = statePath(forgeDir);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmp, p); // atomic on same filesystem
  return p;
}

// First phase that is not yet approved — the only phase forge may work on.
export function currentPhase(state) {
  return state.phases.find((ph) => ph.status !== "approved") || null;
}

export function phaseByKey(state, key) {
  return state.phases.find((ph) => ph.key === key) || null;
}

export function phaseById(state, id) {
  return state.phases.find((ph) => ph.id === Number(id)) || null;
}

export function allApproved(state) {
  return state.phases.every((ph) => ph.status === "approved");
}

// The single in-progress revision (/forge:revise), or null. Revisions walk phases
// 1..7 via `cursorPhaseId`, re-gating only phases they actually change (`touched`).
export function currentRevision(state) {
  const revs = state.revisions || [];
  for (let i = revs.length - 1; i >= 0; i--) if (revs[i].status === "in_progress") return revs[i];
  return null;
}
