# Web client animation audit

Date: 2026-09-07, against `main` at `57bec187`. Goes one level below
`docs/web-client-gap-analysis.md`, which should be read first. Prompted by a
concrete observation: the Scarecrow's burning overlay on death does not happen
in the browser.

Counts marked "measured" come from parsing all 510 `Data/Monster/*.Lib` files
directly, because the per-monster frame tables live in the asset files, not in
C#.

## The root difference

| | Native | Web |
| --- | --- | --- |
| Action source | `ActionFeed` queue popped by `SetAction()` (`MonsterObject.cs:471`) | Three timestamp windows plus `Dead`/`moving` (`world.js:576-586`) |
| Frame cursor | Stateful `FrameIndex` advanced when `CMain.Time >= NextMotion` | Recomputed each draw from a clock (`world.js:414-425`) |
| Clock anchor | The action's own start | **`performance.now()`**, i.e. a global wall clock (`world.js:594`) |
| Overlay layer | 275 additive draws over 71 monsters (`MonsterObject.cs:4330-5597`) | One monster (`world.js:684`) |
| Independent effects | An `Effect` object graph with lifetimes and chaining | Two flat lookup tables (`world.js:248-278`) |

The wall-clock anchor is the most consequential single defect. Because every
monster shares one clock, all monsters of the same image are on the same frame
at the same instant, six ants swing in perfect unison, and an attack can begin
mid-swing or wrap. It also blocks the overlay work below, since those tables are
indexed by a `FrameIndex` the web does not currently have.

## The overlay table

275 draw calls over 71 monsters, all reading libraries the gateway already
serves. No new assets and no protocol change are needed.

| Kind | Calls | Example |
| --- | --- | --- |
| Additive overlay keyed on action, direction and frame | 229 | `DarkCaptain` (10 actions), `KingGuard` |
| Additive overlay with no direction term | 46 | **`Scarecrow` on death** (`224 + FrameIndex`), skeleton dust |
| Offset-corrected window | 23 guards | `OmaKing`, `HellSlasher` |
| Opaque second body layer | 9 | `HolyDeva` halo, `HellLord` throne |
| Unconditional aura stacking with the per-action layer | 1 | `Behemoth`, four layers on Attack1 |
| Overlay index relative to the live frame table | 3 | `GreatFoxSpirit`, whose stage shifts `Frame.Start` |
| Tinted, gated on the spawn `Effect` byte | 7 | `FrostTiger` |
| Reverse-scanned | 1 | `WaterDragon` submerging |

The one implemented entry, the Hydra, was verified frame by frame against
`Monster/371.Lib` and is exactly right, including the reversed Hide. Its `+400`
shortcut does not generalise: other monsters use per-monster and sometimes
per-action deltas.

What a player loses: 70 of 71 monsters render as a plain body. The five bead
monsters lose the only thing that makes them visible. Every boss loses its
visual identity.

## Actions the web cannot render

The fallback chain ends at Standing, so anything outside a short list silently
renders as an idle pose. Measured across the 468 monster libraries that carry a
frame table:

| Action | Libraries with it | Web renders |
| --- | --- | --- |
| Struck | 394 | never, a pink tint instead |
| Revive | 345 | never |
| Attack2 | 136 | as Attack1 |
| AttackRange1 | 102 | as Attack1 |
| Attack3 | 50 | as Attack1 |
| Show / Hide | 27 / 21 | only the Hydra |
| Running | 1 | as Standing |

`S.ObjectAttack` carries a `Type` field selecting Attack1 through Attack5, and
`S.ObjectRangeAttack` carries its own. The web ignores `Type` and never handles
the ranged packet, so the second and third attacks of 136 and 50 monsters are
invisible.

## What the effect model cannot express

Native `Effect` objects carry a library, base index, count, duration, delayed
start, blend and rate, light, repeat and repeat-until, inter-loop delay, a
draw-behind flag, an owner they follow, and `Complete`/`Played` events. There
are 634 construction sites plus 84 projectile spawns.

The web has two lookup tables of `{library, start, count, duration}` fired at
packet receipt. Structurally out of reach:

- Cast and impact are simultaneous, so nothing has flight time.
- Effects cannot follow a moving actor on the cast side.
- Homing projectiles re-derive their duration and frame count mid-flight over a
  16-way direction strip.
