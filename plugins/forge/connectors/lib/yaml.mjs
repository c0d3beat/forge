// yaml.mjs — tiny, vendored (zero-install) YAML *parser* for forge's config/credentials.
//
// Deliberately supports only the subset those files need:
//   • nested mappings via 2+ space indentation
//   • scalar values: string (bare or quoted), number, boolean, null (null/~/empty)
//   • full-line (`# ...`) and inline (` # ...`) comments
// NOT supported (by design): sequences/lists, multi-document, anchors/aliases,
// block scalars (| >), flow collections ({ } [ ]). Quote any value containing a
// leading `:`/`#`/quote or that should stay a literal string.
//
// Parse-only: forge never serializes YAML (machine state is state.json / JSON).

export class YamlError extends Error {
  constructor(msg) { super(msg); this.name = "YamlError"; }
}

export function parseYaml(text) {
  const records = [];
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    if (/^\s*$/.test(raw)) continue;              // blank
    if (/^\s*#/.test(raw)) continue;              // full-line comment
    const indent = raw.match(/^ */)[0].length;
    const content = stripInlineComment(raw).slice(indent).trimEnd();
    if (content === "") continue;
    const colon = content.indexOf(":");
    if (colon === -1) throw new YamlError(`line ${n + 1}: expected "key: value", got: ${content.trim()}`);
    const key = content.slice(0, colon).trim();
    const value = content.slice(colon + 1).trim();
    records.push({ indent, key, value, line: n + 1 });
  }

  const root = {};
  const stack = [{ indent: -1, container: root }];
  for (let i = 0; i < records.length; i++) {
    const { indent, key, value } = records[i];
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].container;
    if (value === "") {
      const next = records[i + 1];
      if (next && next.indent > indent) {
        const child = {};
        parent[key] = child;
        stack.push({ indent, container: child });
      } else {
        parent[key] = null; // empty leaf => null
      }
    } else {
      parent[key] = coerce(value);
    }
  }
  return root;
}

function stripInlineComment(line) {
  let inS = false, inD = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'" && !inD) inS = !inS;
    else if (c === '"' && !inS) inD = !inD;
    else if (c === "#" && !inS && !inD && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function coerce(v) {
  if (v === "" || v === "~" || /^null$/i.test(v)) return v === "" ? "" : null;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  if (/^-?\d+$/.test(v)) return parseInt(v, 10);
  if (/^-?\d+\.\d+$/.test(v)) return parseFloat(v);
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2)) {
    return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\").replace(/\\n/g, "\n");
  }
  if (v.startsWith("'") && v.endsWith("'") && v.length >= 2) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v; // bare string (URLs, keys, phrases with spaces)
}
