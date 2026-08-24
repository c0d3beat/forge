// doctor.mjs — validate forge config, credentials, and live connectivity to
// Confluence, JIRA, SonarQube, and GitHub. Emits a JSON report and exits non-zero
// if any check fails. No secrets are printed.
//
// Usage: node doctor.mjs [--forge-dir <path>]
import { execFileSync } from "node:child_process";
import { loadConfig, section } from "./lib/config.mjs";
import { basicAuth, bearer, request } from "./lib/http.mjs";
import { args, emit } from "./lib/cli.mjs";

const checks = [];
const record = (name, status, detail) => checks.push({ name, status, detail });

function report() {
  const summary = checks.reduce((a, c) => ((a[c.status] = (a[c.status] || 0) + 1), a), {});
  const allPass = checks.every((c) => c.status === "pass");
  emit({ ok: allPass, summary, checks });
  process.exitCode = allPass ? 0 : 1;
}

function firstLine(e) {
  const s = (e && (e.stderr?.toString?.() || e.message) || "").trim();
  return s.split("\n")[0] || "unknown error";
}

async function main() {
  const { flags } = args({ "forge-dir": { type: "string" } });

  let cfg;
  try {
    cfg = loadConfig({ forgeDir: flags["forge-dir"], requireCreds: true });
    record("config", "pass", `Loaded ${cfg.configPath} (+ credentials)`);
  } catch (e) {
    record("config", "fail", e.message);
    return report(); // nothing else is checkable without config
  }
  const { config, credentials } = cfg;
  const email = credentials?.atlassian?.email;
  const atlToken = credentials?.atlassian?.apiToken;

  // --- Confluence: authenticate + resolve the configured space ---
  try {
    const c = section(config, "confluence");
    if (!email || !atlToken) throw new Error("credentials.atlassian.email/apiToken not set");
    const base = String(c.baseUrl).replace(/\/$/, "");
    const auth = basicAuth(email, atlToken);
    const res = await request(`${base}/api/v2/spaces?keys=${encodeURIComponent(c.spaceKey)}`, { auth });
    const found = Array.isArray(res.body?.results) && res.body.results.length > 0;
    record("confluence", found ? "pass" : "warn",
      found
        ? `Authenticated; space '${c.spaceKey}' found (id ${res.body.results[0].id})`
        : `Authenticated, but space '${c.spaceKey}' was not found`);
  } catch (e) {
    record("confluence", "fail", firstLine(e));
  }

  // --- JIRA: authenticate (/myself) + verify project ---
  try {
    const j = section(config, "jira");
    if (!email || !atlToken) throw new Error("credentials.atlassian.email/apiToken not set");
    const base = String(j.baseUrl).replace(/\/$/, "");
    const auth = basicAuth(email, atlToken);
    const me = await request(`${base}/rest/api/3/myself`, { auth });
    let projDetail;
    try {
      const proj = await request(`${base}/rest/api/3/project/${encodeURIComponent(j.projectKey)}`, { auth });
      projDetail = `project '${j.projectKey}' ok (${proj.body.name})`;
    } catch (pe) {
      projDetail = `project '${j.projectKey}' NOT accessible (${firstLine(pe)})`;
    }
    record("jira", "pass", `Auth as ${me.body.emailAddress || me.body.displayName} · ${projDetail}`);
  } catch (e) {
    record("jira", "fail", firstLine(e));
  }

  // --- SonarQube: reachability (/api/system/status) + token validity ---
  try {
    const s = section(config, "sonarqube");
    const base = String(s.url).replace(/\/$/, "");
    const st = await request(`${base}/api/system/status`, {});
    let tokenDetail;
    try {
      const v = await request(`${base}/api/authentication/validate`, { auth: bearer(credentials?.sonarqube?.token || "") });
      tokenDetail = v.body?.valid ? "token valid" : "token INVALID";
    } catch (ve) {
      tokenDetail = `token check failed (${firstLine(ve)})`;
    }
    record("sonarqube", st.body?.status === "UP" ? "pass" : "warn",
      `status=${st.body?.status || "unknown"} · ${tokenDetail}`);
  } catch (e) {
    record("sonarqube", "fail", firstLine(e));
  }

  // --- GitHub: authenticate via PAT (credentials.github.token) if present, else gh's own login ---
  try {
    const g = section(config, "github");
    const ghToken = credentials?.github?.token;
    const ghEnv = ghToken ? { ...process.env, GH_TOKEN: ghToken } : { ...process.env };
    const login = execFileSync("gh", ["api", "user", "-q", ".login"], { stdio: "pipe", env: ghEnv }).toString().trim();
    let repoDetail;
    try {
      const out = execFileSync(
        "gh",
        ["repo", "view", String(g.repo), "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        { stdio: "pipe", env: ghEnv }
      ).toString().trim();
      repoDetail = `repo ${out} accessible`;
    } catch (re) {
      repoDetail = `repo '${g.repo}' NOT accessible (${firstLine(re)})`;
    }
    record("github", "pass", `authenticated as ${login} via ${ghToken ? "PAT" : "gh login"} · ${repoDetail}`);
  } catch (e) {
    const hint = credentials?.github?.token
      ? "check the github.token PAT (needs 'repo' scope)"
      : "run `gh auth login`, or set github.token in credentials";
    record("github", "fail", `GitHub auth failed — ${hint} (${firstLine(e)})`);
  }

  report();
}

main().catch((e) => { record("doctor", "fail", e.message); report(); });
