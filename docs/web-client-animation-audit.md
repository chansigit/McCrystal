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

**Done** on `feature/web-client-animation`. Every actor now carries a current
action and the timestamp that action began, and the frame is measured from that
start; the shared clock is gone. `src/entity-action.js` holds the rules and
`World.resolveAction` picks the action. The row above therefore reads, today:
frame cursor recomputed each draw from the action's own elapsed time, anchored on
the action's start, for monsters and NPCs as well as players.

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

**Done.** `src/monster-overlay.js` is the whole switch as data: 85 monsters,
348 rows, sharing the body's own frame cursor.

It was not transcribed. A parser walked the C# with brace tracking and pulled
out the monster and action labels, the library, the blend flag, the guards and
the frame expression; then every one of the 275 expressions was evaluated in
both forms over nine frame-and-direction pairs and compared. All 275 agreed.
Hand-work was needed only for the Behemoth aura, which sits after its action
switch rather than inside a case.

The Hydra is the regression guard: its row reproduces the old hand-written
`+400` shortcut exactly, over every direction and step, which is what the test
asserts. Native's own oddities are kept rather than corrected -- `FrostTiger`
still reads the `ManTree` library, and its overlay still waits for the spawn
`Effect` byte.

## Actions the web cannot render

The fallback chain ends at Standing, so anything outside a short list silently
renders as an idle pose. Measured across the 468 monster libraries that carry a
frame table:

| Action | Libraries with it | Web rendered | Web renders now |
| --- | --- | --- | --- |
| Struck | 394 | never, a pink tint instead | the real animation; the tint is kept only where a library declares no Struck |
| Revive | 345 | never | the real animation, on `S.ObjectRevived` |
| Attack2 | 136 | as Attack1 | Attack2, chosen by `Type` |
| AttackRange1 | 102 | as Attack1 | AttackRange1, falling back to Attack1 |
| Attack3 | 50 | as Attack1 | Attack3, chosen by `Type` |
| Show / Hide | 27 / 21 | only the Hydra | all of them |
| Running | 1 | as Standing | Walking |

`S.ObjectAttack` carries a `Type` field selecting Attack1 through Attack5, and
`S.ObjectRangeAttack` carries its own. **Done**: both are handled, and the
fallback chain is native's own (`AttackRange1`→`Attack1`, `Pushed`→`Walking`,
`Special`→`Attack1`, `Skeleton`→`Dead`) plus `Attack2..5`→`Attack1`, which native
does not do only because there it leaves the monster undrawn.

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

All three of `S.ObjectEffect`, `S.ObjectProjectile` and `S.ObjectSpell` are now
handled.

`S.ObjectEffect` is `src/object-effect.js`, GameScene's 33-case switch as data:
heals, teleport flashes, bleeding, hemorrhage, the magic shield and elemental
barrier with their Down twins clearing them, the awakening results with their
delayed pairs, stuns and webs that repeat for the duration the packet carries,
and the boss effects. Effects now have a real lifetime -- a delayed start, an
additive or opaque draw, a repeat-until deadline, a draw-behind band, and a
target they follow -- which is what the flat table could not express.

`S.ObjectProjectile` is `src/missile.js`. Native has exactly one projectile,
FireBounce: it flies 50 ms a cell along one of sixteen headings, re-aims at its
target while in flight, and lands an impact effect on arrival unless the target
died on the way.

`S.ObjectSpell` is `src/spell-object.js` is `SpellObject.Load`'s switch
as data, so the fire wall, the poison cloud, blizzard, meteor strike, the traps,
the portal, the healing circle and the boss ground attacks stand on their cell
until an `ObjectRemove`, additive at native's 0.8 where `Blend` is set. Direction
strides, the explosive trap's armed/detonating flag, `AnimationOffset` and the
companion effects several entries add beside themselves are all carried across.
This needed no gateway change: the packet was always arriving and being dropped.

## Timing

Player-side timing is correct: attack, cast and harvest all resolve to the
native 600 ms. Walk and run are about 8 percent slow, uniformly.

Monster-side had two real defects. Attack duration was hardcoded to 600 ms while
the manifest already carries the true count and interval, so 124 of 376
monsters were cut off mid-swing. And the frame phase came from the wall clock,
as above. **Both are done**: a monster's swing now runs for `count * interval`
from its own library, and a replay over all 510 monster libraries confirms the
124 figure and that every attack now sweeps its frames once, in order.

The web's continuous position interpolation is smoother than native's six
discrete steps. Keep it. Only the frame phase needs anchoring.

## Priorities

**Group 1, table work only.** No new mechanism, no assets, no gateway change,
except where noted.

1. ~~Anchor monster frames to action start.~~ **Done.** Prerequisite for 2 and 3.
2. ~~The 275-call overlay table.~~ **Done**, all 275 calls over 85 monsters.
3. ~~Attack variant from `Type`, plus handling `ObjectRangeAttack`.~~ **Done.**
4. ~~Struck animation.~~ **Done.**
5. ~~Per-monster attack duration from the manifest.~~ **Done.**
6. ~~The `Blend` flag, which `GameAssets.cs:96` reads off the stream and
   discards.~~ **Done**, 22 animation entries over `BoneFamiliar`, `HolyDeva`,
   `Tornado` and `BlueSoul`.
7. ~~Native's own action fallbacks: ranged to melee, pushed to walking.~~ **Done.**
8. ~~Running falling back to Walking rather than Standing.~~ **Done.**
9. ~~Revive animation.~~ **Done.**
10. ~~Generalise Show and Hide beyond the Hydra.~~ **Done**, including native's
    two end-of-Hide lists: the seven burrowers that leave the map and the
    sixteen statues that freeze into their `Stoned` pose.
