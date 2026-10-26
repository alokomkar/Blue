# Design: the four AI features, ready to build

Written Oct 26, 2026 (the night before the building period). A design, not code: nothing here is built. Everything is
grounded in the code as it is on `main` at the baseline; where I could not check something it says so.

## 0. Ground rules

- **Namespace:** the game already calls `/api/init`, `/api/save`, `/api/tries`, `/api/leaderboard`, `/api/profile` and
  `/api/played` (from its Reddit days), gets a 404 and carries on. The new endpoints live under **`/api/ai/*`** so they
  can't collide with those.
- **Key:** `MODEL_API_KEY` is a server environment variable only. No endpoint echoes it; browsers only ever see
  `/api/ai/*`.
- **Model names** are configuration, not code: `MODEL_TEXT` (default `muse-spark-1.3`), `MODEL_PLANNER`
  (default `muse-spark-1.3`, `muse-wonder-1.0` optional), `MODEL_IMAGE` (`muse-image-1.0`), `MODEL_ASR`
  (`muse-voice-transcribe-1.0`), `MODEL_SAM` (`sam-3.1`). An open-weight run sets `LLM_BASE_URL` and `LLM_MODEL`
  (Baseten: `meta-models/muse-spark-open-1026`) and the same OpenAI-compatible client calls it.
- **Every endpoint has a cached fallback** (`public/fallback/...`) the client uses when the call fails or is slow, so a
  live demo never waits on the network.
- **Safety on a public link:** per-IP rate limit on each endpoint, request size caps (audio 10 s, image 4 MB, prompt 500
  chars), responses cached by content hash.
- **No story.** All generated text uses the neutral frame in section 5.

## 1. The level spec (Heist Director and photo to map)

The generators take a `Difficulty` (`difficulty.ts`: `cols`, `rows`, `floors`, `guards`, `watchdogs`, `crawlers`,
`alphas`, `drones`, `heavies`, `doors`, `chainedDoors`, `lasers`, `lines`, `gates`, `sweepers`, `sliders`, `shutters`,
`documents`, `decorRooms`, `crates`, `staffLockers`, `vents`, `blackouts`, …), a place (`LocationId`: campus, museum,
refinery, bank, warehouse, lab), a layout style (`LayoutStyle`: halls, aisles, fishbone, plus, uturn; or the plain maze),
a contract (`ContractId`: records, sabotage, vault, hit, blackout, extract, swap, shipment), up to two twists
(`TwistId`: shiftchange, lockdown, lightsout, reinforcements, lightkit, timer, silent) and a seed. Today a job number
picks all of these. The spec makes them explicit and serialisable:

```ts
type LevelSpec = {
  version: 1;
  title: string;                 // shown in the brief; <= 60 chars
  brief: string;                 // one sentence; <= 200 chars
  place: LocationId;
  layout: LayoutStyle | 'maze';
  size: { cols: number; rows: number };           // 6..14 x 5..10 (the game's own cap, MAX_COLS/MAX_ROWS)
  floors: 1 | 2;
  seed: number;                  // uint32; same spec + same seed = same level
  contract: ContractId;
  twists: TwistId[];             // 0..2, must fit the contract (twists.ts fitsContract)
  roster: { guards: number; watchdogs: number; crawlers: number; alphas: number; drones: number; heavies: number };
  hazards: { doors: number; lasers: number; lines: number; gates: number; sweepers: number; sliders: number; shutters: number; blackouts: number };
  loot: { documents: number };
  /** Photo to map only: the walls are given, not generated. */
  grid?: { cols: number; rows: number; cells: Array<{ n: boolean; s: boolean; e: boolean; w: boolean }>; start: { x: number; y: number }; exit: { x: number; y: number } };
};
```

