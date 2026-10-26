# Model and animation credits

Every file under `public/models` is either CC0 (Quaternius) or the project's own work. No file is from Mixamo or any other
source that does not allow redistribution.

CC0 1.0 Universal (Public Domain Dedication): https://creativecommons.org/publicdomain/zero/1.0/

## Characters: `skins/`

| File | Source | Licence |
| --- | --- | --- |
| `skins/ubc_male.glb`, `skins/ubc_female.glb` | Quaternius, Universal Base Characters (https://quaternius.com). Every body in the game (the agents, the guards, the cutscene actors) is one of these. | CC0 1.0 |
| `skins/ubc_female_balanced.glb`, `skins/ubc_female_refined.glb` | The project's own reshaped versions of `ubc_female.glb` (proportions adjusted in Blender), derived from the CC0 file. | CC0 1.0 (derivative of a CC0 work) |
| `skins/hair_buns.glb`, `hair_buzzed.glb`, `hair_buzzed_f.glb`, `hair_long.glb`, `hair_parted.glb` | Quaternius, Universal Base Characters hairstyles, rigged to the same skeleton. | CC0 1.0 |

## Animations: `anims/`

All clips come from Quaternius's Universal Animation Library (1 and 2) (https://quaternius.com), CC0 1.0. Each file is a
skeleton-only cut of the library holding just the clips the game plays, made by `tools/anim/cut_ual.py` of the original
project (`python3 cut_ual.py <UAL folder>/Unreal-Godot/UAL1.glb <out.glb> <clip names...>`). Clips are retargeted onto the
characters at load time (`src/client/game/ual.ts`, `retarget.ts`).

| File | Clips |
| --- | --- |
| `anims/ual.glb` | ClimbUp_1m, Sprint_Loop, Slide_Start, Slide_Exit, Melee_Hook, Melee_Hook_Rec, NinjaJump_Idle_Loop, NinjaJump_Land, Walk_Carry_Loop, LayToIdle, Hit_Knockback. Also the skeleton every other cut is retargeted from. |
| `anims/ual_move.glb` | Idle_Loop, Walk_Loop, Crouch_Idle_Loop, Crouch_Fwd_Loop, Crouch_Left_Loop, Crouch_Right_Loop, Crouch_Enter, Crouch_Exit: the agent's idle, walk and crouches. |
| `anims/ual_climb.glb` | Climb_Enter, Climb_Up_Loop, Climb_Idle_Loop, ClimbLedge, Climb_Left_Loop, Climb_Right_Loop, Climb_Exit, Climb_Down_Loop: the wall climb, and (retimed) the tall wall's hang. |
| `anims/ual_ground.glb` | The crawl: Crawl_Idle_Loop, Crawl_Fwd_Loop, Crawl_Bwd_Loop, Crawl_Enter, Crawl_Exit. |
| `anims/ual_jump.glb` | Jump_Start, Jump_Land. |
| `anims/ual_melee.glb` | Kick, Sword_Attack, Sword_Attack_Standing, Punch_Jab, Punch_Cross. |
| `anims/ual_guards.glb` | The guards' idles, walks, jogs, crouches, pistol aim and shot, hit reactions, deaths and turns. |
| `anims/ual_story.glb` | Talking, tired and sitting idles, pick-up, drink, interact, walk. |

The library's own licence file (`License.txt`): "CC0 1.0 Universal (CC0 1.0) Public Domain Dedication. Models by @Quaternius."

## Guns: `guns/`

| File | Source | Licence |
| --- | --- | --- |
| `guns/Pistol_1.gltf`, `SMG_1.gltf`, `AR_4.gltf`, `Sniper_2.gltf` | Quaternius, Modular Sci-Fi Guns / Sci-Fi Modular Gun Pack (https://quaternius.com). | CC0 1.0, see `guns/License.txt` |
| `guns/thumbs/*.png` | Pictures of those models rendered for the gun menu. | CC0 1.0 (derived from the guns) |
| `guns/thumbs/stun.svg` | Drawn for this project. | Same licence as the project |

## Bosses: `bosses/`

| File | Source | Licence |
| --- | --- | --- |
| `bosses/alpha.glb` | The alpha dog: modelled and animated from scratch in Blender for this project (clips trot, idle, howl, lunge). The design was guided by photographs of four-legged inspection robots; no third-party mesh is used. | Same licence as the project |
