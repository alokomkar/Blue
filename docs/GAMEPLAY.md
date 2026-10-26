# Gameplay track: smarter enemies and a signature threat per level

Written Oct 26, 2026. Playtest feedback on the baseline: the levels feel alike, the game plays like run and gun, there
is little reason to keep going, guards are not smart enough, dogs are easy and the alpha dog is no problem. This track
answers that. It sits beside the four AI features in [`PLAN.md`](PLAN.md) and is timeboxed so it cannot swallow them.

## Decisions (from the author)

1. **Radio check-ins**: yes.
2. **Counter the player's habits**: yes.
3. **A signature threat per level**:
   - Tower: snipers.
   - Bunker: turrets, no heavy guards, ceiling fans and hanging lights. The taller space with sniper platforms,
     stairs and bridges was costed at 19 to 25 days and is deferred (section 4).
   - Shootout exit: lit well (done, see below). Signature threat: riot-shield guards that need a flash grenade to open.
4. **Bunker heights** (chosen, then overtaken by the study): storey 8 m, platforms and bridges at 6 m. The bunker is
   already 7 m per storey with 6 m walls, and the platforms are deferred.
5. **Lighting**: the bunker and the shootout exit are lit (cool strip light in the bunker, warm light and every storey
   known in the exit). The tower stays dark.
6. **Schedule** (chosen): the small items first, the bunker rebuild timeboxed.

Not in this track: alpha dog armour and dog scent trails (suggestions 4 and 5 from the review). They can follow.

## 1. Radio check-ins

Every patrol and sentry guard reports in on a radio every 30–45 seconds (seeded jitter, so a floor's guards don't speak
together). The report shows as a short line on a small radio feed on the HUD ("CH 3: clear").

- A guard that is down, carried off or put in a container stops reporting. At the first missed check-in the control room
  sends the two nearest guards to that guard's last position. At the second miss, the floor's alert goes up a step.
- So a silent takedown has a clock on it: hide the body *and* be somewhere else, or jam the radio. Blackouts and EMP
  discharges silence the radio for their length.
- Pure rules in `src/client/game/radio.ts` (timers, misses, who is dispatched), unit-tested; `game.ts` glue calls guards
  to investigate through the investigate hook they already have (the flare and backup code).
- Later, Muse Spark can write the chatter so players learn what the guards know.

## 2. Counter the player's habits

A tally of how the run is being won: stun from range, takedown from behind at corners, the same hiding spot, the same
route, camo, flash. When a tactic passes a threshold the guards answer, one counter at a time, at most one every
60–90 seconds, and never twice for the same tactic in a level:

| Habit | Counter |
|---|---|
| The same hiding spot more than once | Guards open that locker or crate when they pass |
| Takedowns at the same corner | That corner is patrolled in pairs |
| Stun from range | Visors: stun slows them less |
| Camo | A guard sweeps with a light at close range |
| The same route | A guard waits on the busiest lane |

Each counter is announced on the radio ("check the lockers") so it is fair and readable. Pure rules in
`src/client/game/habits.ts`, unit-tested; the tally lives in `game.ts`. Resets per level.

## 3. Tower: snipers

A sniper kind in `src/client/game/enemies/sniper.ts` (a new `EnemyKind`): stationary on a balcony or catwalk on the upper
storeys, a long, narrow view that reaches across the atrium and through glass, a red laser sight as the tell, a 1.5 s
aim before the shot. Counterplay: break the line (cover, smoke, EMP on the scope), cross while it re-aims, or go round and
take it down from behind. Two to four per tower, more at higher job numbers. Uses the existing sniper gun model.

## 4. Bunker: turrets, fans and hanging lamps (platforms deferred)

**Feasibility study (Oct 26, read-only) changed this section.** Findings:

- The bunker is already tall: storeys are 7 m (`TALL_FLOOR_HEIGHT`) and walls 6 m (`BUNKER_WALL_H`), not the 4 m and 3 m
  of the tower. A 6 m platform would sit at today's wall top, and the earlier "double the height" premise is moot.
