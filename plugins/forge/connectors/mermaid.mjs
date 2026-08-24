// mermaid.mjs — render a Mermaid diagram to PNG using @mermaid-js/mermaid-cli (via npx),
// reusing an already-installed Chrome/Chromium (no Chromium download).
//
// Usage: node mermaid.mjs render (--code-file f.mmd | --code "graph TD; A-->B") --out out.png
//        [--background white] [--scale 2] [--chrome /path/to/chrome]
import { writeFileSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { args, ok, run } from "./lib/cli.mjs";

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH,
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
].filter(Boolean);

function findChrome(explicit) {
  for (const p of [explicit, ...CHROME_CANDIDATES]) {
    if (p && existsSync(p)) return p;
  }
  return null; // fall back to puppeteer's own resolution
}

async function main() {
  const { flags } = args({
    "code-file": { type: "string" },
    code: { type: "string" },
    out: { type: "string" },
    background: { type: "string" },
    scale: { type: "string" },
    chrome: { type: "string" },
  });
  if (!flags.out) throw new Error("render requires --out <file.png>");
  let mmd = flags.code;
  if (flags["code-file"]) mmd = readFileSync(flags["code-file"], "utf8");
  if (!mmd) throw new Error("provide --code-file <file.mmd> or --code <text>");

  const work = mkdtempSync(join(tmpdir(), "forge-mmd-"));
  const inPath = join(work, "in.mmd");
  const cfgPath = join(work, "puppeteer.json");
  writeFileSync(inPath, mmd, "utf8");
  writeFileSync(cfgPath, JSON.stringify({ args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"] }));

  const chrome = findChrome(flags.chrome);
  const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1" };
  if (chrome) env.PUPPETEER_EXECUTABLE_PATH = chrome;

  const cliArgs = ["-y", "@mermaid-js/mermaid-cli", "-i", inPath, "-o", flags.out,
    "-p", cfgPath, "-b", flags.background || "white"];
  if (flags.scale) cliArgs.push("-s", flags.scale);

  try {
    execFileSync("npx", cliArgs, { env, stdio: "pipe" });
  } catch (e) {
    const detail = (e.stderr?.toString?.() || e.stdout?.toString?.() || e.message || "").slice(-800);
    throw new Error(`mermaid render failed: ${detail.split("\n").slice(-4).join(" | ")}`);
  }
  if (!existsSync(flags.out)) throw new Error("mermaid render produced no output file");
  return ok({ out: flags.out, chrome: chrome || "(puppeteer default)" });
}

run(main);