- **Flat on purpose:** structured output allows at most 10 levels of nesting, no recursion; the spec is 3 deep.
- **Loader:** `buildFromSpec(spec)` = `difficultyFor(n)` with the roster/hazard/loot/size fields overriding it, then the
  existing generator with `seedRandom(seed)`; with `grid`, the given cells replace the generated maze and the rest (guards,
  lasers, rooms) is placed on it by the existing placement code. File: `src/shared/levelspec.ts` (type, clamp, validate;
  pure, unit-tested) plus a small loader in `game.ts` (`?spec=<base64>` on localhost, and a `window` hook for the page).
- **Clamps** (the schema's `minimum`/`maximum` and a second pass in code): counts never exceed the rosters the game's
  hardest job uses; `alphas` ≤ 2, `heavies` ≤ 2; a spec that clamps is accepted with the changes reported, not rejected.
- **Unchecked, to confirm on day 1:** whether guard and camera placement copes with a `grid` that has loops (spike 2), and
  how the contract's required rooms (records rooms, vault) are placed on a given grid.

## 2. The verifier

Pure functions over the built level, in `src/shared/verify.ts`, returning
`{ ok: boolean; failures: Array<{ code: string; message: string; where?: {x:number;y:number;floor:number} }> }`.

| Layer | Checks | Failure codes |
|---|---|---|
| V1 schema | Types, ranges, enum values, twist fits contract | `bad_field`, `twist_misfit` |
| V2 grid | Every cell reachable from the start; exit reachable; entry to exit path length ≥ 12 cells; no 1-wide dead-end larger than 40% of cells | `unreachable`, `exit_close`, `mostly_dead_ends` |
| V3 placement | No guard/dog within the game's own spawn lead of the start (8 steps, less on small floors, never under 5); no hazard on the start or exit cell; lasers don't close the only corridor to the exit (path search treating a cell with a laser as blocked for walking, but not for crouch/crawl lines); every contract station reachable | `spawn_close`, `blocked_exit`, `station_unreachable` |
| V4 play | A scripted autopilot plays the level with detection off (ghost) and must finish the contract inside a time budget; run in the page, fast-forwarded | `autopilot_stuck`, `timeout` |

- V1–V3 are cheap and run in the Director loop on the server (Node, no browser). V4 needs the game, so it runs in the
  client after the Director returns; a V4 failure is sent back as one more repair round.
- **Existing pieces to reuse:** `bfs` in `maze.ts`; `validatePlan` / `reachableP` for tower plans; the guard-spawn
  distance rule; `fitsContract`. The autopilot is new: the user's capture harness has one (`autoplay.js`, outside the
  repo, built on hooks that are not in `src/`), so the in-repo version is rewritten as a small module the game exposes
  behind `?autopilot=1` on localhost.

**Corrections found while building the verifier** (`src/shared/verify.ts`, `floorbuild.ts`):
a literal "no laser blocks the way" fails about 70% of floors with one laser (lasers sit on the long straight corridors), so
`laserCrossings` defaults to 1; `mostly_dead_ends` is measured as the longest dead-end corridor (the game's own floors peak at
38%), not the biggest branch; 6 x 5 floors fail `exit_close` about 80% of the time, so the minimum size is larger in practice;
a missing big room is not a failure (the game falls back to wall consoles) but a missing stair is; the game caps guards at 4,
not 6. The pure build covers the plan, exit, stairs and doors only: ceiling pipes, cameras, blackouts, staff lockers, vents,
roof ways in, sentries and heavies are not built for verification, and the game's own build draws extra random numbers, so
the loader must build from the verified floor (for example through `FloorScript`) rather than re-generate it.

## 3. The Heist Director (agent loop)

**Endpoint:** `POST /api/ai/director` with `{ prompt: string, seed?: number }`, answering a stream of server-sent events:
`{type:'round', n}`, `{type:'spec', spec}`, `{type:'verify', report}`, `{type:'done', spec, rounds, usedFallback}` or
`{type:'error', message, fallback}`. The UI shows each round as a line, so the repair loop is visible in the demo.

**Loop (server):**
1. Call the planner with the system prompt below, the user's prompt and `response_format` = the LevelSpec JSON schema
   (so the output always parses).
