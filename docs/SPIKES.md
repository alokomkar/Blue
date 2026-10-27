# Spike results (Oct 26, 2026, evening IST)

First calls to the Meta Model API with the project's key, through the project's own client (`api/_lib/meta.ts`).
Scripts are in `scripts/spikes/` (run from the repo root, they read `.env`, nothing is printed that could contain the
key). Timings are from one run each on a home connection from India; treat them as rough.

| # | Spike | Result | Verdict |
|---|---|---|---|
| 0 | Key and model list | `GET /v1/models` 200; sees muse-spark 1.1/1.2/1.3 (+ contributor), muse-wonder-1.0, muse-image-1.0, muse-voice-transcribe-1.0, sam-3.1 | works |
| 1 | Structured output (`json_schema`) | A museum request produced a valid LevelSpec-shaped JSON on both effort levels, enums and integer ranges respected, 3.1 s (minimal) / 3.8 s (default) | works |
| 2 | Muse Image: a marker floor-plan sketch | 17 s, a convincing phone-photo-style sketch of a three-room plan. The client labelled it PNG but the bytes were WebP (the default), so request `output_format: 'png'` or fix the mime | works, slow |
| 3 | SAM 3.1 on the sketch with concept prompts | `paper` returned the whole page; `wall`, `door`, `room`, `rectangle`, `black marker line` returned **zero matches** (streaming and not) | **walls are not a SAM concept** |
| 4 | Spark finds the rooms, SAM masks them | Spark (minimal effort, 6.8 s) returned 3 interior boxes and the entrance accurately; SAM box prompts (1.9 s) returned a mask per room, tightened to the room | **works** |
| 5 | Masks to a grid | Decoded with `@meta-sam/parser` (`one_bit`), masks placed at their `bounds`, rasterised to 16 x 16: three room regions in the right places, walls as the cells between them | works |
| 6 | Voice: clip to transcript to order | Transcripts exact ("cover me while I work the console"), `cover_me` order correct. **4.2–4.5 s in total** (ASR 1.6–2.7 s, Spark 1.8–2.6 s) | works, too slow |

## What this changes

**Photo to map (gate G1): go, with a different pipeline.** The design assumed SAM would segment "wall" and "door". It
does not. The pipeline that works:

1. Spark vision (0–1000 grid): the interior box of every room and the entrance (about 7 s at minimal reasoning effort).
2. SAM 3.1 with **box prompts**: `<0f>1<|box;...|>,2<|box;...|>`, one object id per room; masks come back tightened to the
   room, as a raster at the box's `bounds`.
3. Rasterise onto the game grid: a cell belongs to a room when most of it is inside that room's mask; **walls are the
   cells between rooms**. Door gaps are where the ink between two rooms is missing, found with a plain pixel threshold
   along the wall line (marker on paper needs no model), and the entrance comes from Spark.
4. Run the verifier (V2/V3) and let the Director repair.

SAM still earns its place: pixel-accurate room regions, and `paper` for cropping the page. Total about 9 s, so the
page needs a progress line ("finding rooms… tracing walls…").

**Voice: 4 to 5 s is too slow for a "cover me" moment.** Plan:
- A **local fast path** on the transcript: obvious commands ("cover me", "hold", "follow", "regroup", "wait at the lift")
  map to orders with no second model call, so they cost only the transcription (about 1.6–2.7 s).
- Spark only for the ambiguous or compound ones, with `reasoning_effort: 'minimal'` **and a large `max_tokens`**:
  at minimal effort a two-step command ("take out the guard on the left, then hold at the lift") used 348 of 400 tokens on
  reasoning, hit the limit and returned an empty reply. 1200+ tokens fixes it, and the system prompt says to act on the
  first step only.
- Show the transcript at once ("…" then the words), so the delay reads as listening, not lag.
- Later: the realtime WebSocket endpoint (needs a relay, see DESIGN.md) would cut the transcription time.

**Smaller notes**
- Spark 1.3 spends tokens on reasoning even at `minimal` (14 for a trivial reply, 100 to 350 for a task). Always leave
  headroom in `max_tokens`.
- `client.image()` should ask for `png` (or detect WebP) before the result is used as an input image elsewhere.
- Muse Image at about 17 s is fine for a briefing poster or a newspaper (load while the level builds, cache the result),
  not for anything interactive.

## Still to spike

- Spike 2 from the plan: a hand-built grid with a loop in the maze game (guards, cameras, partner).
- The three real phone photos of sketches (the generated sketch is a stand-in and a fixture: `public/fallback/scans/sketch1.jpg`).
- Door detection by ink threshold, and the grid-to-level loader.

## Addendum: the Director, live (spike 7, Oct 26 22:58 IST)