- Completion chaining, 77 handlers, including two-level chains and effects that
  complete onto a different actor.
- Durations slaved to the spawning actor's own frame table, 211 sites.
- Simultaneous layers with different blend and phase.
- Effects drawn behind the actor.
- Effects at derived cells, such as HellFire walking four cells outward.
- Effects that repeat until a packet stops them, and that finish their cycle
  rather than being cut.
- Effects that self-terminate on polled state, or freeze mid-animation while a
  channel is interrupted.
- Sprite index derived from direction, spell level, other active buffs, or
  randomness.
- Weapon swing trails, which are inline overlays with no independent lifetime.

`S.ObjectEffect`, `S.ObjectProjectile` and `S.ObjectSpell` are not handled at
all, so ground spells such as fire walls and poison clouds do not exist.

## Timing

Player-side timing is correct: attack, cast and harvest all resolve to the
native 600 ms. Walk and run are about 8 percent slow, uniformly.

Monster-side has two real defects. Attack duration is hardcoded to 600 ms while
the manifest already carries the true count and interval, so 124 of 376
monsters are cut off mid-swing. And the frame phase comes from the wall clock,
as above.

The web's continuous position interpolation is smoother than native's six
discrete steps. Keep it. Only the frame phase needs anchoring.

## Priorities

**Group 1, table work only.** No new mechanism, no assets, no gateway change,
except where noted.

1. Anchor monster frames to action start. Prerequisite for 2 and 3.
2. The 275-call overlay table.
3. Attack variant from `Type`, plus handling `ObjectRangeAttack`.
4. Struck animation.
5. Per-monster attack duration from the manifest.
6. The `Blend` flag, which `GameAssets.cs:96` reads off the stream and discards.
   One line, four monsters.
7. Native's own action fallbacks: ranged to melee, pushed to walking.
8. Running falling back to Walking rather than Standing.
9. Revive animation.
10. Generalise Show and Hide beyond the Hydra.
11. Player Attack2/3/4 variety, chosen by weighted random natively.
12. Player Struck, Stance and Stance2.
13. Poison body tints and status dots.
14. Per-monster manual draw offsets, which put EvilMir and the siege gates 10 to
    45 pixels off.
15. The 8 percent walk and run cadence, after checking it against the server's
    move delay.

**Group 2, needs a new mechanism.** An effect object with a lifetime, and then
cast and impact separation, projectiles, server-pushed one-shot effects, ground
spells, a draw-behind band, buff auras that stop gracefully, frame sub-loops,
backlog catch-up, and weapon trails.

**Group 3, asset or protocol work.** All the asset directories already exist and
are already served. Assassin and Archer body sets need the per-action alternate
rule and per-branch female offsets. Mounts and transforms need no gateway
change. Wings do, because they use the parallel effect frame strip that the
gateway currently discards.

## Do not "fix" these

The Hydra overlay is exactly right. Continuous position interpolation is better
than native. Player-side phase alignment is more correct than native's global
100 ms heartbeat, and should be extended to monsters rather than replaced. The
weapon back and front rule, the hair-after-body order, and the harvest pickaxe
substitution all match native exactly. Declining to draw class weapons against
the wrong body is a deliberate correct choice. Death frames are preloaded, which
native does not do.

Native's own broken parts, which should not be copied: the grayscale and opacity
shader paths are dead; `AttackRange3` and `Attack5` freeze a player; the
Assassin dual-weapon bounds checks are cross-wired; `FrostTiger` reads the
`ManTree` library; `StoningStatue` plays a sound from inside the draw path.

## Never implemented, versus implemented but wrong

The animation code has four commits: the initial migration, one fidelity pass,
one pixel-crispness change, and hair. Searching the history finds no occurrence
of `Scarecrow`, of `Struck` as an action, or of `AttackRange`. The Hydra overlay
appears once, in the initial migration, and was never generalised.

So everything above was never implemented, with three exceptions that are
genuine bugs rather than missing features:

1. Monster frame phase is anchored to the wrong clock.
2. Monster attack duration ignores data that is already loaded.
3. The gateway reads the `Blend` byte and throws it away.

A fourth is borderline: the 2600 ms attack lockout for two monster images is a
workaround for the phase bug and should be deleted once frames are anchored,
not tuned.
