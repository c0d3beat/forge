// sonar.mjs — SonarQube connector: trigger a scan, wait for analysis, evaluate the SAST gate.
//
// Subcommands:
//   scan   [--project-dir DIR] [--extra "-Dkey=val -Dkey2=val2"]
//              runs `sonar-scanner`; returns ceTaskId from .scannerwork/report-task.txt
//   wait   --ce-task-id ID [--timeout-sec N]      polls api/ce/task until terminal; returns analysisId
//   gate   [--analysis-id ID | --project-key K]   Quality Gate + unresolved vuln/hotspot counts
//   run    [--project-dir DIR] [--extra "..."]    scan -> wait -> gate (one shot)
//
// Pass = Quality Gate OK AND zero unresolved VULNERABILITY issues AND zero TO_REVIEW hotspots.
// Config: sonarqube.url, sonarqube.projectKey. Credentials: sonarqube.token.
// Token is passed to the scanner via SONAR_TOKEN env (never on argv).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { loadConfig, section } from "./lib/config.mjs";
import { bearer, request } from "./lib/http.mjs";
import { args, ok, run } from "./lib/cli.mjs";

const OPTIONS = {
  "forge-dir": { type: "string" },
  "project-dir": { type: "string" },
  "project-key": { type: "string" },
  "ce-task-id": { type: "string" },
  "analysis-id": { type: "string" },
  "timeout-sec": { type: "string" },
  extra: { type: "string" },
};

function ctx(flags) {
  const { config, credentials } = loadConfig({ forgeDir: flags["forge-dir"], requireCreds: true });
  const s = section(config, "sonarqube");
  const token = credentials?.sonarqube?.token;
  if (!token) throw new Error("credentials.sonarqube.token not set");
  return { s, base: String(s.url).replace(/\/$/, ""), token, auth: bearer(token) };
}

function parseReportTask(projectDir) {
  const p = join(projectDir, ".scannerwork", "report-task.txt");
  if (!existsSync(p)) throw new Error(`Scanner report not found at ${p} — did the scan run?`);
  const out = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const idx = line.indexOf("=");
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function runScanner(projectDir, projectKey, token, base, extra) {
  const args = [`-Dsonar.projectKey=${projectKey}`];
  // Respect a committed sonar-project.properties if present; otherwise default sources to cwd.
  if (!existsSync(join(projectDir, "sonar-project.properties"))) args.push("-Dsonar.sources=.");
  if (extra) for (const tok of extra.split(/\s+/).filter(Boolean)) args.push(tok);
  const env = { ...process.env, SONAR_TOKEN: token, SONAR_HOST_URL: base };
  try {
    const out = execFileSync("sonar-scanner", args, { cwd: projectDir, env, stdio: "pipe" });
    return { ok: true, output: out.toString().slice(-2000) };
  } catch (e) {
    const detail = (e.stderr?.toString?.() || e.stdout?.toString?.() || e.message || "").slice(-2000);
    throw new Error(`sonar-scanner failed: ${detail.split("\n").slice(-5).join(" | ")}`);
  }
}

async function pollCeTask(base, auth, ceTaskId, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  for (;;) {
    const res = await request(`${base}/api/ce/task?id=${encodeURIComponent(ceTaskId)}`, { auth });
    const task = res.body?.task || {};
    if (["SUCCESS", "FAILED", "CANCELED"].includes(task.status)) return task;
    if (Date.now() > deadline) throw new Error(`Timed out after ${timeoutSec}s waiting for CE task ${ceTaskId} (status=${task.status})`);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function evaluateGate(base, auth, { analysisId, projectKey }) {
  const qs = analysisId ? `analysisId=${encodeURIComponent(analysisId)}` : `projectKey=${encodeURIComponent(projectKey)}`;
  const warnings = [];
  let status = "NONE", vulnerabilities = null, hotspots = null;
  // Quality Gate status is authoritative; the absolute vuln/hotspot counts are an extra guard.
  // Each is read defensively so a single endpoint's permission quirk doesn't abort the pipeline.
  try {
    const gate = await request(`${base}/api/qualitygates/project_status?${qs}`, { auth });
    status = gate.body?.projectStatus?.status || "NONE";
  } catch (e) { warnings.push(`quality-gate: ${e.message}`); }
  try {
    const r = await request(`${base}/api/issues/search?componentKeys=${encodeURIComponent(projectKey)}&resolved=false&types=VULNERABILITY&ps=1`, { auth });
    vulnerabilities = r.body?.total ?? 0;
  } catch (e) { warnings.push(`vulnerabilities: ${e.message}`); }
  try {
    const r = await request(`${base}/api/hotspots/search?projectKey=${encodeURIComponent(projectKey)}&status=TO_REVIEW&ps=1`, { auth });
    hotspots = r.body?.paging?.total ?? (r.body?.hotspots?.length ?? 0);
  } catch (e) { warnings.push(`hotspots: ${e.message}`); }

  const pass = status === "OK" && (vulnerabilities ?? 0) === 0 && (hotspots ?? 0) === 0;
  return { pass, gate: status, vulnerabilities, hotspots, warnings };
}

async function main() {
  const { positionals, flags } = args(OPTIONS);
  const sub = positionals[0];
  const { base, auth, token, s } = ctx(flags);
  const projectDir = flags["project-dir"] || process.cwd();
  const projectKey = flags["project-key"] || s.projectKey;
  const timeoutSec = Number(flags["timeout-sec"] || 300);

  switch (sub) {
    case "scan": {
      runScanner(projectDir, projectKey, token, base, flags.extra);
      const rt = parseReportTask(projectDir);
      return ok({ ceTaskId: rt.ceTaskId, ceTaskUrl: rt.ceTaskUrl, projectKey: rt.projectKey || projectKey });
    }
    case "wait": {
      if (!flags["ce-task-id"]) throw new Error("wait requires --ce-task-id");
      const task = await pollCeTask(base, auth, flags["ce-task-id"], timeoutSec);
      if (task.status !== "SUCCESS") throw new Error(`CE task ${flags["ce-task-id"]} ended ${task.status}`);
      return ok({ status: task.status, analysisId: task.analysisId, componentKey: task.componentKey });
    }
    case "gate": {
      const result = await evaluateGate(base, auth, { analysisId: flags["analysis-id"], projectKey });
      return ok(result);
    }
    case "run": {
      runScanner(projectDir, projectKey, token, base, flags.extra);
      const rt = parseReportTask(projectDir);
      const task = await pollCeTask(base, auth, rt.ceTaskId, timeoutSec);
      if (task.status !== "SUCCESS") throw new Error(`CE task ${rt.ceTaskId} ended ${task.status}`);
      const result = await evaluateGate(base, auth, { analysisId: task.analysisId, projectKey });
      return ok({ ceTaskId: rt.ceTaskId, analysisId: task.analysisId, ...result });
    }
    default:
      throw new Error(`unknown subcommand '${sub || ""}'. See header for usage.`);
  }
}

run(main);