- The full design (sniper platforms with stairs, bridges, snipers that cannot be hit from below, partner support) is
  about **19 to 25 focused days**: platforms, stairs and bridges 8 to 11; snipers and turrets 4 to 6; fans and lamps
  1.5 to 2.5; partner 3 to 4; height 1 to 1.5. Most of that is foundation: the game has a single height field per
  storey, no height bands in collision (a parapet or ramp side needs them), a `round(y / storeyHeight)` storey snap
  that would put a 6 m deck on the next storey, and flat (2D) stun shots that would reach a platform from the floor.
- Nine building days and four AI features cannot carry that, so the platform concept is **deferred**.

**Decision (default, chosen when asked for a preference; change on request): build the cheap, visible parts.**

- **Turrets:** wall- and ceiling-mounted, sweeping a cone, red laser tell; shorted out by EMP or the console that controls
  them. They reuse the camera plan (`towerCams`) rather than the enemy loop. No heavy guards in the bunker.
- **Ceiling fans** turning in the halls, and **hanging lamps** on chains (a few real lights inside the 10-light budget,
  the rest emissive meshes). The bunker has no ceiling mesh today (upper storeys are hidden), so these hang from the
  storey's top and need deck-free sight lines. About 3 to 4 days in all, timeboxed to 3.
- **Snipers stay in the tower** (section 3), where they stand on ordinary floors and balconies and need no new geometry.
- **Later (stretch, or after the event):** one sniper platform with a stairway, then bridges and partner support, in the
  build order the study gave: height, a shared layer and banded collision, platforms and ramps (player only), bridges,
  a `base` height on blocking boxes plus a height gate on flat shots, snipers and turrets, lamps and fans, the partner.

## 5. Shootout exit: riot-shield guards

Lit like the bunker, with all storeys known. The signature threat (chosen) is **riot-shield guards**: they come in the
waves with the hunters, a shield turns every stun, bullet and EMP aside from the front, and only a **flash grenade** opens
it, for a few seconds, during which shots count and a takedown from behind works. Shots from the side or behind are not
turned aside, which rewards moving round them.

- It reuses the shield rules the Warden boss already has (`warden.ts`: the shield, the flash that opens it, the window it
  stays open), with a riot guard's own numbers: less health, a shorter open window, a frontal arc instead of full cover.
- The flash grenade is the answer, so waves are paced to restock them (the exit already drops a weapons kit between
  waves) and the partner learns to throw or call one (see the co-op rules).
- **Engineering note:** the shield lives in `bots.ts`, one of the files the private original-look build overwrites. The
  riot profile therefore needs the same edit in the private copy: kept as a small patch applied by
  `scripts/restore-private-assets.sh`, not edited by hand twice.
- A later step could let the Heist Director choose each run's wave mix (guards, riot guards, hunters).

## Constraints that apply to all of it

- **The private "original look" build** copies the original `player.ts`, `bots.ts`, `outfit.ts`, `portrait.ts`,
  `retarget.ts`, `skins.ts`, `stash.ts`, `ual.ts`, `highwall.ts` and `actor.ts` over this repo's (see the README). So new
  logic goes in new modules and in `game.ts`, and those ten files stay untouched. If a change to one of them is
  unavoidable it is made in both places.
- **New work only.** The co-op changes and the bunker/exit lighting were made on Oct 26, before the building period. They
  are committed on Oct 26, under their real date, and tagged `pre-hackathon-final`, so they count as carried-over work and
  are disclosed as such. Everything in this track is built from Oct 27, nothing earlier.
- **Co-op:** every new enemy and structure is tested with the AI partner on.
- **Tests:** pure rules (radio, habits, sniper aim, platform reachability) get unit tests; the levels get a headless
  play-through with and without the partner.

## Schedule

| When | What |
|---|---|
| Phase 2 (Oct 29–30) | Radio check-ins and habit counters (small, pure rules plus glue) |
| Phase 3 (Oct 31 – Nov 1) | Tower snipers |
| Phase 4 (Nov 2) | Riot-shield guards in the exit waves (small: the shield rules exist) |
| After the voice partner and Director v1 are playable | Bunker turrets, fans and hanging lamps, **timeboxed to 3 days** (the platform rebuild is deferred) |

## Open questions

- Whether snipers should also shoot the AI partner (assumed yes, with a lower hit chance than the player).
- Bridge width and rail height, and whether the player can drop from a bridge to the floor (assumed yes, with the
  existing drop and landing).