2. Run V1–V3. If `ok`, finish. Otherwise append the failures as the next user message and ask for a corrected spec.
3. At most **4 rounds**, then return the best spec so far with its remaining failures, and the client falls back to a
   cached spec for the same prompt category.

**Tools alternative:** the same loop can be written with tool calling (`build_level`, `verify_level`, `finish`), which suits
Muse Wonder as a longer-horizon planner. Start with the structured-output loop (fewer moving parts), and offer the tool
version as the "Best Agentic Use-Case" polish if time allows.

**System prompt (draft):**

> You design one level of a stealth-heist game from a request. Reply only with a JSON LevelSpec. Stay inside the ranges:
> guards 1–6 per floor, dogs 0–2, hazards as small as the request allows. A level must be finishable: the exit is
> reachable, nothing guards the start. Use the place that matches the request, a contract that fits it, at most two twists.
> If a previous attempt failed, you are given its failure list: fix exactly those.

**Open-weight run:** the same code with `LLM_BASE_URL`/`LLM_MODEL` set to Baseten. Output conformance there is unchecked
(schema-constrained decoding is documented for the Meta Model API, not for hosted open weights), so the open-weight path
validates and retries on parse errors.

## 4. The voice partner

**Flow:** push-to-talk (hold a key, or a touch button) records up to 6 s; the page encodes it as mono 16-bit WAV at
24 kHz; `POST /api/ai/transcribe` (multipart) forwards it to `POST /v1/asr/transcribe` (mode `PUSH_TO_TALK`, `keywords`:
the game words below), then calls the planner to turn the text into an order.

**Order grammar** (structured output):

```ts
type PartnerOrder = {
  order: 'hold' | 'follow' | 'cover_me' | 'distract' | 'take' | 'wait_at_lift' | 'regroup' | 'none';
  target?: 'nearest_guard' | 'nearest_dog' | 'next_guard' | 'north' | 'south' | 'east' | 'west';
  say: string;                   // the partner's one-line answer, <= 60 chars, shown as subtitle
};
```

`keywords` for biasing: lift, console, terminal, guard, dog, alpha, cover, hold, stay, follow, take him, distract,
flash, EMP, stairs, door. `none` is returned for anything that isn't an order (so chatter never moves the partner).

**Game side:** `src/client/game/orders.ts` maps an order to the partner state the co-op code already has (`hold` →
stay put, `follow` → trail-following, `cover_me` → the console-cover behaviour, `take` → engage the target with a stun
shot, `distract` → walk to a point in the target's view and make noise, `wait_at_lift`, `regroup` →
`regroupPartner`). Pure mapping with unit tests; the partner AI does the moving.

**Budget (measured: 4.2–4.5 s for the straight pipeline, so the target is revised):** obvious commands are matched locally on the
transcript (no second model call), so they cost only the transcription (1.6–2.7 s); only ambiguous or compound ones go to Spark
(minimal effort, `max_tokens` 1200+, act on the first step only). The transcript appears at once so the delay reads as listening.
No speech synthesis exists in Meta's API: replies are subtitles and a short radio sound.

**Later (stretch):** a realtime relay (an always-on WebSocket server), since the realtime endpoint needs the key in the
handshake.

## 5. The story layer (neutral frame)

A fresh brief per run. The frame is generic: an unnamed handler, an unnamed target company, no recurring characters.

- `POST /api/ai/story` with `{ kind: 'briefing' | 'dossier' | 'poster' | 'newspaper', context }`.
- **briefing / dossier:** the planner writes ≤ 80 words from the level spec (place, contract, roster) in a clipped
  handler's voice, plus a target's name and one line of background; a content filter pass rejects real names and brands.
- **poster:** `muse-image-1.0` (`$0.01` an image, 150 requests a minute): "a wall poster for a {place} lobby, flat
  illustration, no real brands, no text except a short slogan", aspect via `size`. Used on the briefing card, and as a
  lobby wall texture later.
- **newspaper:** the run's results (time, alerts, takedowns, documents, grade, caught or clean) go to the planner for a
  headline and a 60-word article; `muse-image-1.0` renders the front page with the headline text. Cached by results hash.
