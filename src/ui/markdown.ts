/** Turn Markdown into paragraphs: hard-wrapped source lines are joined, headings, list items and table rows stand alone. */
export function reflowMarkdown(md: string): { text: string; head?: boolean; indent?: boolean }[] {
  const out: { text: string; head?: boolean; indent?: boolean }[] = [];
  let cur: { text: string; indent?: boolean } | null = null;
  const flush = (): void => {
    if (cur) out.push(cur);
    cur = null;
  };
  const clean = (t: string): string => t.replace(/\[([^\]]*)\]\(([^)]*)\)/g, "$1 ($2)").replace(/[*`_]/g, "").trim();
  for (const raw of md.split("\n")) {
    const l = raw.trim();
    if (!l) { flush(); continue; }
    if (l.startsWith("#")) { flush(); out.push({ text: clean(l.replace(/^#+/, "")), head: true }); continue; }
    if (l.startsWith("|")) {
      flush();
      if (/^\|[\s:|-]+\|$/.test(l)) continue;
      out.push({ text: clean(l.split("|").map((c) => c.trim()).filter(Boolean).join(" — ")), indent: true });
      continue;
    }
    if (/^[-*] /.test(l)) { flush(); cur = { text: `- ${clean(l.slice(2))}`, indent: true }; continue; }
    if (cur) cur.text += ` ${clean(l)}`;
    else cur = { text: clean(l) };
  }
  flush();
  return out;
}
