// The Director end to end through its endpoint handler (no server needed): a request in words, the streamed rounds, and the
// final verified level. Usage: node --experimental-strip-types --no-warnings=ExperimentalWarning scripts/spikes/spike7_director.mjs "a night job at a museum"
import './common.mjs';
const { createHandler } = await import(new URL('../../api/ai/director.ts', import.meta.url).href);
const handle = createHandler();
const prompt = process.argv[2] ?? 'A night job at a museum: two guards, one dog, steal a painting from the vault.';
const t0 = Date.now();
const res = await handle(new Request('http://localhost/api/ai/director', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) }));
console.log('status', res.status, res.headers.get('content-type'));
const reader = res.body.getReader();
const dec = new TextDecoder();
let buf = '';
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  buf += dec.decode(value);
  let i;
  while ((i = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, i); buf = buf.slice(i + 2);
    const data = JSON.parse(block.split('\n').find((l) => l.startsWith('data:')).slice(5));
    const at = `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    if (data.type === 'round') console.log(at, `round ${data.n}/${data.of}`);
    else if (data.type === 'spec') console.log(at, `spec: ${data.spec.title} | ${data.spec.place}/${data.spec.layout}/${data.spec.contract} ${data.spec.size.cols}x${data.spec.size.rows} floors ${data.spec.floors} guards ${data.spec.roster.guards} dogs ${data.spec.roster.watchdogs} twists [${data.spec.twists}]`, data.changes.length ? `(clamped: ${data.changes.join('; ')})` : '');
    else if (data.type === 'verify') console.log(at, data.ok ? 'verify: pass' : `verify: FAIL ${data.failures.map((f) => f.code).join(', ')}`);
    else if (data.type === 'done') console.log(at, `done: rounds=${data.rounds} fallback=${data.usedFallback}${data.reason ? ' reason=' + data.reason : ''} -> ${data.spec.title}`);
    else console.log(at, JSON.stringify(data));
  }
}
