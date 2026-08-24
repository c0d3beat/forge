// config.mjs — locate the forge/ state directory and load config + credentials.
// Accepts YAML (config.yaml/.yml) or JSON (config.json); same for .credentials.*.
//
// Resolution order for the forge dir:
//   1. --forge-dir <path> (passed by caller) or FORGE_DIR env var
//   2. cwd itself if it is named `forge` and holds a config file
//   3. walk up from cwd looking for a `forge/` dir with a config file
//   4. fall back to <cwd>/forge
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { parseYaml } from "./yaml.mjs";

export class ConfigError extends Error {
  constructor(msg) { super(msg); this.name = "ConfigError"; }
}

const CONFIG_NAMES = ["config.yaml", "config.yml", "config.json"];
const CRED_NAMES = [".credentials.yaml", ".credentials.yml", ".credentials.json"];

function firstExisting(dir, names) {
  for (const n of names) {
    const p = join(dir, n);
    if (existsSync(p)) return p;
  }
  return null;
}

export function findForgeDir(startDir = process.cwd(), explicit = process.env.FORGE_DIR) {
  if (explicit) return resolve(explicit);

  const start = resolve(startDir);
  if (basename(start) === "forge" && firstExisting(start, CONFIG_NAMES)) return start;

  let dir = start;
  for (;;) {
    const candidate = join(dir, "forge");
    if (firstExisting(candidate, CONFIG_NAMES)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return join(start, "forge");
}

function parseFile(path, label) {
  let raw;
  try { raw = readFileSync(path, "utf8"); }
  catch (e) { throw new ConfigError(`Cannot read ${label} at ${path}: ${e.message}`); }
  if (path.endsWith(".json")) {
    try { return JSON.parse(raw); }
    catch (e) { throw new ConfigError(`Invalid JSON in ${label} at ${path}: ${e.message}`); }
  }
  try { return parseYaml(raw); }
  catch (e) { throw new ConfigError(`Invalid YAML in ${label} at ${path}: ${e.message}`); }
}

export function loadConfig({ forgeDir, requireCreds = true } = {}) {
  const dir = forgeDir ? resolve(forgeDir) : findForgeDir();

  const configPath = firstExisting(dir, CONFIG_NAMES);
  if (!configPath) {
    throw new ConfigError(
      `Missing config.(yaml|yml|json) in ${dir}. Copy the plugin's templates/config.example.yaml to forge/config.yaml and edit it.`
    );
  }
  const config = parseFile(configPath, "config");

  const credsPath = firstExisting(dir, CRED_NAMES);
  let credentials = {};
  if (credsPath) {
    credentials = parseFile(credsPath, "credentials");
  } else if (requireCreds) {
    throw new ConfigError(
      `Missing .credentials.(yaml|yml|json) in ${dir}. Copy templates/.credentials.example.yaml to forge/.credentials.yaml, fill it in, and keep it gitignored.`
    );
  }

  return { forgeDir: dir, configPath, credsPath, config, credentials };
}

// Ensure a nested section exists; returns it or throws a friendly error.
export function section(config, name) {
  if (!config || typeof config[name] !== "object" || config[name] === null) {
    throw new ConfigError(`config is missing the "${name}" section.`);
  }
  return config[name];
}

// Ensure specific keys are present (non-empty) on an object.
export function requireKeys(obj, keys, label) {
  const missing = keys.filter((k) => obj?.[k] === undefined || obj?.[k] === null || obj?.[k] === "");
  if (missing.length) throw new ConfigError(`${label} is missing required key(s): ${missing.join(", ")}`);
  return obj;
}
