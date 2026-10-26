// A layout board for the touch controls, for localhost only (`?layout=demo`): a slim row of chips across the top that forces each contextual control into view, so a phone-sized
// window can show where every button and menu sits without having to set the situation up in play. Nothing here runs on Reddit.

const STYLE = `
.layout-demo-bar { position: fixed; top: 2px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; gap: 3px; padding: 2px 4px; background: rgba(0,0,0,.7); border: 1px solid #e0bd6c; border-radius: 4px; font: 700 9px/1 ui-monospace, Menlo, monospace; }
.layout-demo-bar button { padding: 4px 6px; border: 1px solid rgba(255,255,255,.35); border-radius: 3px; background: transparent; color: #e7e1cf; font: inherit; cursor: pointer; }
.layout-demo-bar button[aria-pressed='true'] { background: #e0bd6c; color: #1a1206; }
body.demo-carry .interact-btn { display: block !important; }
body.demo-flash .flash-prompt { display: flex !important; }
body.demo-aim .trap-aim { display: flex !important; }
`;

type State = { id: string; label: string; apply: (on: boolean) => void };

/** Shows the demo chips; each toggles one state (the kit open, trap aiming, the trap camera, the flash prompt, the contextual Carry button). */
export function startLayoutDemo(): void {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const kit = document.getElementById('kit');
  const interact = document.getElementById('interact-btn');
  if (interact) interact.textContent = 'Carry';
  const states: State[] = [
    { id: 'kit', label: 'Kit', apply: (on) => kit?.classList.toggle('open', on) },
    { id: 'aim', label: 'Trap aim', apply: (on) => void (document.body.classList.toggle('demo-aim', on), document.body.classList.toggle('trap-aiming', on)) },
    { id: 'camera', label: 'Trap cam', apply: (on) => document.getElementById('trap-panel')?.classList.toggle('hidden', !on) },
    { id: 'flash', label: 'Flash', apply: (on) => document.body.classList.toggle('demo-flash', on) },
    { id: 'carry', label: 'Carry', apply: (on) => document.body.classList.toggle('demo-carry', on) },
  ];
  const bar = document.createElement('div');
  bar.className = 'layout-demo-bar';
  for (const s of states) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = s.label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      s.apply(on);
    });
    bar.appendChild(b);
  }
  document.body.appendChild(bar);
}
