// github.mjs — GitHub via the gh CLI + git, emitting structured JSON. Auth uses
// credentials.github.token (passed as GH_TOKEN) or gh's own login. Used by /forge:build.
//
//   open-prs                                  list open PRs (number, title, head/base branch, draft)
//   pr-status     --number N                  merged/state/reviewDecision + inline comments + unresolved threads
//   pr-create     --head B --base main --title T (--body-file f | --body s)
//   conflict-scan --repo-dir DIR --base B --head H   local git merge-tree conflict check (deterministic)
//   push-preflight --repo-dir DIR --head H [--base main]   detect pushes GitHub will reject (workflow scope)
//   push          --repo-dir DIR --head H [--base main]    preflight, then `git push -u origin H`; never on blocker
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { loadConfig, section } from "./lib/config.mjs";
import { args, ok, run } from "./lib/cli.mjs";

function ctx(flags) {
  const { config, credentials } = loadConfig({ forgeDir: flags["forge-dir"], requireCreds: true });
  const g = section(config, "github");
  const token = credentials?.github?.token;
  const env = token ? { ...process.env, GH_TOKEN: token } : { ...process.env };
  return { repo: String(g.repo), env };
}
const gh = (env, a) => execFileSync("gh", a, { stdio: ["ignore", "pipe", "pipe"], env }).toString();
const git = (dir, a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "pipe", "pipe"] }).toString();

// Classic PATs expose their scopes in the X-Oauth-Scopes response header; fine-grained
// PATs return the header empty/absent (permissions aren't listed this way). null = unknown.
function tokenScopes(env) {
  try {
    const m = gh(env, ["api", "-i", "user"]).match(/^x-oauth-scopes:\s*(.*)$/im);
    if (!m || !m[1].trim()) return { scopes: [], fineGrained: true };
    return { scopes: m[1].split(",").map((s) => s.trim()).filter(Boolean), fineGrained: false };
  } catch {
    return { scopes: [], fineGrained: null };
  }
}