11. ~~Player attack variety.~~ **Done.** Native only rolls for a warrior, wizard or
    taoist when shift is held with no target: one in five is Attack3. The Assassin's
    own weights wait for its body set.
12. ~~Player Struck and Stance.~~ **Done.** FrameSet.Player is now complete, so a
    player has real Struck frames at 360 and stands ready for 2.5 seconds after a swing.
    Stance2 stays open: it is the Blizzard channel pose, and Blizzard has no channel here.
13. ~~Poison body tints and status dots.~~ **Done**, both tables, and they are not the
    same order: the tint is a priority switch and the dots are drawn in flag order.
14. ~~Per-monster manual draw offsets, which put EvilMir and the siege gates 10
    to 45 pixels off.~~ **Done.**
15. ~~The 8 percent walk and run cadence.~~ **Done.** The server allows a step every
    600 ms and queues an early one for retry rather than refusing it, so the 630 the
    browser used was 5 per cent of walking speed given away for nothing.

**Group 2, needs a new mechanism.** An effect object with a lifetime, and then
cast and impact separation, projectiles, server-pushed one-shot effects, ground
spells, a draw-behind band, buff auras that stop gracefully, frame sub-loops,
backlog catch-up, and weapon trails.

**Group 3, asset or protocol work.** Mounts and wings are **done**, and neither
needed a gateway change. A mount swaps five actions for the mount library's own,
whose frames start exactly where the player table's MountStanding does -- the
library is 216 frames, which is 632 - 416 to the frame. Wings ride the parallel
effect strip, which lives in FrameSet.Player for a player and so was never the
gateway's to discard; the earlier note was wrong about that.

Transforms are **done** as well: a transformed player draws Data/Transform, or
Data/TransformRide2 at -416 when riding a mount above type 6, with the hair and
both weapons cleared and every attack collapsed onto Attack1.

**The Assassin and Archer body sets are deliberately not done.** This server's
`Configs/Setup.ini` carries `AllowCreateAssassin=False` and
`AllowCreateArcher=False`, which is right for a 1.76 pack -- neither class
existed then. Their body sets, the `altAnim` rule that swaps a bow-carrying
Archer onto ARArmour for Walking, Running, AttackRange1/2 and Jump, and the
Assassin's dual AWeapon L and R would be code no character on this server can
reach. If the pack ever enables them, the rule is at
`Client/MirObjects/PlayerObject.cs:365-600`.

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

## The statue that was never stoned

Found by the user in play, not by this audit. Native reads
`S.ObjectMonster.Extra` into `Stoned` in the `MonsterObject` constructor, before
the first action is chosen (`Client/MirObjects/MonsterObject.cs:239-253`), so a
statue that is already dormant when it comes into view renders in its `Stoned`
pose. The web client never read the field: `entity.stoned` was only ever set by
watching a Hide animation finish, so every statue stood up and animated the
moment it appeared.

The spawn list is shorter than the end-of-Hide list. Native never reads `Extra`
for `RedThunderZuma` or `FrozenRedZuma`, so the two sets are kept apart.

The server end was verified rather than assumed: `ZumaMonster.GetInfo` sets
`packet.Extra = Stoned` (`Server/MirObjects/Monsters/ZumaMonster.cs:180-184`),
and a gateway test now pins the field through serialization. `ZumaTaurus`
inherits that class, which is why the boss room is the cleanest single-subject
test on the server.

Two things about the server behaviour make this hard to observe, and both cost a
long detour before they were understood:

* A statue wakes when a non-GM player comes within 2 cells, and waking runs
  `WakeAll(14)`, which wakes every statue within 14 cells. **Nothing ever sets
  `Stoned` back to true.** Once a floor is walked, it stays awake until the
  monsters die and respawn, so a burnt cluster cannot be used to test the fix.
* `FindNearby` skips players with `GMGameMaster` (`MonsterObject.cs:2244`), and
  only that flag. `@SUPERMAN` sets `GMNeverDie`, which does nothing here.

## Never implemented, versus implemented but wrong

The animation code has four commits: the initial migration, one fidelity pass,
one pixel-crispness change, and hair. Searching the history finds no occurrence
of `Scarecrow`, of `Struck` as an action, or of `AttackRange`. The Hydra overlay
appears once, in the initial migration, and was never generalised.

So everything above was never implemented, with three exceptions that are
genuine bugs rather than missing features:

1. Monster frame phase is anchored to the wrong clock. **Fixed.**
2. Monster attack duration ignores data that is already loaded. **Fixed.**
3. The gateway reads the `Blend` byte and throws it away. **Fixed.**

A fourth is borderline: the 2600 ms attack lockout for two monster images is a
workaround for the phase bug and should be deleted once frames are anchored,
not tuned. **Deleted.**

## What landed, and what it cost

Group 1 items 1, 3, 4, 5, 6, 7, 8, 9, 10 and 14 are done on
`feature/web-client-animation`. The one gateway change is the `Blend` byte in
`GameAssets.cs`. On the browser side the frame cursor moved into
`Client.Web/src/entity-action.js`, a pure module with its own tests, and
`World.draw` now runs one code path for every actor instead of four.

Two deliberate departures from native, both recorded in the code:

* `Attack2`..`Attack5` fall back to `Attack1`. Native leaves `Frame` null there
  and stops drawing the monster; without the fallback, choosing a variant by
  packet `Type` would have made monsters that lack the variant disappear.
* The pink struck tint is kept, but only where the library declares no `Struck`
  frames, which is players, NPCs and 27 monster libraries. Where the real
  animation plays, it is the hit feedback on its own.

One deliberate restriction: the generic default frame table (native's
`FrameSet.DefaultMonster`) is now reachable only for a library that carries no
animation table at all, which is what native does. A tabled library that omits
`Struck` or `Revive` gets no animation rather than an invented one.
