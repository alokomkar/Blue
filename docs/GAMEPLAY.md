# Gameplay track: smarter enemies and a signature threat per level

Written Oct 26, 2026. Playtest feedback on the baseline: the levels feel alike, the game plays like run and gun, there
is little reason to keep going, guards are not smart enough, dogs are easy and the alpha dog is no problem. This track
answers that. It sits beside the four AI features in [`PLAN.md`](PLAN.md) and is timeboxed so it cannot swallow them.

## Decisions (from the author)

1. **Radio check-ins**: yes.
2. **Counter the player's habits**: yes.
3. **A signature threat per level**:
   - Tower: snipers.
   - Bunker: turrets, no heavy guards, a taller space with sniper platforms, stairs up to them, bridges between them,
     ceiling fans and hanging lights.
   - Shootout exit: lit well (done, see below). Signature threat: riot-shield guards that need a flash grenade to open.
4. **Bunker heights** (chosen): storey 8 m (today 4 m); sniper platforms and bridges at 6 m, which is two wall heights
   (walls are 3 m).
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

## 4. Bunker: tall, with sniper platforms

- **Space:** the storey is 8 m. Sniper platforms and the bridges that connect them are at 6 m, two wall heights. Ceiling
  fans turn above them, and lamps hang on chains from the roof (a few real lights, the rest glowing meshes, inside the
  existing light budget).
- **Platforms:** catwalks along the long sides, a parapet at the front. A stairway from the floor reaches each one (6 m of
  rise at the existing gentle 27° is a three-cell run, treads no taller than 0.2 m).
- **Bridges:** walkable, with rails, joining platforms across the hall. They give the player a vantage point over the
  whole level, and cross sniper lines.
- **Snipers:** higher eye, longer range (about 1.6× a guard's) and they see over container stacks. They cannot be hit
  from the floor: the platform and parapet are between you and them. The only way to take one down is to climb the stair
  (or cross a bridge from another platform) and take it down from behind or stun it close up.
- **Turrets:** wall- and ceiling-mounted, sweeping a cone, with a laser tell; shorted out by an EMP, or by the console that
  controls them. **No heavy guards** in the bunker.
- **Engineering notes (to check in a spike first):**
  - The bunker's levels are `RawPlan` storeys of cells (`bunkerplan.ts`); the walkable container roofs
    (`roofSurfaces`, with a height `rel`) are the closest existing thing to a platform. The rebuild should extend that
    mechanism with parapets, long stairs and bridges before inventing another.
  - Stairs: bunker stairs are cell-based, one flight per storey; a flight from the floor to 6 m is new.
  - Doubling the storey height affects the camera, the grapple and duct shafts (their lengths), lamp heights, wall meshes
    and the sight/occlusion boxes. The spike measures that cost first.
  - The AI partner must follow up the platform stairs and across the bridges (see the co-op rules in the plan).

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
- **New work only.** The co-op changes and the bunker/exit lighting were made on Oct 26, before the building period; they
  are committed on Oct 27 so history shows them inside the window. Everything in this track is built from Oct 27.
- **Co-op:** every new enemy and structure is tested with the AI partner on.
- **Tests:** pure rules (radio, habits, sniper aim, platform reachability) get unit tests; the levels get a headless
  play-through with and without the partner.

## Schedule

| When | What |
|---|---|
| Phase 2 (Oct 29–30) | Radio check-ins and habit counters (small, pure rules plus glue) |
| Phase 3 (Oct 31 – Nov 1) | Tower snipers |
| Phase 4 (Nov 2) | Riot-shield guards in the exit waves (small: the shield rules exist) |
| After the voice partner and Director v1 are playable | Bunker spike (half a day), then the rebuild, **timeboxed to 2 days**; if the spike or the first day says no, cut to turrets plus a single sniper platform with one stair |

## Open questions

- Whether snipers should also shoot the AI partner (assumed yes, with a lower hit chance than the player).
- Bridge width and rail height, and whether the player can drop from a bridge to the floor (assumed yes, with the
  existing drop and landing).