`scripts/spikes/spike7_director.mjs` runs the Director through its endpoint handler. Museum request: pass in 1 round
(3.0 s). Refinery request: `exit_close` twice, pass in round 3 (6.6 s). A bank-heist request was rejected by Meta's input
filter ("The response was filtered due to the prompt triggering our content management policy", HTTP 400). The same
request passed on other tries and with a shorter system prompt, so the filter is borderline and not deterministic: a rejected call is tried once
more, then the Director falls back to a verified level and reports `request_rejected`. Plan: show the fallback as "the closest level we could
make" so a demo never dead-ends.

## Addendum: game art from Muse Image and SAM (spikes 9 and 10, Oct 27, 00:30 IST)

Question: can Meta's models improve the game's graphics? `scripts/spikes/spike9_graphics.mjs` and `spike10_cutout.mjs`.

| Art | Result |
|---|---|
| Seamless floor texture, stone (1024 x 1024) | Clean grey tiles in 17.7 s. |
| Seamless floor texture, red carpet with a gold pattern | Tiled 2 x 2 it reads as one carpet, with only a faint horizontal seam at the join (an edge blend would hide it). 23.5 s. |
| Wall painting in a gold frame | A convincing framed abstract oil painting, 9.8 s. |
| Panorama, 2048 x 1024 | A moody invented port city at night, teal and orange haze: the size `2048x1024` is accepted. 19.4 s. |
| A prop on white, then SAM 3.1 `potted plant` | One match in 2.2 s, a clean silhouette mask (small gaps between stems). That makes a sprite with transparent edges, which Muse Image cannot give directly (its background is always opaque). |

Limits: 8 to 24 s per image, 150 images a minute, $0.01 each, so art is made when a level is built (or ahead of time) and cached, never
per frame; the content filter applies; tiling and style consistency are not guaranteed, so the prompts say "seamless, flat, from above".

### A sample level with the generated art (prototype, Oct 27, 01:10 IST)

A museum level (the Director's `museum` spec) was started in a scratch build of the committed game and dressed from the browser with the
spike 9 and 10 images: a red-and-gold carpet runner down the main corridor (the generated carpet texture, repeated), seven gold-framed
paintings hung on the corridor walls (the generated painting, on planes just off the wall faces, self-lit so the dark level shows them), and a
SAM-cut potted plant sprite (it did not show up in the framing, so the shot does not prove it). Same position, with and without: `docs/img/graphics-sample-before.jpg` and
`graphics-sample-after.jpg`. **Finding:** the game draws a fog-of-war overlay over the floor, so a floor texture swapped on the floor tiles
shows nothing; decals sit above that layer (y 0.14 m) and show. A real feature would hook the floor overlay's colour or draw floor art as
decals. Nothing from this prototype is in the game's code yet.

## Addendum: the voice partner, built (spike 6 follow-up, Oct 27)

Measured through the real endpoint (`api/ai/transcribe.ts`, macOS `say` clips of 0.4 to 2.9 s, three runs each, a home connection from India; times are the server's own `ms` plus the whole request as curl saw it):

| Clip | Path | ASR | Order | Whole request |
|---|---|---|---|---|
| "cover me", "hold", "follow me", "regroup", "wait at the lift", "take the guard" | fast (no model) | 0.84 to 1.65 s | 0 ms | 0.86 to 1.67 s (median about 1.0 s) |
| "cover me while I work the console" | Spark | 1.3 to 1.5 s | 0.8 to 2.2 s | 2.3 to 3.4 s |
| "take out the guard on the left, then hold at the lift" (first step: `take`) | Spark | 1.7 s | 1.8 to 2.6 s | 3.5 to 4.3 s |
| "what a nice day" (none) | Spark | 0.9 to 1.7 s | 0.8 to 1.9 s | 1.7 to 3.6 s |

In the page, from letting go of the key to the reply on screen (a headless browser with a fake microphone, which adds the clip upload and a proxy hop): about 1.9 to 2.4 s for the fast path, 2.3 to 4.3 s for a model-read command and 4.6 to 4.9 s for the compound one.
The words appear first (`?stream=1`): about 1.7 s (compound) before the order, so the delay reads as listening.

Things learned: the tap of the recording graph (an `AudioWorkletNode` with no output) is held by the recorder so nothing can collect it while the key is down (hardening, not a proven fault); in the headless test setup an audio context's clock sometimes
barely advanced (a clip of about a tenth of a second, reported by the page as "too short"), which a plain page in the same browser did not do and which a retry cleared, so it is treated as the test setup; Meta's input filter was not
triggered by "take out the guard" (the phrase is softened to "stun" before it goes out anyway).
