// stories.mjs — turn the approved User Stories (Work Orders) artifact into JIRA epics + stories.
//
//   parse   --file 05-user-stories.md              structured JSON (offline; no JIRA)
//   publish --file 05-user-stories.md              idempotently create epics, stories, and
//                                                   dependency links in JIRA; record the
//                                                   WO/EPIC -> jiraKey map in forge/state.json
//
// Idempotent: anything already mapped in state is skipped, so re-runs (and /forge:revise's
// add-only stories) only create what's new. Reuses the validated jira.mjs connector.
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { findForgeDir } from "./lib/config.mjs";
import { loadState, saveState } from "./lib/state.mjs";
import { parseWorkOrders, storyDescriptionMd } from "./lib/wo.mjs";
import { args, ok, run } from "./lib/cli.mjs";

const JIRA = fileURLToPath(new URL("./jira.mjs", import.meta.url));

function jira(forgeDir, sub, extra) {
  let out;
  try {
    out = execFileSync("node", [JIRA, sub, "--forge-dir", forgeDir, ...extra], { stdio: ["ignore", "pipe", "pipe"] }).toString();
  } catch (e) {
    out = e.stdout?.toString?.() || "";
    if (!out) throw new Error(`jira ${sub} crashed: ${(e.stderr?.toString?.() || e.message || "").slice(-200)}`);
  }
  let j; try { j = JSON.parse(out); } catch { throw new Error(`jira ${sub} returned non-JSON: ${out.slice(-200)}`); }
  if (!j.ok) throw new Error(`jira ${sub} failed: ${j.error}`);
  return j;
}

async function main() {
  const { positionals, flags } = args({ "forge-dir": { type: "string" }, file: { type: "string" } });
  const sub = positionals[0];
  const forgeDir = flags["forge-dir"] || findForgeDir();
  if (!flags.file) throw new Error("--file <user-stories.md> is required");
  const parsed = parseWorkOrders(readFileSync(flags.file, "utf8"));

  if (sub === "parse") {
    return ok({
      epics: parsed.epics,
      storyCount: parsed.stories.length,
      stories: parsed.stories.map((s) => ({ wo: s.wo, title: s.title, epic: s.epic, priority: s.priority, dependsOn: s.dependsOn })),
    });
  }

  if (sub === "publish") {
    const state = loadState(forgeDir);
    state.epics = state.epics || [];
    state.stories = state.stories || [];
    const epicKey = Object.fromEntries(state.epics.map((e) => [e.epic, e.jiraKey]));
    const woKey = Object.fromEntries(state.stories.map((s) => [s.wo, s.jiraKey]));
    const created = { epics: 0, stories: 0, links: 0 };
    const skipped = { epics: 0, stories: 0 };

    // Epics
    for (const e of parsed.epics) {
      if (epicKey[e.epic]) { skipped.epics++; continue; }
      const r = jira(forgeDir, "create-epic", ["--name", e.name]);
      epicKey[e.epic] = r.key;
      state.epics.push({ epic: e.epic, jiraKey: r.key, name: e.name });
      saveState(forgeDir, state);
      created.epics++;
    }

    // Stories
    const tmp = mkdtempSync(join(tmpdir(), "forge-wo-"));
    for (const s of parsed.stories) {
      if (woKey[s.wo]) { skipped.stories++; continue; }
      const descPath = join(tmp, `${s.wo}.md`);
      writeFileSync(descPath, storyDescriptionMd(s));
      const extra = ["--summary", s.title, "--desc-file", descPath];
      if (s.epic && epicKey[s.epic]) extra.push("--epic-key", epicKey[s.epic]);
      const labels = s.labels.filter(Boolean).join(",");
      if (labels) extra.push("--labels", labels);
      if (s.storyPoints && /^\d+/.test(s.storyPoints)) extra.push("--points", String(parseInt(s.storyPoints, 10)));
      const r = jira(forgeDir, "create-issue", extra);
      woKey[s.wo] = r.key;
      state.stories.push({ wo: s.wo, jiraKey: r.key, epic: s.epic, title: s.title, status: "To Do", dependsOn: s.dependsOn, dependsLinked: false, prNumber: null, branch: null });
      saveState(forgeDir, state);
      created.stories++;
    }

    // Dependency links (dep Blocks this). Best-effort; tracked per story to avoid duplicates.
    for (const st of state.stories) {
      if (st.dependsLinked) continue;
      const deps = (st.dependsOn || []).filter((d) => woKey[d]);
      let allOk = true;
      for (const dep of deps) {
        try { jira(forgeDir, "link", ["--inward", woKey[dep], "--outward", st.jiraKey, "--type", "Blocks"]); created.links++; }
        catch { allOk = false; }
      }
      if ((st.dependsOn || []).length === 0 || (allOk && deps.length === (st.dependsOn || []).length)) {
        st.dependsLinked = true;
        saveState(forgeDir, state);
      }
    }

    return ok({ created, skipped, totalEpics: state.epics.length, totalStories: state.stories.length });
  }

  throw new Error(`unknown subcommand '${sub || ""}'. Use parse|publish.`);
}

run(main);
