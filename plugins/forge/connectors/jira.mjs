// jira.mjs — JIRA Cloud connector (REST v3, ADF bodies).
//
// Subcommands:
//   create-epic      --name NAME [--summary S] [--desc-file f|--desc md]
//   create-issue     --summary S [--epic-key K] [--labels a,b] [--points N] [--priority P]
//                    (--desc-file f | --desc md) [--fields-json '{...}']
//   get-status       --key K
//   list-transitions --key K
//   transition       --key K --to "In Progress" [--resolution Done] [--comment md]
//   add-comment      --key K (--body md | --body-file f)
//   jql              --jql "project = X AND statusCategory != Done" [--fields a,b] [--max N]
//   link             --inward K1 --outward K2 [--type Blocks]
//   delete-issue     --key K
//
// Auth: Basic (Atlassian email + API token). Config: jira.baseUrl, jira.projectKey,
// jira.issueType (default Story), jira.epicIssueType (default Epic), jira.statusNames,
// optional jira.storyPointsField / jira.epicLinkField (custom field ids).
import { readFileSync } from "node:fs";
import { loadConfig, section } from "./lib/config.mjs";
import { basicAuth, request } from "./lib/http.mjs";
import { mdToAdf } from "./lib/md.mjs";
import { args, ok, run } from "./lib/cli.mjs";

const OPTIONS = {
  "forge-dir": { type: "string" },
  key: { type: "string" },
  summary: { type: "string" },
  name: { type: "string" },
  "epic-key": { type: "string" },
  labels: { type: "string" },
  points: { type: "string" },
  priority: { type: "string" },
  desc: { type: "string" },
  "desc-file": { type: "string" },
  "fields-json": { type: "string" },
  jql: { type: "string" },
  fields: { type: "string" },
  max: { type: "string" },
  to: { type: "string" },
  resolution: { type: "string" },
  comment: { type: "string" },
  type: { type: "string" },
  inward: { type: "string" },
  outward: { type: "string" },
  body: { type: "string" },
  "body-file": { type: "string" },
};

function ctx(flags) {
  const { config, credentials } = loadConfig({ forgeDir: flags["forge-dir"], requireCreds: true });
  const j = section(config, "jira");
  const email = credentials?.atlassian?.email;
  const token = credentials?.atlassian?.apiToken;
  if (!email || !token) throw new Error("credentials.atlassian.email/apiToken not set");
  return { j, base: String(j.baseUrl).replace(/\/$/, ""), auth: basicAuth(email, token) };
}

function readMd(flags, fileKey, strKey) {
  if (flags[fileKey]) return readFileSync(flags[fileKey], "utf8");
  return flags[strKey];
}

function sanitizeLabels(csv) {
  if (!csv) return [];
  return csv.split(",").map((s) => s.trim().replace(/\s+/g, "-")).filter(Boolean);
}

async function createIssue({ base, auth }, fields) {
  const res = await request(`${base}/rest/api/3/issue`, { method: "POST", auth, body: { fields } });
  return res.body; // { id, key, self }
}

