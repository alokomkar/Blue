# Plan: Operation Blueprint, AI Edition

Last updated: Oct 26, 2026 (day before the building period starts). Everything here is intent, not progress. Dates are Eastern Time, matching the hackathon.

## 1. Goal

Ship a public, playable web demo and a 3-minute video by **Nov 4, 9:00 PM ET** that shows four things Meta's models make possible in a stealth-heist game:

1. A plain-language request becomes a **level that has been verified completable**.
2. A **sketched floor plan on paper** becomes a playable map.
3. You **speak orders to your AI partner** and it acts on them.
4. Every run gets a **generated briefing, dossier art and an after-action newspaper**.

Track: **Indie Developer**. Problem statement: *Build for Your World* (a game builder's own problem: making and populating levels is slow, and an agent that builds and checks them is useful beyond this one game).

## 2. Constraints that shape the plan

| Constraint | Consequence |
|---|---|
| Only work built Oct 27 – Nov 4 counts | Baseline is imported once and tagged. New work is separate modules and commits. |
| Repo must be public | No story, characters, scripts or voice files in the repo or its history. Fresh repo, squashed baseline. |
| 3-minute demo video is the main judging artifact | Every feature needs a clean 20–40 second beat. Cut what doesn't film well. |
| API key can't live in the browser | All model calls go through server functions. |
| Judges use the live product | Each feature has a cached fallback so the demo never depends on live latency. |
| No medical advice, basic RAG, simple image analysers, war or politics | Keep the framing a heist, not a war. Keep the shootout exit stylised and short. |
| Nine days, one person | Scope tiers below. Cut by tier, not by feature. |

## 3. How each Meta model is used

Model IDs and prices are from the Meta Model API docs (dev.meta.ai/docs/models and /docs/pricing-rate-limits), read Oct 26.

### 3.1 Heist Director (feature 1)

- **Models:** `muse-spark-1.3` for the loop (cheap, fast, tool calling, JSON-schema output). `muse-wonder-1.0` as an optional heavier planner. An open-weight run on **Muse Spark Open** via Baseten (`meta-models/muse-spark-open-1026` for the hackathon) for the open-weights prize.
- **How:** a tool-calling loop.
  1. User types a job ("night job at a museum, two guards, one blind spot by the vault").
  2. The model returns a **level spec** (JSON, schema-constrained: grid size, layout style, place theme, guard/camera/laser counts, contract, goal and entry cells).
  3. Tools: `build_level(spec)`, `verify_level(level)`, `explain_failure(report)`.
  4. The verifier returns concrete failures (goal unreachable, guard spawns on the entry, laser blocks the only corridor). The model edits the spec and tries again, up to N rounds.
- **Verifier layers:** (a) static: reachability from entry to goal and exit over the grid; (b) rules: spawn distance, no sealed rooms; (c) in-page bot run for a short simulated playthrough. Tower plans already have `validatePlan()` and `reachableP()`; maze floors need a new path search.
- **Why it's the "verifiable agent":** the agent doesn't just generate, it is forced to prove its output against code and shows its repair steps on screen.
- **Constraint to design around:** structured-output schemas must not be recursive and are limited to 10 levels of nesting.

### 3.2 Voice partner (feature 2)

- **Models:** `muse-voice-transcribe-1.0` (speech to text only; there is no speech synthesis) and `muse-spark-1.3` to turn the transcript into an order.
- **How:**
  1. Push-to-talk: the browser records a short clip, encodes mono 16-bit WAV (16 or 24 kHz).
  2. `/api/transcribe` calls `POST /v1/asr/transcribe` with `keywords` (game vocabulary: lift, console, guard names) as biasing.
  3. Spark maps the text to one of a fixed set of **partner orders** via structured output: hold, follow, cover me, distract (target), take (target), wait at lift, regroup.
  4. The partner AI executes the order and answers in text/subtitle and sound.
- **New game work:** the partner has no order interface today. It follows, covers and shoots by itself. An order layer is part of this feature.
- **Upgrade path (stretch):** realtime WebSocket needs the key in the handshake, so it needs a small always-on relay server rather than a serverless function.
- **Open-weights option:** the order-parsing step is small and structured, so it can run on Spark Open (Baseten) or Glimmer (not yet evaluated).

### 3.3 Photo to map (feature 3)

- **Models:** `muse-spark-1.3` (vision with point/box grounding on a 0–1000 grid) and `sam-3.1` (pixel masks from a noun phrase).
- **How:**
  1. Photo of a sketched floor plan (paper or whiteboard) is uploaded.
  2. SAM 3.1, one request per concept: "wall", "door", maybe "room". Masks decoded with the `@meta-sam/parser` library.
  3. Masks are sampled along each cell edge of an N×M grid to decide open/blocked.
  4. Spark reads the image to propose the entrance, goal location and room names.
  5. The result goes through the same verifier as feature 1; the Director can repair it.
- **Biggest risk in the plan:** sketches have loops, but the existing maze generators build tree-shaped layouts. Unknown whether patrols, cameras and guard placement cope with loops. A spike on day 1–2 decides the scope.
- **Fallback:** clean, thick-marker sketches on white paper, plus three pre-scanned examples.

### 3.4 Generated story layer (feature 4)

- **Models:** `muse-spark-1.3` for text, `muse-image-1.0` for images ($0.01 per image, 150 requests/min, built-in web/image search, text rendering for infographic-style graphics).
- **Surfaces:**
  - Briefing and target dossier (text plus a generated target photo).
  - A location poster shown in-world on the lobby wall (a texture applied to a wall plane; the game currently has only procedural textures).
  - **After-action newspaper**: the run's outcome (time, alerts, takedowns, loot) goes to Spark for the article; Muse Image renders the front page.
- **Not canon:** all story text is generated fresh in a neutral frame. No narrative content from the original game is used.
- **Prize angle:** Best Creative Build lists Muse Image and Muse Wonder.

## 4. Demo levels

| Level | Source in the baseline | AI touches |
|---|---|---|
| Maze | Procedural grid generator | Director, photo to map, voice, story |
| Tower | Parametric four-floor plan per place, with validator | Director (place spec), voice, story |
| Bunker | Hand-authored plan | Voice, story (level itself stays fixed) |
| Shootout exit | Tower played in reverse with waves | Voice (the main showcase), after-action newspaper |

## 5. Expected result at the end

By Nov 4:

- A public GitHub repo (`alokomkar/Blue`) with a README, clear separation of baseline and new work, and setup instructions.
- A deployed web demo on a subdomain of `sortedqueue.com` (Vercel), playable without installing anything.
- A 3-minute demo video (storyboard in section 8).
- A post on X with the demo clip (Most Viral bonus).
- A submission on the Cerebral Valley platform listing every Meta model used.

What we want judges to take away, mapped to the four criteria:

| Criterion | What we show |
|---|---|
| Impact | A level builder that checks its own work: useful to any game maker. Photo-to-play is instantly understandable. |
| Use of Meta AI tooling | Seven model families in one product: Spark, Wonder, Image, Voice Transcribe, SAM 3.1, Spark Open (and possibly Glimmer), used in different roles, not one chat box. |
| Technical depth | Schema-constrained specs, a verifier with repair loop, mask-to-grid conversion, order grammar for voice, server-side key handling and caching. |
| Demo | One continuous flow: sketch, build, play with voice, escape, read the newspaper. |

Prize targets: Indie Developer track placement, plus Best Agentic Use-Case (Director), Best Creative Build (Image/Wonder), Best Build on Open Weights (Director or order parser on Spark Open), Most Viral and Community Vote.

## 6. Scope tiers

| Tier | Contents | Rule |
|---|---|---|
| **Must** | JSON level spec and loader; Director with verifier on the maze level; voice partner with at least five orders; story layer text plus two images; deployed demo; video | If a Must slips, stop everything else. |
| **Should** | Director on the tower level; photo to map on clean sketches; after-action newspaper; shootout exit with voice orders; cached fallbacks | Cut in reverse order if behind. |
| **Stretch** | Open-weight run on Spark Open; realtime voice relay; Muse Wonder as the Director's planner; in-world poster textures; bunker tweaks | Only after Should is demo-ready. |

## 7. Phases

Oct 26 is a Monday. Oct 31 and Nov 1 are the weekend (no Meta office hours; office hours run 10–11 AM ET in Discord on weekdays).

| Phase | Dates | Goal | Done when |
|---|---|---|---|
| **0. Setup** | Mon Oct 26 | Repo, docs, accounts | README and plan committed; Meta API key created; credit and partner-credit requests sent when links are live |
| **1. Foundations and spikes** | Tue Oct 27 – Wed Oct 28 | Baseline in, standalone build live, riskiest unknowns answered | Baseline imported with story stripped and tagged; page deployed on Vercel with a working `/api` proxy; level spec v0 loads a maze; three spikes answered (below) |
| **Gate G1** | end of Wed Oct 28 | Decide photo-to-map scope | Go / reduced / drop |
| **2. Voice and Director v1** | Thu Oct 29 – Fri Oct 30 | Two features playable | Five or more partner orders work by voice; Director produces a verified maze from a sentence; radio check-ins and habit counters in (see [`GAMEPLAY.md`](GAMEPLAY.md)) |
| **3. Photo to map and repair loop** | Sat Oct 31 – Sun Nov 1 | Third feature, Director repair loop, four-level run order | Sketch to playable map with the verifier; visible repair loop; four levels chain in order |
| **4. Story layer and exit level** | Mon Nov 2 | Fourth feature, shootout exit | Briefing, dossier art and newspaper generate per run; exit level uses voice orders; bunker turrets, fans and hanging lamps (the sniper-platform rebuild is deferred), timeboxed to 3 days |
| **5. Harden and film** | Tue Nov 3 | Demo never fails; rehearsed | Cached fallbacks for every feature; rate limiting and spend alert on; custom domain; demo recorded once |
| **6. Submit** | Wed Nov 4 | Submission in early | Final video, public repo check, X post, submission filed by **3 PM ET** (deadline 9 PM) |
| After | Nov 5 – 16 | Judging, ceremony Nov 9 12 PM, community vote result Nov 16 | |

### Phase 1 spikes (answer before building features on top of them)

1. **SAM 3.1 on a sketched plan:** does "wall" produce usable masks from a phone photo of a marker sketch? How noisy are the edges?
2. **Loops:** does the maze game (patrols, cameras, guard placement, the existing verifier assumptions) work on a layout with loops?
3. **Voice round trip:** recorded clip to transcript to order to partner action. Is it under about 2 seconds?

### Session schedule to use

- Tue Oct 27, 12 PM: Agents 101, multimodal agent.
- Wed Oct 28, 12 PM: Agents 102, verifiable agents (directly relevant to the Director).
- Fri Oct 30, 12 PM: building on Fireworks with Muse open models.

## 8. Demo video storyboard (3:00)

| Time | Beat |
|---|---|
| 0:00 | Hook: a napkin sketch on a table. |
| 0:15 | Photo to map: the sketch becomes a level, walls appear. |
| 0:45 | Director: type a job, watch it build, fail the verifier, repair, pass. |
| 1:20 | Play: stealth through the maze, voice order to the partner. |
| 2:00 | Tower and bunker, quick cuts. |
| 2:20 | Shootout exit with the partner covering on voice command. |
| 2:40 | Newspaper front page generated from the run. |
| 2:50 | "What we built during the hackathon" card with the model list. |

Cut order if short on time: bunker beat first, then tower, then the repair-loop detail.

## 9. Hosting and safety

- **Hosting:** Vercel, static game plus serverless `/api/*` functions. A subdomain of `sortedqueue.com` for the hackathon build, so the existing Reddit app link is untouched. The game already treats a failed `/api` call as "no result", which gives graceful fallback.
- **Key handling:** the Meta key exists only as a server environment variable. `.gitignore` excludes `.env*`. Use separate keys for development and the live demo.
- **Abuse and cost:** per-IP rate limits on every endpoint, a spend limit notification on the Meta billing page, and caching of repeated requests. Prices are low (Spark about $1.25 in / $4.25 out per million tokens, Image $0.01 per image, Voice $0.18 per hour, SAM $2.50 per 1,000 images), so the $150 credit should be ample, but a public link needs limits anyway.
- **Unchecked:** Vercel function duration limits on the plan in use. Long calls (agent loops, image generation) may need streaming or polling. Verify in phase 1.

## 10. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Photo-to-map too noisy or loops break the game | High | Spikes on day 1–2; gate G1; clean-sketch fallback; scanned examples |
| Voice latency feels sluggish | Medium | Push-to-talk, short clips, small fixed order set, text feedback immediately |
| Level spec and loader take longer than a day | Medium | Start with maze only; tower and bunker stay as they are |
| Story leaks into the public repo | Low but serious | Fresh repo, squashed baseline, review the file list before the first push |
| API errors or rate limits during judging | Medium | Cached results for every demo path; retries with backoff |
| One-person scope | High | Scope tiers; ship Must first |
| Model availability in my region | Unknown | Check the Geographic Use Policy and test with a real key on day 1 |

## 11. Gameplay track

Playtest feedback (levels feel alike, run and gun, enemies too easy) is answered by a separate, timeboxed track:
radio check-ins, counters to the player's habits, snipers in the tower, riot-shield guards in the exit, and bunker
turrets, fans and hanging lamps (the sniper platforms were costed at 19 to 25 days and deferred). Details, the chosen heights and the schedule are in [`GAMEPLAY.md`](GAMEPLAY.md). It never
displaces a Must item. The co-op work (the AI partner on the tower, bunker and exit) and the bunker and exit lighting
were done on Oct 26, before the building period. They are committed under their real date and tagged
`pre-hackathon-final`: they are carried-over work, disclosed as such, and everything after that tag is hackathon work.

## 12. VR later

The application describes a VR action-stealth game; the submission is the web build. The game is three.js, which has
WebXR support, and it already has a first-person mode (key K), so a Quest-browser version is a port, not a rewrite. What
it would take: an XR input layer next to the keyboard and touch controls (head look, thumbstick move, trigger fire),
a camera rig for the first-person view, the HUD and briefing as in-world panels, comfort options (snap turn, vignette),
and a lighter render profile for the headset. The Meta model calls do not change, and the voice partner suits VR best
(a microphone and a partner you talk to). Not scheduled for the event; to keep it open, the game logic stays separate from
input and camera code, and the first-person mode stays working.

## 13. Open questions

- Subdomain name for the hackathon build.
- Licence for the repo (decide before the first code commit).
- Whether to evaluate Muse Glimmer for the partner's order parser.
- Whether the story layer needs a content/safety pass on generated images before they go in-world.
