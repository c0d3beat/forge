// confluence.mjs — Confluence Cloud connector (REST v2 + v1 for labels).
//
// Subcommands:
//   resolve-space   --space-key KEY
//   get-page        (--id ID | --title T [--space-key KEY])
//   create-page     --title T [--space-key KEY] [--parent-id ID] (--body-file f | --body md | --storage xhtml)
//   update-page     --id ID [--title T] (--body-file f | --body md | --storage xhtml) [--message m]
//   upsert-page     --title T [--space-key KEY] [--parent-id ID] (--body-file f | --body md | --storage xhtml)
//   publish-artifact --title T [--parent-id ID] --body-file f    (md->storage + renders/uploads mermaid fences as PNG attachments)
//   upload-attachment --id ID --file PATH [--name NAME]
//   add-label       --id ID --label NAME            (v1 endpoint; v2 has no add-label)
//   get-labels      --id ID
//   get-comments    --id ID                          (footer comments, text-flattened)
//   approval-status --id ID                          (reads approved/changes labels + comment count)
//   delete-page     --id ID
//
// Auth: Basic (Atlassian email + API token) from forge/.credentials.json.
// Config: confluence.baseUrl (must end with /wiki for Cloud), confluence.spaceKey, approval.*
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, section } from "./lib/config.mjs";
import { basicAuth, request } from "./lib/http.mjs";
import { mdToStorage, listMermaid } from "./lib/md.mjs";
import { args, ok, run } from "./lib/cli.mjs";

const OPTIONS = {
  "forge-dir": { type: "string" },
  "space-key": { type: "string" },
  title: { type: "string" },
  id: { type: "string" },
  "parent-id": { type: "string" },
  body: { type: "string" },
  "body-file": { type: "string" },
  storage: { type: "string" },
  label: { type: "string" },
  message: { type: "string" },
  file: { type: "string" },
  name: { type: "string" },
};

function ctx(flags) {
  const { config, credentials } = loadConfig({ forgeDir: flags["forge-dir"], requireCreds: true });
  const c = section(config, "confluence");
  const email = credentials?.atlassian?.email;
  const token = credentials?.atlassian?.apiToken;
  if (!email || !token) throw new Error("credentials.atlassian.email/apiToken not set");
  return { config, c, base: String(c.baseUrl).replace(/\/$/, ""), auth: basicAuth(email, token) };
}

function bodyStorage(flags) {
  if (flags.storage !== undefined) return flags.storage;
  let md = flags.body;
  if (flags["body-file"]) md = readFileSync(flags["body-file"], "utf8");
  if (md === undefined) throw new Error("provide --body-file <path.md>, --body <md>, or --storage <xhtml>");
  return mdToStorage(md);
}

async function resolveSpaceId(base, auth, key) {
  const res = await request(`${base}/api/v2/spaces?keys=${encodeURIComponent(key)}`, { auth });
  const s = res.body?.results?.[0];
  if (!s) throw new Error(`Confluence space '${key}' not found`);
  return s.id;
}

async function getPageById(base, auth, id) {
  const res = await request(`${base}/api/v2/pages/${id}?body-format=storage`, { auth });
  return res.body;
}

async function findPageByTitle(base, auth, spaceId, title) {
  const res = await request(
    `${base}/api/v2/pages?space-id=${spaceId}&title=${encodeURIComponent(title)}&status=current`, { auth });
  return res.body?.results?.[0] || null;
}

async function createPage({ base, auth }, { spaceId, title, parentId, value }) {
  const payload = { spaceId: String(spaceId), status: "current", title, body: { representation: "storage", value } };
  if (parentId) payload.parentId = String(parentId);
  const res = await request(`${base}/api/v2/pages`, { method: "POST", auth, body: payload });
  return res.body;
}

