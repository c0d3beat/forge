// http.mjs — zero-dependency HTTP client over Node 22's global fetch.
// Provides Basic/Bearer auth helpers, retry-with-backoff on transient failures,
// timeouts, and structured errors. No shell piping is ever needed by callers.

export function basicAuth(email, token) {
  return "Basic " + Buffer.from(`${email}:${token}`).toString("base64");
}

export function bearer(token) {
  return "Bearer " + token;
}

export class HttpError extends Error {
  constructor(message, { status, url, method, body } = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.url = url;
    this.method = method;
    this.body = body;
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Make an HTTP request.
 * @returns {Promise<{status:number, headers:object, body:any}>}
 */
export async function request(url, {
  method = "GET",
  headers = {},
  body,
  auth,                 // pre-built Authorization header value (see basicAuth/bearer)
  json = true,          // attempt to JSON-parse the response body
  retries = 3,
  backoffMs = 500,
  timeoutMs = 30000,
} = {}) {
  const finalHeaders = { Accept: "application/json", ...headers };
  if (auth) finalHeaders["Authorization"] = auth;

  let payload = body;
  if (body !== undefined && body !== null && typeof body !== "string") {
    finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
    payload = JSON.stringify(body);
  }

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers: finalHeaders, body: payload, signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      let parsed = text;
      if (json && text) {
        try { parsed = JSON.parse(text); } catch { /* keep raw text */ }
      }
      if (!res.ok) {
        if (RETRYABLE.has(res.status) && attempt < retries) {
          await sleep(backoffMs * 2 ** attempt);
          attempt++;
          continue;
        }
        throw new HttpError(`HTTP ${res.status} ${method} ${redact(url)}`, {
          status: res.status,
          url: redact(url),
          method,
          body: typeof parsed === "string" ? parsed.slice(0, 500) : parsed,
        });
      }
      return { status: res.status, headers: Object.fromEntries(res.headers), body: parsed };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof HttpError) throw err;
      // Network error or abort/timeout — retry, then surface.
      if (attempt < retries) {
        await sleep(backoffMs * 2 ** attempt);
        attempt++;
        continue;
      }
      throw new HttpError(`Network error ${method} ${redact(url)}: ${err.message}`, { url: redact(url), method });
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Strip query string (may carry tokens) from error/log output; keep origin+path.
function redact(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return String(url);
  }
}