async function main() {
  const { positionals, flags } = args(OPTIONS);
  const sub = positionals[0];
  const { base, auth, j } = ctx(flags);
  const projectKey = j.projectKey;

  switch (sub) {
    case "create-epic": {
      const summary = flags.summary || flags.name;
      if (!summary) throw new Error("create-epic requires --name (or --summary)");
      const fields = { project: { key: projectKey }, issuetype: { name: j.epicIssueType || "Epic" }, summary };
      const descMd = readMd(flags, "desc-file", "desc");
      if (descMd) fields.description = mdToAdf(descMd);
      // Some company-managed projects require an Epic Name custom field.
      if (j.epicNameField) fields[j.epicNameField] = flags.name || summary;
      const issue = await createIssue({ base, auth }, fields);
      return ok({ key: issue.key, id: issue.id, type: "epic" });
    }

    case "create-issue": {
      if (!flags.summary) throw new Error("create-issue requires --summary");
      const fields = {
        project: { key: projectKey },
        issuetype: { name: j.issueType || "Story" },
        summary: flags.summary,
      };
      const descMd = readMd(flags, "desc-file", "desc");
      if (descMd) fields.description = mdToAdf(descMd);
      const labels = sanitizeLabels(flags.labels);
      if (labels.length) fields.labels = labels;
      if (flags.points && j.storyPointsField) fields[j.storyPointsField] = Number(flags.points);
      if (flags.priority) fields.priority = { name: flags.priority };
      if (flags["epic-key"]) {
        if (j.epicLinkField) fields[j.epicLinkField] = flags["epic-key"]; // company-managed classic
        else fields.parent = { key: flags["epic-key"] };                  // team-managed / modern hierarchy
      }
      if (flags["fields-json"]) Object.assign(fields, JSON.parse(flags["fields-json"]));
      const issue = await createIssue({ base, auth }, fields);
      return ok({ key: issue.key, id: issue.id, type: "story", epic: flags["epic-key"] || null });
    }

    case "get-status": {
      if (!flags.key) throw new Error("get-status requires --key");
      const res = await request(`${base}/rest/api/3/issue/${flags.key}?fields=status`, { auth });
      return ok({ key: flags.key, status: res.body?.fields?.status?.name || null });
    }

    case "list-transitions": {
      if (!flags.key) throw new Error("list-transitions requires --key");
      const res = await request(`${base}/rest/api/3/issue/${flags.key}/transitions`, { auth });
      const transitions = (res.body?.transitions || []).map((t) => ({ id: t.id, name: t.name, to: t.to?.name }));
      return ok({ key: flags.key, transitions });
    }

    case "transition": {
      if (!flags.key || !flags.to) throw new Error("transition requires --key and --to");
      const list = await request(`${base}/rest/api/3/issue/${flags.key}/transitions`, { auth });
      const target = flags.to.toLowerCase();
      const t = (list.body?.transitions || []).find(
        (x) => (x.to?.name || "").toLowerCase() === target || (x.name || "").toLowerCase() === target);
      if (!t) {
        const avail = (list.body?.transitions || []).map((x) => x.to?.name).join(", ");
        throw new Error(`No transition to '${flags.to}' from current status. Available targets: ${avail || "(none)"}`);
      }
      const payload = { transition: { id: t.id } };
      if (flags.resolution) payload.fields = { resolution: { name: flags.resolution } };
      if (flags.comment) payload.update = { comment: [{ add: { body: mdToAdf(flags.comment) } }] };
      await request(`${base}/rest/api/3/issue/${flags.key}/transitions`, { method: "POST", auth, body: payload, json: false });
      return ok({ key: flags.key, transitionedTo: t.to?.name || flags.to, transitionId: t.id });
    }

    case "add-comment": {
      if (!flags.key) throw new Error("add-comment requires --key");
      const md = readMd(flags, "body-file", "body");
      if (!md) throw new Error("add-comment requires --body or --body-file");
      const res = await request(`${base}/rest/api/3/issue/${flags.key}/comment`, {
        method: "POST", auth, body: { body: mdToAdf(md) } });
      return ok({ key: flags.key, commentId: res.body?.id });
    }

    case "jql": {
      const jql = flags.jql || `project = ${projectKey} ORDER BY key ASC`;
      const fields = (flags.fields ? flags.fields.split(",") : ["key", "status", "summary"]).map((s) => s.trim());
      const max = Number(flags.max || 100);
      const issues = [];
      let nextPageToken;
      do {
        const body = { jql, fields, maxResults: Math.min(100, max - issues.length) };
        if (nextPageToken) body.nextPageToken = nextPageToken;
        const res = await request(`${base}/rest/api/3/search/jql`, { method: "POST", auth, body });
        for (const it of res.body?.issues || []) {
          issues.push({ key: it.key, status: it.fields?.status?.name, summary: it.fields?.summary });
        }
        nextPageToken = res.body?.nextPageToken;
      } while (nextPageToken && issues.length < max);
      return ok({ jql, count: issues.length, issues });
    }

    case "link": {
      if (!flags.inward || !flags.outward) throw new Error("link requires --inward and --outward");
      await request(`${base}/rest/api/3/issueLink`, {
        method: "POST", auth, json: false,
        body: { type: { name: flags.type || "Blocks" }, inwardIssue: { key: flags.inward }, outwardIssue: { key: flags.outward } },
      });
      return ok({ inward: flags.inward, outward: flags.outward, type: flags.type || "Blocks" });
    }

    case "delete-issue": {
      if (!flags.key) throw new Error("delete-issue requires --key");
      await request(`${base}/rest/api/3/issue/${flags.key}`, { method: "DELETE", auth, json: false });
      return ok({ key: flags.key, deleted: true });
    }

    default:
      throw new Error(`unknown subcommand '${sub || ""}'. See header for usage.`);
  }
}

run(main);
