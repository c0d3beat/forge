// screenshot.mjs — render a self-contained HTML file to a FULL-PAGE PNG via headless Chrome,
// driven over the Chrome DevTools Protocol (CDP) using Node 22's global WebSocket (no install).
// Measures the page's content height so nothing is clipped, and captures beyond the viewport.
// Reuses an already-installed Chrome/Chromium. Used by the UI Design phase for prototype shots.
//
// Usage: node screenshot.mjs render --html-file page.html --out shot.png
//        [--width 390] [--scale 2] [--wait-ms 1200] [--max-height 6000] [--chrome /path]
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { args, ok, run } from "./lib/cli.mjs";

const CHROME_CANDIDATES = [
  process.env.PUPPETEER_EXECUTABLE_PATH, process.env.CHROME_PATH,
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
].filter(Boolean);
const findChrome = (explicit) => [explicit, ...CHROME_CANDIDATES].find((p) => p && existsSync(p)) || null;

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method) {
        (this.handlers.get(m.method) || []).forEach((fn) => fn(m.params));
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id; const msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    return new Promise((res, rej) => { this.pending.set(id, { res, rej }); this.ws.send(JSON.stringify(msg)); });
  }
  on(method, fn) { const a = this.handlers.get(method) || []; a.push(fn); this.handlers.set(method, a); }
}

async function main() {
  const { flags } = args({
    "html-file": { type: "string" }, out: { type: "string" }, width: { type: "string" },
    scale: { type: "string" }, "wait-ms": { type: "string" }, "max-height": { type: "string" }, chrome: { type: "string" },
  });
  if (!flags["html-file"]) throw new Error("render requires --html-file <file.html>");
  if (!flags.out) throw new Error("render requires --out <file.png>");
  const html = resolve(flags["html-file"]);
  if (!existsSync(html)) throw new Error(`html file not found: ${html}`);
  const chrome = findChrome(flags.chrome);
  if (!chrome) throw new Error("no Chrome/Chromium found; set --chrome or CHROME_PATH");

  const width = Number(flags.width || 390);
  const scale = Number(flags.scale || 2);
  const waitMs = Number(flags["wait-ms"] || 1200);
  const maxHeight = Number(flags["max-height"] || 6000);
  const mobile = width <= 500;
  const port = 9222 + Math.floor(Math.random() * 2000);

  const proc = spawn(chrome, [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars",
    "--no-first-run", "--no-default-browser-check", "--disable-extensions",
    `--remote-debugging-port=${port}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });

  let ws;
  try {
    // Wait for the DevTools HTTP endpoint, then grab the browser websocket.
    let browserWs;
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (r.ok) { browserWs = (await r.json()).webSocketDebuggerUrl; break; }
      } catch { /* not up yet */ }
      await sleep(100);
    }
    if (!browserWs) throw new Error("Chrome DevTools endpoint did not become ready");

    ws = new WebSocket(browserWs);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", () => rej(new Error("failed to connect to Chrome DevTools websocket")), { once: true });
    });
    const cdp = new CDP(ws);

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    // Start with a tall viewport so nothing is clipped; we crop to the real content height after.
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width, height: maxHeight, deviceScaleFactor: scale, mobile }, sessionId);

    const loaded = new Promise((res) => cdp.on("Page.loadEventFired", res));
    await cdp.send("Page.navigate", { url: `file://${html}` }, sessionId);
    await Promise.race([loaded, sleep(8000)]);
    await sleep(waitMs);

    // True content height = the body's rendered height (avoids scrollHeight/viewport clamping).
    const evalRes = await cdp.send("Runtime.evaluate", {
      expression: "Math.ceil(document.body.getBoundingClientRect().height)", returnByValue: true,
    }, sessionId);
    const contentH = Math.max(1, Math.min(maxHeight, evalRes.result?.value || 0));

    const shot = await cdp.send("Page.captureScreenshot", {
      format: "png", captureBeyondViewport: true,
      clip: { x: 0, y: 0, width, height: contentH, scale: 1 },
    }, sessionId);
    writeFileSync(flags.out, Buffer.from(shot.data, "base64"));
    return ok({ out: flags.out, width, height: contentH, scale, chrome });
  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    try { proc.kill(); } catch { /* ignore */ }
  }
}

run(main);