- **Where it plugs in:** the neutral stubs in `src/shared/story.ts` (briefing, debrief), `documents.ts`, and the report
  card (`#report-card`). The stubs keep working when the call fails.

## 6. Photo to map

**Endpoint:** `POST /api/ai/scan` with the image (JPEG/PNG ≤ 4 MB, resized to ≤ 1600 px on the client first). Response:
`{ grid: LevelSpec['grid'], rooms: Array<{ name: string; x: number; y: number }>, overlay: dataURL }` (the overlay shows what
was recognised, for the demo).

**Pipeline (revised after the spikes, see SPIKES.md: SAM does not segment "wall" or "door", it does segment rooms from boxes):**
1. Spark vision (0–1000 grid, minimal reasoning effort, `max_tokens` with headroom): the interior bounding box of every room
   and the entrance. About 7 s.
2. SAM 3.1 with **box prompts** (`<0f>1<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>,2<|box;...|>`, one object id per room), streamed;
   masks decoded with `@meta-sam/parser` (`metadata.mask_encoding: "one_bit"`) and placed at their `bounds`. About 2 s.
   `paper` as a concept prompt can crop the page first.
3. Rasterise onto a `cols x rows` grid (default 12 x 8): a cell belongs to a room when at least 45% of it is inside that
   room's mask, **walls are the cells between rooms**. Door gaps are where the ink between two rooms is missing, found with a
   pixel threshold along the wall line (no model needed); the entrance is Spark's point.
4. Clean up: drop cells isolated from the start's component; put the exit in the farthest room; run V2/V3; if it fails, the
   Director repairs (one round) by opening or closing named edges.

**Test fixtures:** three phone photos of marker sketches on white paper (a maze-like plan, a plan with a loop, a plan with
rooms), kept in `public/fallback/scans/` with their expected grids. **Acceptance for day 2:** ≥ 80% of edges match on the
clean sketch, and the grid passes V2.

## 7. Repository layout (to add)

```
api/ai/director.ts  transcribe.ts  scan.ts  story.ts      Vercel functions (Node 22)
api/_lib/           model client, rate limit, cache, verify wrapper
src/shared/         levelspec.ts  verify.ts  orders.ts (types)
src/client/game/    director.ts (UI + client calls)  orders.ts  voice.ts  scanui.ts
public/fallback/    director/*.json  story/*.json  scans/*
vercel.json         functions config, headers
```

## 8. Tomorrow, in order (Oct 27 and 28)

**Morning checklist for the author** (not code):
1. Create a Meta Model API key at dev.meta.ai (API keys tab); set it as `MODEL_API_KEY` in a local `.env` (git-ignored)
   and in the Vercel project; claim the Meta credits when the link is live; add a card and set the spend alert.
2. Request Baseten ($100) and Modal ($100) credits; Fireworks if invited.
3. Create the Vercel project from `alokomkar/Blue`, add the subdomain, set the environment variables.
4. Take three sketch photos for section 6.

**Build order:**
1. Standalone web build deployed on Vercel with `/api/ai/ping` echoing nothing secret (proves the proxy).
2. `levelspec.ts` + loader for the maze; load a hand-written spec. Unit tests.
3. Spike 1 (SAM on a sketch): call `sam-3.1` from a script, save the masks, view them. Pass = walls clearly visible.
4. Spike 2 (loops): load a hand-written `grid` with a loop; play it with and without the partner. Pass = guards, cameras
   and the partner behave.
5. Spike 3 (voice): record, transcribe, order, partner acts. Pass = under 2 s.
6. Gate G1 (end of Oct 28): record the three results in `PLAN.md`; decide photo to map's scope.

## 9. Tests

Pure rules (spec clamp, verifier layers, order mapping, mask to grid) get unit tests with the repo's `node --test`
runner. Endpoints get tests against recorded responses (no key needed). Levels get the headless play-through with and
without the partner (the co-op helper's scripts are the starting point). A smoke script calls each live endpoint once.