async function updatePage({ base, auth }, { id, title, value, message }) {
  const cur = await getPageById(base, auth, id);
  const payload = {
    id: String(id), status: "current", title: title || cur.title,
    body: { representation: "storage", value },
    version: { number: (cur.version?.number || 0) + 1, message: message || "forge update" },
  };
  const res = await request(`${base}/api/v2/pages/${id}`, { method: "PUT", auth, body: payload });
  return res.body;
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
}

// Create-or-update a page attachment (multipart; bypasses the JSON http wrapper).
async function uploadAttachment(base, auth, pageId, filePath, name) {
  const list = await request(
    `${base}/rest/api/content/${pageId}/child/attachment?filename=${encodeURIComponent(name)}`, { auth });
  const existing = list.body?.results?.[0];
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), name);
  form.append("minorEdit", "true");
  const url = existing
    ? `${base}/rest/api/content/${pageId}/child/attachment/${existing.id}/data`
    : `${base}/rest/api/content/${pageId}/child/attachment`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "X-Atlassian-Token": "no-check", Accept: "application/json" },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`attachment '${name}' upload failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  return { name, action: existing ? "updated" : "created" };
}

// Render one mermaid diagram to PNG via the sibling mermaid.mjs connector.
function renderMermaidToPng(code, outPath) {
  const mermaidCli = fileURLToPath(new URL("./mermaid.mjs", import.meta.url));
  const work = mkdtempSync(join(tmpdir(), "forge-mmd-src-"));
  const src = join(work, "d.mmd");
  writeFileSync(src, code, "utf8");
  execFileSync("node", [mermaidCli, "render", "--code-file", src, "--out", outPath], { stdio: "pipe" });
}

async function main() {
  const { positionals, flags } = args(OPTIONS);
  const sub = positionals[0];
  const x = ctx(flags);
  const { base, auth, c, config } = x;

  switch (sub) {
    case "resolve-space": {
      const id = await resolveSpaceId(base, auth, flags["space-key"] || c.spaceKey);
      return ok({ spaceKey: flags["space-key"] || c.spaceKey, spaceId: id });
    }
    case "get-page": {
      if (flags.id) {
        const p = await getPageById(base, auth, flags.id);
        return ok({ exists: true, id: p.id, title: p.title, version: p.version?.number });
      }
      const spaceId = await resolveSpaceId(base, auth, flags["space-key"] || c.spaceKey);
      const p = await findPageByTitle(base, auth, spaceId, flags.title);
      return ok(p ? { exists: true, id: p.id, title: p.title, version: p.version?.number } : { exists: false });
    }
    case "create-page": {
      const spaceId = await resolveSpaceId(base, auth, flags["space-key"] || c.spaceKey);
      const p = await createPage(x, {
        spaceId, title: flags.title, parentId: flags["parent-id"] || c.parentPageId, value: bodyStorage(flags),
      });
      return ok({ id: p.id, title: p.title, version: p.version?.number });
    }
    case "update-page": {
      if (!flags.id) throw new Error("update-page requires --id");
      const p = await updatePage(x, { id: flags.id, title: flags.title, value: bodyStorage(flags), message: flags.message });
      return ok({ id: p.id, title: p.title, version: p.version?.number });
    }
    case "upsert-page": {
      const spaceId = await resolveSpaceId(base, auth, flags["space-key"] || c.spaceKey);
      const existing = await findPageByTitle(base, auth, spaceId, flags.title);
      const value = bodyStorage(flags);
      if (existing) {
        const p = await updatePage(x, { id: existing.id, title: flags.title, value, message: flags.message });
        return ok({ action: "updated", id: p.id, title: p.title, version: p.version?.number });
      }
      const p = await createPage(x, { spaceId, title: flags.title, parentId: flags["parent-id"] || c.parentPageId, value });
      return ok({ action: "created", id: p.id, title: p.title, version: p.version?.number });
    }
    case "add-label": {
      if (!flags.id || !flags.label) throw new Error("add-label requires --id and --label");
      await request(`${base}/rest/api/content/${flags.id}/label`, {
        method: "POST", auth, body: [{ prefix: "global", name: flags.label }],
      });
      return ok({ id: flags.id, label: flags.label });
    }
    case "get-labels": {
      if (!flags.id) throw new Error("get-labels requires --id");
      const res = await request(`${base}/api/v2/pages/${flags.id}/labels`, { auth });
      return ok({ id: flags.id, labels: (res.body?.results || []).map((l) => l.name) });
    }
    case "get-comments": {
      if (!flags.id) throw new Error("get-comments requires --id");
      const res = await request(`${base}/api/v2/pages/${flags.id}/footer-comments?body-format=storage`, { auth });
      const comments = (res.body?.results || []).map((cm) => ({
        id: cm.id, version: cm.version?.number, text: stripTags(cm.body?.storage?.value || ""),
      }));
      return ok({ id: flags.id, count: comments.length, comments });
    }
    case "approval-status": {
      if (!flags.id) throw new Error("approval-status requires --id");
      const appr = config.approval || {};
      const approvedLabel = appr.approvedLabel || "forge-approved";
      const changesLabel = appr.changesLabel || "forge-changes-requested";
      const labelsRes = await request(`${base}/api/v2/pages/${flags.id}/labels`, { auth });
      const labels = (labelsRes.body?.results || []).map((l) => l.name);
      const commentsRes = await request(`${base}/api/v2/pages/${flags.id}/footer-comments`, { auth });
      const commentCount = (commentsRes.body?.results || []).length;
      const approved = labels.includes(approvedLabel);
      const changesRequested = labels.includes(changesLabel);
      // Gate verdict: approved wins; else changes-requested or any comments => revise; else pending.
      const verdict = approved ? "approved" : (changesRequested || commentCount > 0 ? "changes-requested" : "pending");
      return ok({ id: flags.id, verdict, approved, changesRequested, commentCount, labels });
    }
    case "upload-attachment": {
      if (!flags.id || !flags.file) throw new Error("upload-attachment requires --id and --file");
      const name = flags.name || flags.file.split("/").pop();
      const r = await uploadAttachment(base, auth, flags.id, flags.file, name);
      return ok({ id: flags.id, ...r });
    }
    case "publish-artifact": {
      if (!flags.title || !flags["body-file"]) throw new Error("publish-artifact requires --title and --body-file");
      const md = readFileSync(flags["body-file"], "utf8");
      const mermaids = listMermaid(md);
      const useImages = mermaids.length > 0;
      const value = mdToStorage(md, useImages ? { mermaid: "image", mermaidPrefix: "diagram" } : {});
      const spaceId = await resolveSpaceId(base, auth, flags["space-key"] || c.spaceKey);
      const existing = await findPageByTitle(base, auth, spaceId, flags.title);
      const page = existing
        ? await updatePage(x, { id: existing.id, title: flags.title, value, message: flags.message })
        : await createPage(x, { spaceId, title: flags.title, parentId: flags["parent-id"] || c.parentPageId, value });
      const attachments = [];
      if (useImages) {
        const work = mkdtempSync(join(tmpdir(), "forge-diagrams-"));
        for (let i = 0; i < mermaids.length; i++) {
          const png = join(work, `diagram-${i}.png`);
          renderMermaidToPng(mermaids[i], png);
          await uploadAttachment(base, auth, page.id, png, `diagram-${i}.png`);
          attachments.push(`diagram-${i}.png`);
        }
      }
      return ok({ action: existing ? "updated" : "created", id: page.id, title: page.title, version: page.version?.number, diagrams: attachments.length, attachments });
    }
    case "delete-page": {
      if (!flags.id) throw new Error("delete-page requires --id");
      await request(`${base}/api/v2/pages/${flags.id}`, { method: "DELETE", auth, json: false });
      return ok({ id: flags.id, deleted: true });
    }
    default:
      throw new Error(`unknown subcommand '${sub || ""}'. See header for usage.`);
  }
}

run(main);