// Files this push would add/modify vs base, and whether GitHub would reject it.
// GitHub refuses to accept .github/workflows/** over a token lacking the `workflow` scope.
function preflight(dir, base, head, env) {
  let files = [];
  for (const spec of [`${base}...${head}`, `${base}..${head}`]) {
    try { files = git(dir, ["diff", "--name-only", spec]).split("\n").map((s) => s.trim()).filter(Boolean); break; } catch { /* try next */ }
  }
  const workflowFiles = files.filter((f) => /^\.github\/workflows\//.test(f));
  const blockers = [], warnings = [];
  let scopes = [], hasWorkflowScope = null;
  if (workflowFiles.length) {
    const t = tokenScopes(env);
    scopes = t.scopes;
    hasWorkflowScope = t.fineGrained ? null : scopes.includes("workflow");
    if (hasWorkflowScope === false) {
      blockers.push({ kind: "missing-workflow-scope", files: workflowFiles,
        message: `Push includes ${workflowFiles.length} file(s) under .github/workflows/, but the token scopes are [${scopes.join(", ") || "none"}] and lack 'workflow'. GitHub will reject the push. Add the 'workflow' scope to the classic PAT (or 'Workflows: write' to a fine-grained PAT) in credentials.github.token.` });
    } else if (hasWorkflowScope === null) {
      warnings.push({ kind: "workflow-scope-unverifiable", files: workflowFiles,
        message: `Push includes .github/workflows/ file(s) and the token appears fine-grained — ensure it grants 'Workflows: write' or GitHub will reject the push.` });
    }
  }
  return { base, head, changedFiles: files.length, workflowFiles, scopes, hasWorkflowScope, canPush: blockers.length === 0, blockers, warnings };
}

async function main() {
  const { positionals, flags } = args({
    "forge-dir": { type: "string" }, number: { type: "string" }, head: { type: "string" },
    base: { type: "string" }, title: { type: "string" }, body: { type: "string" },
    "body-file": { type: "string" }, "repo-dir": { type: "string" },
  });
  const sub = positionals[0];

  if (sub === "conflict-scan") {
    // Deterministic local conflict check (do NOT trust GitHub's async mergeable flag).
    const dir = flags["repo-dir"] || process.cwd();
    const base = flags.base, head = flags.head;
    if (!base || !head) throw new Error("conflict-scan requires --base and --head");
    try {
      const out = execFileSync("git", ["-C", dir, "merge-tree", "--write-tree", base, head], { stdio: ["ignore", "pipe", "pipe"] }).toString();
      return ok({ base, head, conflicts: false, tree: out.trim().split("\n")[0] });
    } catch (e) {
      const out = (e.stdout?.toString?.() || "") + (e.stderr?.toString?.() || "");
      const files = [...out.matchAll(/^CONFLICT.*?:\s*(.*)$/gim)].map((m) => m[1]).slice(0, 50);
      return ok({ base, head, conflicts: true, detail: out.slice(0, 800), files });
    }
  }

  const { repo, env } = ctx(flags);

  switch (sub) {
    case "push-preflight": {
      const dir = flags["repo-dir"] || process.cwd();
      if (!flags.head) throw new Error("push-preflight requires --head");
      return ok(preflight(dir, flags.base || "main", flags.head, env));
    }
    case "push": {
      const dir = flags["repo-dir"] || process.cwd();
      if (!flags.head) throw new Error("push requires --head");
      const pf = preflight(dir, flags.base || "main", flags.head, env);
      if (pf.blockers.length) return ok({ pushed: false, ...pf });
      try {
        const out = execFileSync("git", ["-C", dir, "push", "-u", "origin", flags.head], { stdio: ["ignore", "pipe", "pipe"], env }).toString();
        return ok({ pushed: true, head: flags.head, warnings: pf.warnings, output: out.trim().slice(-500) });
      } catch (e) {
        const err = (e.stderr?.toString?.() || "") + (e.stdout?.toString?.() || "");
        if (/without\s+.?workflow.?\s+scope/i.test(err)) {
          return ok({ pushed: false, warnings: pf.warnings, blockers: [{ kind: "missing-workflow-scope",
            message: "GitHub rejected the push: token lacks the 'workflow' scope required for .github/workflows/. Add 'workflow' to the classic PAT (or 'Workflows: write' to a fine-grained PAT) in credentials.github.token.", detail: err.slice(-400) }] });
        }
        throw new Error("git push failed: " + err.slice(-500));
      }
    }
    case "open-prs": {
      const out = gh(env, ["pr", "list", "--repo", repo, "--state", "open", "--json", "number,title,headRefName,baseRefName,isDraft"]);
      return ok({ repo, prs: JSON.parse(out) });
    }
    case "pr-status": {
      if (!flags.number) throw new Error("pr-status requires --number");
      const n = flags.number;
      const view = JSON.parse(gh(env, ["pr", "view", n, "--repo", repo, "--json",
        "number,state,mergedAt,mergeCommit,headRefName,baseRefName,reviewDecision,mergeable,mergeStateStatus"]));
      let comments = [];
      try {
        comments = JSON.parse(gh(env, ["api", `repos/${repo}/pulls/${n}/comments`,
          "--jq", "[.[]|{path:.path,line:.line,body:.body,user:.user.login,inReplyTo:.in_reply_to_id}]"]));
      } catch { /* none */ }
      let unresolved = null;
      try {
        const [owner, name] = repo.split("/");
        const q = `{repository(owner:"${owner}",name:"${name}"){pullRequest(number:${n}){reviewThreads(first:100){nodes{isResolved}}}}}`;
        const g = JSON.parse(gh(env, ["api", "graphql", "-f", `query=${q}`]));
        const nodes = g?.data?.repository?.pullRequest?.reviewThreads?.nodes || [];
        unresolved = nodes.filter((t) => !t.isResolved).length;
      } catch { /* graphql unavailable */ }
      return ok({ number: view.number, merged: view.state === "MERGED", mergedAt: view.mergedAt, state: view.state,
        reviewDecision: view.reviewDecision, mergeStateStatus: view.mergeStateStatus,
        headRefName: view.headRefName, baseRefName: view.baseRefName,
        commentCount: comments.length, comments, unresolvedThreads: unresolved });
    }
    case "pr-create": {
      if (!flags.head || !flags.title) throw new Error("pr-create requires --head and --title");
      const base = flags.base || "main";
      const body = flags["body-file"] ? readFileSync(flags["body-file"], "utf8") : (flags.body || "");
      const out = gh(env, ["pr", "create", "--repo", repo, "--head", flags.head, "--base", base,
        "--title", flags.title, "--body", body]).trim();
      const url = out.split("\n").pop();
      const number = (url.match(/\/pull\/(\d+)/) || [])[1] || null;
      return ok({ url, number, head: flags.head, base });
    }
    default:
      throw new Error(`unknown subcommand '${sub || ""}'. Use open-prs | pr-status | pr-create | conflict-scan.`);
  }
}

run(main);
