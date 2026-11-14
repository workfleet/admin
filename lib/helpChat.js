// The "Ask about WorkFleet" chat: the rules it answers by, and the checks
// on what goes in and comes out. It answers only from the office guide
// (lib/helpGuide.js) - never from general knowledge of other apps - and
// says so when the guide doesn't cover something.

export const HELP_MAX_TURNS = 12;
export const HELP_MAX_CHARS = 2000;

export function helpSystem(guide) {
  return `You are the help assistant inside WorkFleet, the app a UK cleaning company's office uses to run its rota, clients, staff and paperwork. Office staff ask you how to do things in the app.

How to answer:
- Use only the WorkFleet guide below. It describes the app as it is today. Never guess at buttons, pages or features it doesn't mention, and never describe other apps.
- If the guide doesn't cover it, say you're not sure and suggest asking an admin. Don't invent a workaround.
- Give the steps as a short numbered list, using the button names in quotes exactly as the guide gives them. Start with where to go.
- Link to the page with a markdown link using its path from the guide, like [Rota](/admin/rota). Only use paths that appear in the guide.
- If something is admins-only and that matters, say so.
- Keep it short: a sentence or two, then the steps. No headings. Plain British English.
- You can't see the person's data or change anything; you only explain how. If they ask you to do something (e.g. "add a job for me"), explain how they can do it.
- Questions about writing documents: point them to the [AI assistant](/admin/assistant).

<guide>
${guide}
</guide>`;
}

// The conversation as the API wants it: alternating user/assistant turns
// ending on the user, trimmed to the last few, each capped in length.
export function cleanHelpMessages(raw) {
  const list = (Array.isArray(raw) ? raw : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.trim().slice(0, HELP_MAX_CHARS) }));
  // Drop anything before the first user turn, and merge repeats of a role.
  const out = [];
  for (const m of list) {
    if (!out.length && m.role !== 'user') continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content = `${last.content}\n\n${m.content}`.slice(0, HELP_MAX_CHARS * 2);
    else out.push({ ...m });
  }
  while (out.length && out[out.length - 1].role !== 'user') out.pop();
  const trimmed = out.slice(-HELP_MAX_TURNS);
  while (trimmed.length && trimmed[0].role !== 'user') trimmed.shift();
  return trimmed;
}

// Where the person is, so "how do I do this here" makes sense. Only an app
// path, never a query string (it can hold ids).
export function pageNote(path) {
  const p = typeof path === 'string' ? path.split('?')[0].split('#')[0] : '';
  if (!/^\/(admin|cleaner|client)(\/[\w-]*)*\/?$/.test(p) && !/^\/admin\/[\w/-]+$/.test(p)) return '';
  const general = p.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '/[id]');
  return `(They are on the page ${general}.)`;
}

// Turns an answer into blocks the chat box can draw: paragraphs, bullet
// and numbered items, each a list of runs (text, bold, link). Links are
// kept only when they point inside the app.
export function parseAnswer(text) {
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ type: 'p', runs: answerRuns(para.join(' ')) }); para = []; } };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if (!line) { flush(); continue; }
    if ((m = /^[-*•]\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: 'bullet', runs: answerRuns(m[1]) }); continue; }
    if ((m = /^(\d+)[.)]\s+(.*)$/.exec(line))) { flush(); blocks.push({ type: 'numbered', n: Number(m[1]), runs: answerRuns(m[2]) }); continue; }
    para.push(line.replace(/^#+\s*/, ''));
  }
  flush();
  return blocks;
}

export function isAppLink(href) {
  return typeof href === 'string' && /^\/(admin|cleaner|client)(\/[\w-]+)*\/?$/.test(href);
}

export function answerRuns(text) {
  const runs = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;
  const s = String(text || '');
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    if (m.index > last) runs.push({ text: s.slice(last, m.index) });
    const token = m[0];
    if (token.startsWith('**')) runs.push({ text: token.slice(2, -2), bold: true });
    else {
      const lm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      if (lm && isAppLink(lm[2])) runs.push({ text: lm[1], href: lm[2] });
      else runs.push({ text: lm ? lm[1] : token });
    }
    last = m.index + token.length;
  }
  if (last < s.length) runs.push({ text: s.slice(last) });
  return runs;
}
