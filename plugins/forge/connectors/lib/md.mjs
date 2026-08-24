// md.mjs — pragmatic Markdown → Confluence storage (XHTML) and Markdown → JIRA ADF.
//
// Scope: the block/inline constructs forge's own artifacts emit — headings, paragraphs,
// bold/italic/code/links, ordered+unordered (nestable) lists, GFM tables, fenced code,
// blockquotes, horizontal rules. Not a full CommonMark implementation; deterministic and
// dependency-free. Mermaid fences are recognized so the Confluence connector can swap them
// for rendered-image attachments later; until then they render as a code block.

// ---------- block parser ----------

export function parseBlocks(md) {
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const lang = fence[1].trim();
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      blocks.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { blocks.push({ type: "heading", level: h[1].length, text: h[2].trim() }); i++; continue; }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push({ type: "hr" }); i++; continue; }

    // GFM table: a row with pipes followed by a separator row (---|---)
    if (line.includes("|") && i + 1 < lines.length &&
        lines[i + 1].includes("|") && /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i])); i++;
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      blocks.push({ type: "blockquote", text: buf.join("\n") });
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const parsed = parseList(lines, i);
      blocks.push({ type: "list", ordered: parsed.ordered, items: parsed.items });
      i = parsed.consumed;
      continue;
    }

    // paragraph: gather until blank or a new block starts
    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isBlockStart(lines[i])) { buf.push(lines[i]); i++; }
    blocks.push({ type: "para", text: buf.join(" ").trim() });
  }
  return blocks;
}

function isBlockStart(line) {
  return /^(#{1,6})\s/.test(line) || /^```/.test(line) ||
    /^\s*([-*_])(\s*\1){2,}\s*$/.test(line) ||
    /^\s*([-*+]|\d+\.)\s+/.test(line) || /^\s*>\s?/.test(line);
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function indentOf(s) { return (s.match(/^(\s*)/)[1] || "").length; }

function parseList(lines, start) {
  const baseIndent = indentOf(lines[start]);
  const ordered = /^\s*\d+\.\s+/.test(lines[start]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) break;
    const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (!m) break;
    const ind = m[1].length;
    if (ind < baseIndent) break;
    if (ind >= baseIndent + 2) { // nested list — attach to previous item
      const sub = parseList(lines, i);
      if (items.length) items[items.length - 1].children.push({ type: "list", ordered: sub.ordered, items: sub.items });
      i = sub.consumed;
      continue;
    }
    items.push({ text: m[3].trim(), children: [] });
    i++;
  }
  return { items, ordered, consumed: i };
}

// ---------- inline parser ----------

export function parseInline(text) {
  const nodes = [];
  let rest = String(text);
  const re = /(!\[[^\]]*\]\([^)]+\))|(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/;
  while (rest) {
    const m = re.exec(rest);
    if (!m) { nodes.push({ t: "text", v: rest }); break; }
    if (m.index > 0) nodes.push({ t: "text", v: rest.slice(0, m.index) });
    const tok = m[0];
    if (tok.startsWith("![")) {
      const mm = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(tok);
      nodes.push({ t: "image", alt: mm[1], src: mm[2] });
    } else if (tok.startsWith("`")) nodes.push({ t: "code", v: tok.slice(1, -1) });
    else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      nodes.push({ t: "link", href: mm[2], children: parseInline(mm[1]) });
    } else if (tok.startsWith("**")) nodes.push({ t: "strong", children: parseInline(tok.slice(2, -2)) });
    else if (tok.startsWith("*")) nodes.push({ t: "em", children: parseInline(tok.slice(1, -1)) });
    else if (tok.startsWith("_")) nodes.push({ t: "em", children: parseInline(tok.slice(1, -1)) });
    rest = rest.slice(m.index + tok.length);
  }
  return nodes;
}

// ---------- Confluence storage (XHTML) renderer ----------

