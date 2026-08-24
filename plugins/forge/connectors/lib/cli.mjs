// cli.mjs — consistent structured output + arg parsing for forge connectors.
// Connectors always emit a single JSON object on stdout (so the agent can parse
// it) and set a non-zero exit code on failure.
import { parseArgs } from "node:util";

export function emit(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

export function ok(data = {}) {
  emit({ ok: true, ...data });
}

export function fail(error, extra = {}) {
  const message = error && error.message ? error.message : String(error);
  const out = { ok: false, error: message, ...extra };
  if (error && error.status) out.status = error.status;
  emit(out);
  process.exitCode = 1;
}

// Wrap an async main so any throw becomes structured failure output.
export async function run(main) {
  try {
    await main();
  } catch (err) {
    fail(err);
  }
}

// Thin wrapper over node:util parseArgs with our conventions.
export function args(options = {}) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options,
    args: process.argv.slice(2),
  });
  return { flags: values, positionals };
}
