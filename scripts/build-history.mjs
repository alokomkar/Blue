// Builds the local, self-contained HTML version of docs/HISTORY.md: docs/history.html (the overview) and one page per
// phase (docs/phase-0.html, docs/pre-event.html, docs/phase-1.html, ...). Run after adding entries to HISTORY.md:
//   node scripts/build-history.mjs
// No dependencies. The converter handles only the markdown subset HISTORY.md uses: headings, paragraphs, bullets (two
// levels), tables, fenced code, images, links, **bold** and `code`.
import fs from 'node:fs';

const DOCS = new URL('../docs/', import.meta.url).pathname;
const REPO = 'https://github.com/alokomkar/Blue';
const src = fs.readFileSync(`${DOCS}HISTORY.md`, 'utf8').replace(/\r\n/g, '\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Inline markdown to HTML. */
function inline(text) {
  let s = esc(text);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => `<img src="${url}" alt="${alt}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, url) => `<a href="${url.replace(/^\.\.\//, `${REPO}/blob/main/`)}">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

/** A block of markdown lines (no headings) to HTML. */
function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith('```')) {
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
    } else if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(2).map(cells);
      out.push(`<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    } else if (/^\s*- /.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*- /.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        const l = lines[i++];
        const m = l.match(/^(\s*)- (.*)$/);
        if (m) items.push({ depth: m[1].length >= 2 ? 1 : 0, text: m[2] });
        else items[items.length - 1].text += ` ${l.trim()}`;
      }
      let html = '<ul>';
      let open = false;
      for (const it of items) {
        if (it.depth === 1 && !open) { html += '<ul>'; open = true; }
        if (it.depth === 0 && open) { html += '</ul>'; open = false; }
        html += `<li>${inline(it.text)}</li>`;
      }
      if (open) html += '</ul>';
      out.push(`${html}</ul>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('|') && !lines[i].startsWith('```') && !/^\s*- /.test(lines[i])) para.push(lines[i++].trim());
      out.push(`<p>${inline(para.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

// ---- split HISTORY.md into the intro and the `## ` sections, each into entries ----
const lines = src.split('\n');
const firstSection = lines.findIndex((l) => l.startsWith('## '));
const title = (lines.find((l) => l.startsWith('# ')) ?? '# Project history').slice(2);
const introLines = lines.slice(lines.findIndex((l) => l.startsWith('# ')) + 1, firstSection).filter((l) => l.trim() !== '---');
const sections = [];
for (let i = firstSection; i < lines.length; i++) {
  if (lines[i].startsWith('## ')) sections.push({ heading: lines[i].slice(3), lines: [] });
  else if (lines[i].trim() !== '---') sections[sections.length - 1].lines.push(lines[i]);
}
for (const sec of sections) {
  const m = sec.heading.match(/^Phase (\d+)/);
  sec.slug = m ? `phase-${m[1]}` : 'pre-event';
  sec.short = m ? `Phase ${m[1]}` : 'Pre-event';
  sec.pre = [];
  sec.entries = [];
  let cur = null;
  for (const l of sec.lines) {
    if (l.startsWith('### ')) {
      cur = { heading: l.slice(4), body: [] };
      sec.entries.push(cur);
    } else if (cur) cur.body.push(l);
    else sec.pre.push(l);
  }
  for (const e of sec.entries) {
    const h = e.heading.match(/^([0-9a-f]{7}) · (\d\d:\d\d) · (.*)$/);
    e.kind = h ? 'commit' : 'summary';
    if (h) Object.assign(e, { hash: h[1], time: h[2], name: h[3] });
    else e.name = e.heading;
  }
}

/** One commit entry as a card: Input, Output and In plain terms as labelled rows, anything else after them. */
function commitCard(e) {
  const rows = [];
  const rest = [];
  const body = e.body;
  let i = 0;
  while (i < body.length) {
    const m = body[i].match(/^- \*\*(Input|Output|In plain terms):\*\*\s*(.*)$/);
    if (m) {
      const chunk = [`- ${m[2]}`];
      i++;
      while (i < body.length && (/^\s{2,}/.test(body[i]) || (body[i].trim() === '' && /^\s{2,}/.test(body[i + 1] ?? '')))) chunk.push(body[i++]);
      const label = m[1];
      // the first line is the text of the row; nested lines are its sub-bullets
      // (a wrapped line of the row's own text, before any sub-bullet, belongs to the text, not to a paragraph of its own)
      let first = chunk[0].slice(2);
      const nested = [];
      for (const l of chunk.slice(1)) {
        if (!l.trim()) continue;
        if (!nested.length && !/^\s*- /.test(l)) first += ` ${l.trim()}`;
        else nested.push(l);
      }
      rows.push({ label, html: `${first.trim() ? `<p>${inline(first)}</p>` : ''}${nested.length ? blocks(nested) : ''}` });
    } else { rest.push(body[i]); i++; }
  }
  const cls = { Input: 'in', Output: 'out', 'In plain terms': 'plain' };
  return `<article class="commit" id="c-${e.hash}">
  <header><a class="hash" href="${REPO}/commit/${e.hash}">${e.hash}</a><span class="time">${e.time} IST</span><h3>${inline(e.name)}</h3></header>
  ${rows.map((r) => `<section class="row ${cls[r.label]}"><h4>${r.label}</h4><div>${r.html}</div></section>`).join('\n  ')}
  ${rest.some((l) => l.trim()) ? `<div class="extra">${blocks(rest)}</div>` : ''}
</article>`;
}

const css = `
:root{--bg:#f6f7f9;--surface:#fff;--surface-2:#eef1f5;--text:#151a22;--muted:#5a6575;--line:#d9dee6;--accent:#1664d9;--accent-soft:#e2edfc;--in:#a15c00;--out:#17803d;--plain:#1664d9;--radius:12px;--mono:ui-monospace,SFMono-Regular,Menlo,monospace}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0e1218;--surface:#161c25;--surface-2:#1d2531;--text:#e8ecf2;--muted:#9aa5b5;--line:#2a3441;--accent:#6aa5ff;--accent-soft:#1b2a44;--in:#e5a23a;--out:#4cc77d;--plain:#6aa5ff}}
:root[data-theme=dark]{--bg:#0e1218;--surface:#161c25;--surface-2:#1d2531;--text:#e8ecf2;--muted:#9aa5b5;--line:#2a3441;--accent:#6aa5ff;--accent-soft:#1b2a44;--in:#e5a23a;--out:#4cc77d;--plain:#6aa5ff}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:70px}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:var(--accent)}code{font-family:var(--mono);font-size:.9em;background:var(--surface-2);padding:1px 5px;border-radius:5px}
.wrap{max-width:900px;margin:0 auto;padding:0 16px}
.bar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--bg) 90%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.bar .wrap{display:flex;align-items:center;gap:8px;height:54px;overflow-x:auto}
.bar a.tab{white-space:nowrap;text-decoration:none;color:var(--muted);padding:6px 10px;border-radius:8px;font-size:14px}
.bar a.tab.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
.bar .sp{flex:1}
.bar button{font:inherit;border:1px solid var(--line);background:var(--surface);color:inherit;border-radius:8px;width:36px;height:36px;cursor:pointer;flex:none}
h1{font-size:clamp(26px,5vw,38px);line-height:1.15;margin:28px 0 8px}h2{font-size:24px;margin:28px 0 8px}
.lede{color:var(--muted);max-width:720px}
.cards{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));margin:18px 0}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:16px}
.card h3{margin:0 0 4px;font-size:18px}.card .meta{color:var(--muted);font-size:13px;margin-bottom:8px}
.card ul{margin:8px 0 0;padding-left:18px;font-size:15px}
.commit{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);margin:14px 0;overflow:hidden}
.commit header{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 12px;padding:12px 16px;background:var(--surface-2);border-bottom:1px solid var(--line)}
.commit header h3{flex-basis:100%;margin:0;font-size:17px}
.hash{font-family:var(--mono);font-size:13px;background:var(--accent-soft);padding:2px 8px;border-radius:999px;text-decoration:none}
.time{color:var(--muted);font-size:13px}
.row{display:grid;grid-template-columns:110px 1fr;gap:12px;padding:12px 16px;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}
.row h4{margin:2px 0;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.row.in h4{color:var(--in)}.row.out h4{color:var(--out)}.row.plain h4{color:var(--plain)}
.row.plain{background:color-mix(in srgb,var(--accent-soft) 45%,transparent)}
.row p{margin:0 0 6px}.row ul{margin:4px 0;padding-left:20px}.row li{margin:3px 0}
.extra{padding:4px 16px 14px}
.extra img,.row img{max-width:100%;height:auto;border-radius:8px;border:1px solid var(--line);display:block}
.table-wrap{overflow-x:auto;margin:10px 0}table{border-collapse:collapse;width:100%}
th,td{border:1px solid var(--line);padding:8px 10px;vertical-align:top;text-align:left;font-size:15px}th{background:var(--surface-2);font-size:13px}
td img{min-width:220px}
pre{background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:12px;overflow-x:auto;font-size:13px;line-height:1.35}pre code{background:none;padding:0}
.summary{border:2px solid var(--accent);border-radius:var(--radius);padding:4px 18px 14px;background:var(--surface);margin:24px 0}
.summary h3{color:var(--accent)}
.pager{display:flex;justify-content:space-between;gap:12px;margin:28px 0 48px}
.pager a{border:1px solid var(--line);background:var(--surface);border-radius:var(--radius);padding:10px 14px;text-decoration:none}
.timeline{width:100%}.timeline td:first-child{font-family:var(--mono);white-space:nowrap}
@media(max-width:600px){.row{grid-template-columns:1fr;gap:2px}}
`;

const script = `(function(){try{var t=localStorage.getItem('hist-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}
document.getElementById('theme').addEventListener('click',function(){var r=document.documentElement,c=r.getAttribute('data-theme'),d=c?c==='dark':matchMedia('(prefers-color-scheme:dark)').matches,n=d?'light':'dark';r.setAttribute('data-theme',n);try{localStorage.setItem('hist-theme',n)}catch(e){}})})();`;

function nav(active) {
  const tabs = [{ href: 'history.html', label: 'Overview', id: 'overview' }, ...sections.map((s) => ({ href: `${s.slug}.html`, label: s.short, id: s.slug })), { href: 'index.html', label: 'Plan page', id: 'plan' }];
  return `<div class="bar"><div class="wrap">${tabs.map((t) => `<a class="tab${t.id === active ? ' on' : ''}" href="${t.href}">${t.label}</a>`).join('')}<span class="sp"></span><button id="theme" aria-label="Toggle theme" title="Toggle theme">◐</button></div></div>`;
}

const page = (name, active, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title><style>${css}</style></head>
<body>${nav(active)}<main class="wrap">${body}</main><script>${script}</script></body></html>
`;

// ---- phase pages ----
sections.forEach((sec, idx) => {
  const commits = sec.entries.filter((e) => e.kind === 'commit');
  const summaries = sec.entries.filter((e) => e.kind === 'summary');
  const prev = sections[idx - 1];
  const next = sections[idx + 1];
  const body = `<h1>${inline(sec.heading)}</h1>
${sec.pre.some((l) => l.trim()) ? `<div class="lede">${blocks(sec.pre)}</div>` : ''}
<p class="lede">${commits.length} commit${commits.length === 1 ? '' : 's'}, in order. Each shows what was asked (input), what came out (output) and what it means in plain terms.</p>
${commits.map(commitCard).join('\n')}
${summaries.map((s) => `<section class="summary"><h3>${inline(s.name)}</h3>${blocks(s.body)}</section>`).join('\n')}
<nav class="pager"><span>${prev ? `<a href="${prev.slug}.html">← ${prev.short}</a>` : ''}</span><span>${next ? `<a href="${next.slug}.html">${next.short} →</a>` : ''}</span></nav>`;
  fs.writeFileSync(`${DOCS}${sec.slug}.html`, page(`${sec.short} · ${title}`, sec.slug, body));
});

// ---- overview ----
const total = sections.reduce((n, s) => n + s.entries.filter((e) => e.kind === 'commit').length, 0);
const cardsHtml = sections.map((sec) => {
  const commits = sec.entries.filter((e) => e.kind === 'commit');
  const sum = sec.entries.find((e) => e.kind === 'summary');
  return `<div class="card"><h3><a href="${sec.slug}.html">${inline(sec.heading)}</a></h3><div class="meta">${commits.length} commits · ${commits[0]?.time ?? ''} to ${commits.at(-1)?.time ?? ''} IST</div>${sum ? blocks(sum.body) : '<p>The commits that closed the carried-over work and drew the line between it and the hackathon work (tag <code>pre-hackathon-final</code>).</p>'}</div>`;
}).join('\n');
const timeline = sections.flatMap((sec) => sec.entries.filter((e) => e.kind === 'commit').map((e) => `<tr><td><a href="${sec.slug}.html#c-${e.hash}">${e.hash}</a></td><td>${e.time}</td><td>${inline(e.name)}</td><td>${sec.short}</td></tr>`)).join('\n');
const overview = `<h1>${esc(title)}</h1>
<div class="lede">${blocks(introLines)}</div>
<p class="lede"><strong>${total} commits</strong> in ${sections.length} parts. Open a part for the full write-up with screenshots.</p>
<div class="cards">${cardsHtml}</div>
<h2>Every commit</h2>
<div class="table-wrap"><table class="timeline"><thead><tr><th>Commit</th><th>Time (IST)</th><th>What</th><th>Part</th></tr></thead><tbody>${timeline}</tbody></table></div>
<p class="lede">This page is generated from <code>docs/HISTORY.md</code> by <code>node scripts/build-history.mjs</code>.</p>`;
fs.writeFileSync(`${DOCS}history.html`, page(title, 'overview', overview));
console.log(`wrote history.html and ${sections.map((s) => `${s.slug}.html`).join(', ')} (${total} commits)`);
