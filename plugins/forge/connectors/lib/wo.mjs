// wo.mjs — parse the User Stories (Work Orders) artifact into structured epics + stories.
//
// Recognized structure:
//   ## <Epic section title>
//   ### WO-001 — [P0] <Story title>        (also accepts "[P0] WO-001 — title" or "[P0] title")
//   <description paragraph(s)>
//   | Field | Value |  ... rows: Story Points | Hours | Priority | Labels | ID
//   **Acceptance Criteria**
//   - <bullet> (incl. the 3 standard DoD lines)
//   **Depends on:** WO-002, WO-003
//
// Epic id is taken from each story's `epic:EPIC-NNN` label; epic name = its section heading.

export function parseWorkOrders(md) {
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const stories = [];
  let section = null, cur = null, mode = null, woSeq = 0;
  const flush = () => { if (cur) stories.push(cur); cur = null; mode = null; };

  for (const line of lines) {
    let m;
    if ((m = /^##\s+([^#].*)$/.exec(line))) { flush(); section = m[1].trim(); continue; }
    if ((m = /^###\s+(.*)$/.exec(line))) {
      flush();
      const h = m[1].trim();
      let wo = null, pr = null, title = h, hm;
      if ((hm = /^WO-([A-Za-z0-9]+)\s*[—-]\s*(?:\[(P\d)\]\s*)?(.*)$/.exec(h))) { wo = "WO-" + hm[1]; pr = hm[2] || null; title = hm[3].trim(); }
      else if ((hm = /^\[(P\d)\]\s*WO-([A-Za-z0-9]+)\s*[—-]\s*(.*)$/.exec(h))) { pr = hm[1]; wo = "WO-" + hm[2]; title = hm[3].trim(); }
      else if ((hm = /^\[(P\d)\]\s*(.*)$/.exec(h))) { pr = hm[1]; title = hm[2].trim(); }
      if (!wo) { woSeq++; wo = "WO-" + String(woSeq).padStart(3, "0"); }
      else { const n = parseInt(wo.slice(3), 10); if (!Number.isNaN(n) && n > woSeq) woSeq = n; }
      cur = { wo, priority: pr, title, section, description: "", storyPoints: null, hours: null, labels: [], epic: null, acceptanceCriteria: [], dependsOn: [] };
      mode = "desc";
      continue;
    }
    if (!cur) continue;

    if ((m = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/.exec(line))) {
      const k = m[1].trim().toLowerCase(), v = m[2].trim();
      if (k === "story points") cur.storyPoints = v;
      else if (k === "hours") cur.hours = v;
      else if (k === "priority") { if (!cur.priority) cur.priority = v; }
      else if (k === "labels") cur.labels = v.split(",").map((s) => s.trim()).filter(Boolean);
      else if (k === "id" && /^WO-/i.test(v)) cur.wo = v.trim();
      mode = null;
      continue;
    }
    if (/^\*\*Acceptance Criteria\*\*/i.test(line)) { mode = "ac"; continue; }
    if ((m = /^\*\*Depends on:\*\*\s*(.*)$/i.exec(line))) { cur.dependsOn = line.match(/WO-[A-Za-z0-9]+/g) || []; mode = null; continue; }

    if (mode === "ac") {
      const b = /^\s*[-*]\s+(.*)$/.exec(line);
      if (b) cur.acceptanceCriteria.push(b[1].trim());
      continue;
    }
    if (mode === "desc") {
      if (/^\s*\|/.test(line) || /^\s*[-|]{3,}/.test(line)) continue; // skip table header/separator
      if (/^\s*$/.test(line)) continue;
      cur.description += (cur.description ? " " : "") + line.trim();
    }
  }
  flush();

  const epicOrder = [], epicByName = {};
  for (const s of stories) {
    const epicLabel = (s.labels.find((l) => /^epic:/i.test(l)) || "").split(":")[1] || null;
    s.epic = epicLabel;
    if (epicLabel) {
      if (!epicByName[epicLabel]) { epicByName[epicLabel] = { epic: epicLabel, name: s.section || epicLabel, stories: [] }; epicOrder.push(epicLabel); }
      epicByName[epicLabel].stories.push(s.wo);
    }
  }
  return { epics: epicOrder.map((e) => epicByName[e]), stories };
}

// Build a JIRA issue description (markdown) from a story's description + acceptance criteria.
export function storyDescriptionMd(s) {
  const lines = [];
  if (s.description) lines.push(s.description, "");
  if (s.acceptanceCriteria.length) {
    lines.push("**Acceptance Criteria**");
    for (const ac of s.acceptanceCriteria) lines.push(`- ${ac}`);
  }
  if (s.dependsOn.length) { lines.push("", `**Depends on:** ${s.dependsOn.join(", ")}`); }
  lines.push("", `_forge: ${s.wo}_`);
  return lines.join("\n");
}
