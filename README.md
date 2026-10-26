# Operation Blueprint: AI Edition

A 3D stealth-heist game where Meta's models build the level, play your partner, and write the aftermath.

Built for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Indie Developer track). Building period: Oct 27 – Nov 4, 2026.

> **Status: planning.** Nothing below is built yet. This README describes the intended project and is updated as work lands. The detailed plan is in [`docs/PLAN.md`](docs/PLAN.md); an interactive version is in [`docs/index.html`](docs/index.html) (open it in a browser).

## What it is

You sneak through a facility past guards, cameras and lasers, with an AI partner at your side, and get out. The game mechanics are a carry-over from an earlier project of mine. **The AI layer is what this repo adds**, and it is what the hackathon is judged on:

| # | Feature | One line | Meta models |
|---|---------|----------|-------------|
| 1 | **Heist Director** | Describe a job in plain words, get a level that has been checked to be completable | Muse Spark 1.3 / Muse Wonder (agent loop), Muse Spark Open (open-weight run) |
| 2 | **Voice partner** | Talk to your AI partner: "cover me", "hold the lift", "take the east guard" | Muse Voice Transcribe, Muse Spark |
| 3 | **Photo to map** | Photograph a sketched floor plan and play it | SAM 3.1, Muse Spark (vision) |
| 4 | **Generated story layer** | Per-run briefing, target dossier, location poster and an after-action newspaper | Muse Spark, Muse Image |

## Demo levels

One demo run of four levels. Mechanics are carried over; the levels, level format and everything AI-driven are new.

1. **Maze**: the open floor. Main target for the Director and for photo-to-map.
2. **Tower**: four storeys, stairs and lifts.
3. **Bunker**: the hand-authored hero level.
4. **Shootout exit**: fight your way back out in waves, with the partner covering you.

## What is new in this repo

The hackathon requires that new work is clearly identifiable.

- **Baseline** (carried over, tagged `baseline-pre-hackathon`): the 3D engine, movement, guards, cameras, lasers, stealth and combat mechanics, the AI partner's follow/cover behaviour.
- **New in this repo** (every commit after the baseline):
  - A serialisable JSON level format and loader.
  - The level verifier.
  - The Heist Director agent.
  - Voice orders for the partner.
  - Photo-to-map pipeline.
  - Story layer (text and images).
  - Standalone web build and the server functions that call Meta's APIs.
- **Not in this repo:** the original game's story, characters, narrative scripts or voice recordings. All story text in the demo is generated fresh.

## Planned architecture

```
Browser (game, three.js)
   │   mic clip / photo / level request
   ▼
Server functions (Vercel)  ← API key lives here only
   ├─ /api/director    Muse Spark / Wonder tool loop + level verifier
   ├─ /api/transcribe  Muse Voice Transcribe → Muse Spark → partner order
   ├─ /api/scan        Muse Spark vision + SAM 3.1 → grid
   └─ /api/story       Muse Spark text + Muse Image
```

The Meta Model API key is never sent to the browser.

## Running the baseline

Needs Node 22.6 or newer.

```bash
npm install
npm run dev        # http://localhost:5173/game.html
npm run build      # static build in dist/
npm run test:unit  # unit tests
npm run test:types # type-check
```

Level links (the debug links work on localhost only):

| Level | Link | With the AI partner |
|---|---|---|
| Maze | `/game.html?job=1` | add `&coop=ai` |
| Tower | `/game.html?job=tower&n=1` | add `&coop=ai` |
| Bunker | `/game.html?job=bunker` | add `&coop=ai` |
| Shootout exit | `/game.html?job=tower&exit=1` | add `&coop=ai` |

The model calls (Meta Model API) will go through serverless functions; the API key is never in the browser. Until
those exist the game calls `/api/*`, gets nothing back, and carries on.

## Assets

Everything under `public/models` is CC0 (Quaternius) or original work; see
[`public/models/CREDITS.md`](public/models/CREDITS.md). The live demo can additionally use a private set of the project's original character animations, which are not CC0 and are never part of this repo: they live in the git-ignored `public/models/private/` and `private-overlay/`. `scripts/restore-private-assets.sh` recreates them from the original game repo on the author's machine, and `npm run build:original` builds the demo with them (`dist-original/`). Without them the game uses the CC0 clips, and `npm run build` is the build everyone else gets.

## Docs

- [`docs/PLAN.md`](docs/PLAN.md): goals, how each Meta model is used, expected result, phases and risks.
- [`docs/DESIGN.md`](docs/DESIGN.md): the level spec, the verifier, the endpoints, the order grammar and the first two days' task list.
- [`docs/GAMEPLAY.md`](docs/GAMEPLAY.md): the gameplay track (smarter enemies, snipers, the taller bunker).
- [`docs/index.html`](docs/index.html): the same plan as an interactive page.

## License

To be decided before the first code commit.
