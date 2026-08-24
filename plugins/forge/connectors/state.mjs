// state.mjs — CLI over lib/state.mjs: scaffold forge/ and drive the phase state machine.
// The /forge:init skill calls these for deterministic, structured state mutations
// (the LLM handles artifact authoring + the clarify loop; state changes stay here).
//
// Subcommands:
//   scaffold        [--plugin-root DIR]   create forge/{artifacts,versions}/ + state.json;
//                                          if --plugin-root given, also seed config.yaml/.credentials.yaml
//                                          from templates (only if absent) and wire .gitignore
//   show                                   print full state.json (default state if none yet)
//   current-phase                          print the first non-approved phase
//   set-project     --name N [--parent-id P]
//   set-phase       --key K [--status s] [--page-id p] [--conf-version n]
//                   [--artifact-version m] [--confidence c] [--uuid u] [--published]
//   set-mode        --mode init|build|revise
//   --- /forge:revise ---
//   start-revision  --summary "..."        open a revision (mode->revise, cursor at phase 1)
//   revision-cursor                        the in-progress revision + the phase at its cursor
//   advance-cursor                         move the cursor to the next phase (done past 7)
//   mark-touched    --key K                record that this revision changed phase K
//   snapshot        --key K                copy artifacts/NN-K.md -> versions/NN-K-v<artifactVersion>.md
//   complete-revision                      close the revision (mode->build)
import { existsSync, mkdirSync, copyFileSync, readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { findForgeDir } from "./lib/config.mjs";
import { loadState, saveState, defaultState, currentPhase, phaseByKey, phaseById, currentRevision, PHASES } from "./lib/state.mjs";
import { args, ok, run } from "./lib/cli.mjs";

const OPTIONS = {
  "forge-dir": { type: "string" },
  "plugin-root": { type: "string" },
  key: { type: "string" },
  status: { type: "string" },
  "page-id": { type: "string" },
  "conf-version": { type: "string" },
  "artifact-version": { type: "string" },
  confidence: { type: "string" },
  uuid: { type: "string" },
  published: { type: "boolean" },
  mode: { type: "string" },
  name: { type: "string" },
  "parent-id": { type: "string" },
  summary: { type: "string" },
};

const VALID_STATUS = ["pending", "drafting", "in_review", "approved"];
const VALID_MODE = ["init", "build", "revise"];

function resolveForgeDir(flags) {
  return flags["forge-dir"] ? flags["forge-dir"] : findForgeDir();
}

function ensureGitignore(projectRoot) {
  const gi = join(projectRoot, ".gitignore");
  const needed = ["forge/.credentials.yaml", "forge/.credentials.yml", "forge/.credentials.json"];
  let existing = existsSync(gi) ? readFileSync(gi, "utf8") : "";
  const missing = needed.filter((line) => !existing.split(/\r?\n/).includes(line));
  if (missing.length) {
    const block = (existing && !existing.endsWith("\n") ? "\n" : "") +
      "\n# forge secrets — never commit\n" + missing.join("\n") + "\n";
    appendFileSync(gi, block, "utf8");
  }
  return missing;
}

function main() {
  const { positionals, flags } = args(OPTIONS);
  const sub = positionals[0];
  const forgeDir = resolveForgeDir(flags);

  switch (sub) {
    case "scaffold": {
      mkdirSync(join(forgeDir, "artifacts"), { recursive: true });
      mkdirSync(join(forgeDir, "versions"), { recursive: true });
      const created = [];
      const sp = join(forgeDir, "state.json");
      if (!existsSync(sp)) { saveState(forgeDir, defaultState()); created.push("state.json"); }

      let seeded = [];
      let gitignoreAdded = [];
      if (flags["plugin-root"]) {
        const tpl = join(flags["plugin-root"], "templates");
        const seeds = [
          ["config.example.yaml", "config.yaml"],
          [".credentials.example.yaml", ".credentials.yaml"],
        ];
        for (const [from, to] of seeds) {
          const dst = join(forgeDir, to);
          const src = join(tpl, from);
          // don't overwrite; don't seed config if any config.* already present
          const anyConfig = ["config.yaml", "config.yml", "config.json"].some((n) => existsSync(join(forgeDir, n)));
          const anyCreds = [".credentials.yaml", ".credentials.yml", ".credentials.json"].some((n) => existsSync(join(forgeDir, n)));
          const skip = (to === "config.yaml" && anyConfig) || (to === ".credentials.yaml" && anyCreds);
          if (!skip && existsSync(src) && !existsSync(dst)) { copyFileSync(src, dst); seeded.push(to); }
        }
        gitignoreAdded = ensureGitignore(dirname(forgeDir));
      }
      return ok({ forgeDir, created, seeded, gitignoreAdded, phases: PHASES.map((p) => p.key) });
    }

    case "show":
      return ok({ forgeDir, state: loadState(forgeDir) });

    case "current-phase": {
      const ph = currentPhase(loadState(forgeDir));
      return ok({ forgeDir, currentPhase: ph });
    }

    case "set-project": {
      const state = loadState(forgeDir);
      if (flags.name) state.project.name = flags.name;
      if (flags["parent-id"] !== undefined) state.project.confluenceParentPageId = flags["parent-id"];
      saveState(forgeDir, state);
      return ok({ project: state.project });
    }

    case "set-phase": {
      if (!flags.key) throw new Error("set-phase requires --key");
      const state = loadState(forgeDir);
      const ph = phaseByKey(state, flags.key);
      if (!ph) throw new Error(`unknown phase key '${flags.key}'. Valid: ${PHASES.map((p) => p.key).join(", ")}`);
      if (flags.status) {
        if (!VALID_STATUS.includes(flags.status)) throw new Error(`invalid --status. Valid: ${VALID_STATUS.join(", ")}`);
        ph.status = flags.status;
      }
      if (flags["page-id"] !== undefined) ph.confluencePageId = flags["page-id"];
      if (flags["conf-version"] !== undefined) ph.confluenceVersion = Number(flags["conf-version"]);
      if (flags["artifact-version"] !== undefined) ph.artifactVersion = Number(flags["artifact-version"]);
      if (flags.confidence !== undefined) ph.confidence = Number(flags.confidence);
      if (flags.uuid !== undefined) ph.artifactUuid = flags.uuid;
      if (flags.published) ph.lastPublishedAt = new Date().toISOString();
      saveState(forgeDir, state);
      return ok({ phase: ph });
    }

    case "set-mode": {
      if (!VALID_MODE.includes(flags.mode)) throw new Error(`--mode must be one of: ${VALID_MODE.join(", ")}`);
      const state = loadState(forgeDir);
      state.mode = flags.mode;
      saveState(forgeDir, state);
      return ok({ mode: state.mode });
    }

    case "start-revision": {
      if (!flags.summary) throw new Error("start-revision requires --summary");
      const state = loadState(forgeDir);
      state.revisions = state.revisions || [];
      if (state.revisions.some((r) => r.status === "in_progress"))
        throw new Error("a revision is already in progress — resume it instead of starting a new one");
      const rev = {
        version: state.revisions.length + 1,
        date: new Date().toISOString(),
        summary: flags.summary,
        status: "in_progress",
        cursorPhaseId: 1,
        touched: [],
      };
      state.revisions.push(rev);
      state.mode = "revise";
      saveState(forgeDir, state);
      return ok({ revision: rev, mode: state.mode });
    }

    case "revision-cursor": {
      const state = loadState(forgeDir);
      const rev = currentRevision(state);
      if (!rev) return ok({ revision: null, cursorPhase: null });
      const cursorPhase = rev.cursorPhaseId <= PHASES.length ? phaseById(state, rev.cursorPhaseId) : null;
      return ok({ revision: rev, cursorPhase, done: cursorPhase === null });
    }

    case "advance-cursor": {
      const state = loadState(forgeDir);
      const rev = currentRevision(state);
      if (!rev) throw new Error("no revision in progress");
      rev.cursorPhaseId += 1;
      saveState(forgeDir, state);
      const done = rev.cursorPhaseId > PHASES.length;
      return ok({ cursorPhaseId: rev.cursorPhaseId, done, cursorPhase: done ? null : phaseById(state, rev.cursorPhaseId) });
    }

    case "mark-touched": {
      if (!flags.key) throw new Error("mark-touched requires --key");
      const state = loadState(forgeDir);
      const rev = currentRevision(state);
      if (!rev) throw new Error("no revision in progress");
      if (!phaseByKey(state, flags.key)) throw new Error(`unknown phase key '${flags.key}'. Valid: ${PHASES.map((p) => p.key).join(", ")}`);
      rev.touched = rev.touched || [];
      if (!rev.touched.includes(flags.key)) rev.touched.push(flags.key);
      saveState(forgeDir, state);
      return ok({ touched: rev.touched });
    }

    case "snapshot": {
      if (!flags.key) throw new Error("snapshot requires --key");
      const state = loadState(forgeDir);
      const ph = phaseByKey(state, flags.key);
      if (!ph) throw new Error(`unknown phase key '${flags.key}'. Valid: ${PHASES.map((p) => p.key).join(", ")}`);
      const nn = String(ph.id).padStart(2, "0");
      const src = join(forgeDir, "artifacts", `${nn}-${ph.key}.md`);
      if (!existsSync(src)) throw new Error(`artifact not found: ${src}`);
      mkdirSync(join(forgeDir, "versions"), { recursive: true });
      const v = ph.artifactVersion || 1;
      const dst = join(forgeDir, "versions", `${nn}-${ph.key}-v${v}.md`);
      copyFileSync(src, dst);
      return ok({ snapshot: dst, version: v });
    }

    case "complete-revision": {
      const state = loadState(forgeDir);
      const rev = currentRevision(state);
      if (!rev) throw new Error("no revision in progress");
      rev.status = "complete";
      rev.completedAt = new Date().toISOString();
      state.mode = "build";
      saveState(forgeDir, state);
      return ok({ revision: rev, mode: state.mode });
    }

    case "new-uuid":
      return ok({ uuid: randomUUID() });

    default:
      throw new Error(`unknown subcommand '${sub || ""}'. See header for usage.`);
  }
}

run(main);