export function mdToStorage(md, { mermaid = "code", mermaidPrefix = "diagram" } = {}) {
  // mermaid: 'code' -> render fences as a Confluence code macro; 'image' -> emit
  // <ac:image> referencing attachment "<mermaidPrefix>-<i>.png" (i matches listMermaid order).
  const ctx = { mermaid, mermaidPrefix, idx: 0 };
  return parseBlocks(md).map((b) => storageBlock(b, ctx)).join("\n");
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) { return esc(s).replace(/"/g, "&quot;"); }

function storageInline(nodes) {
  return nodes.map((n) => {
    if (n.t === "text") return esc(n.v);
    if (n.t === "code") return `<code>${esc(n.v)}</code>`;
    if (n.t === "strong") return `<strong>${storageInline(n.children)}</strong>`;
    if (n.t === "em") return `<em>${storageInline(n.children)}</em>`;
    if (n.t === "link") return `<a href="${escAttr(n.href)}">${storageInline(n.children)}</a>`;
    if (n.t === "image") {
      const isUrl = /^https?:\/\//i.test(n.src);
      const ref = isUrl ? `<ri:url ri:value="${escAttr(n.src)}" />` : `<ri:attachment ri:filename="${escAttr(n.src)}" />`;
      return `<ac:image ac:align="center" ac:alt="${escAttr(n.alt || "")}">${ref}</ac:image>`;
    }
    return "";
  }).join("");
}

function storageList(block) {
  const tag = block.ordered ? "ol" : "ul";
  const items = block.items.map((it) => {
    const nested = it.children.map((c) => storageList(c)).join("");
    return `<li>${storageInline(parseInline(it.text))}${nested}</li>`;
  }).join("");
  return `<${tag}>${items}</${tag}>`;
}

function codeMacro(text, lang) {
  const langParam = lang ? `<ac:parameter ac:name="language">${escAttr(lang)}</ac:parameter>` : "";
  return `<ac:structured-macro ac:name="code">${langParam}<ac:plain-text-body><![CDATA[${text}]]></ac:plain-text-body></ac:structured-macro>`;
}

function storageBlock(b, opts) {
  switch (b.type) {
    case "heading": return `<h${b.level}>${storageInline(parseInline(b.text))}</h${b.level}>`;
    case "para": return `<p>${storageInline(parseInline(b.text))}</p>`;
    case "hr": return "<hr/>";
    case "blockquote": return `<blockquote><p>${storageInline(parseInline(b.text.replace(/\n/g, " ")))}</p></blockquote>`;
    case "code": {
      if ((b.lang || "").toLowerCase() === "mermaid" && opts.mermaid === "image") {
        const i = opts.idx++;
        return `<ac:image ac:align="center"><ri:attachment ri:filename="${opts.mermaidPrefix}-${i}.png" /></ac:image>`;
      }
      return codeMacro(b.text, b.lang || null);
    }
    case "list": return storageList(b);
    case "table": {
      const head = `<tr>${b.header.map((c) => `<th>${storageInline(parseInline(c))}</th>`).join("")}</tr>`;
      const body = b.rows.map((r) => `<tr>${r.map((c) => `<td>${storageInline(parseInline(c))}</td>`).join("")}</tr>`).join("");
      return `<table><tbody>${head}${body}</tbody></table>`;
    }
    default: return "";
  }
}

// Return the mermaid code blocks (in document order) — used by the Confluence connector's
// future image pipeline to render + attach them.
export function listMermaid(md) {
  return parseBlocks(md).filter((b) => b.type === "code" && (b.lang || "").toLowerCase() === "mermaid").map((b) => b.text);
}

// ---------- JIRA ADF renderer ----------

export function mdToAdf(md) {
  return { type: "doc", version: 1, content: parseBlocks(md).map(adfBlock).filter(Boolean) };
}

function textNode(text, marks) { const t = { type: "text", text }; if (marks && marks.length) t.marks = marks; return t; }

function inlineToAdf(nodes, marks = []) {
  const out = [];
  for (const n of nodes) {
    if (n.t === "text") { if (n.v) out.push(textNode(n.v, marks)); }
    else if (n.t === "code") out.push(textNode(n.v, [...marks, { type: "code" }]));
    else if (n.t === "strong") out.push(...inlineToAdf(n.children, [...marks, { type: "strong" }]));
    else if (n.t === "em") out.push(...inlineToAdf(n.children, [...marks, { type: "em" }]));
    else if (n.t === "link") out.push(...inlineToAdf(n.children, [...marks, { type: "link", attrs: { href: n.href } }]));
    else if (n.t === "image") out.push(textNode(`[image: ${n.alt || n.src}]`, marks));
  }
  return out;
}

function adfParagraph(text) {
  const content = inlineToAdf(parseInline(text));
  return { type: "paragraph", content };
}

function adfList(block) {
  return {
    type: block.ordered ? "orderedList" : "bulletList",
    content: block.items.map((it) => {
      const inner = [adfParagraph(it.text), ...it.children.map(adfList)];
      return { type: "listItem", content: inner };
    }),
  };
}

function adfBlock(b) {
  switch (b.type) {
    case "heading": return { type: "heading", attrs: { level: b.level }, content: inlineToAdf(parseInline(b.text)) };
    case "para": return adfParagraph(b.text);
    case "hr": return { type: "rule" };
    case "blockquote": return { type: "blockquote", content: [adfParagraph(b.text.replace(/\n/g, " "))] };
    case "code": return { type: "codeBlock", attrs: b.lang ? { language: b.lang } : {}, content: b.text ? [{ type: "text", text: b.text }] : [] };
    case "list": return adfList(b);
    case "table": {
      const row = (cells, header) => ({
        type: "tableRow",
        content: cells.map((c) => ({ type: header ? "tableHeader" : "tableCell", attrs: {}, content: [adfParagraph(c)] })),
      });
      return { type: "table", attrs: { isNumberColumnEnabled: false, layout: "default" },
        content: [row(b.header, true), ...b.rows.map((r) => row(r, false))] };
    }
    default: return null;
  }
}
