# What the browser client still cannot do that 1.76 could

A systematic comparison rather than a list of impressions. Written 2026-09-15, after the
craft window went in; the fixes it prompted are in the same commit range.

## Method

Three passes, each mechanical enough to repeat:

1. **Every packet class, not every enum name.** `Shared/ServerPackets.cs` and
   `ClientPackets.cs` define 278 and 153 `Packet` subclasses. The gateway forwards each
   server packet to the browser under `packet.GetType().Name`, so the class name is what a
   `case` in the browser has to match -- the enum name is sometimes different
   (`ServerPacketIds.ObjectNpc` is class `ObjectNPC`), and auditing the enum produces false
   findings. Cross-referencing the class names against every `case "X":` in `src/*.js` gives
   what the browser ignores; against the `"X" => typeof(C.X)` table in `GameSession.cs`
   gives what it can never send.
2. **Filter by what this pack can actually produce.** A packet the server cannot send while
   running mir-176 is not a gap. The deciding evidence is the pack's own content: the 33
   skills in `docs/reports/mir-176-import.md`, the scripts under `Packs/mir-176/Envir/NPCs`,
   and `Envir/Recipe`. Mail, the auction house, heroes, pets, awakening, fishing, mounts,
   rentals, rankings and the game shop all postdate 1.76 and nothing in the pack reaches
   them.
3. **Check the survivors against the native client**, so the fix reproduces Crystal's own
   behaviour rather than inventing one.

Re-run the counting pass:

```sh
python3 - <<'PY'
import re, glob
cls = lambda p: re.findall(r'public (?:sealed )?class (\w+)\s*:\s*Packet', open(p, encoding='utf-8').read())
handled = set()
for f in glob.glob('Client.Web/src/*.js'):
    handled |= set(re.findall(r'case "([A-Za-z0-9_]+)":', open(f, encoding='utf-8').read()))
sent = set(re.findall(r'"([A-Za-z0-9_]+)" => typeof\(C\.', open('Client.Web/GameSession.cs', encoding='utf-8').read()))
print([n for n in cls('Shared/ServerPackets.cs') if n not in handled])
print([n for n in cls('Shared/ClientPackets.cs') if n not in sent])
PY
```

Coverage moved from 126/278 server packets and 51/153 client commands to **141/278 and
53/153**. The number is not the point -- most of the remainder is content 1.76 never had --
but it is what the audit is measured against.

## What the audit found, worst first

### Five of 1.76's 33 skills could not be used at all

This is the finding that mattered. `src/skills.js` maps a spell to an aiming mode, and a
spell with no entry answered "此技能暂未接入". Cross-referencing the table against the 33
skills the import produced:

| 技能 | Spell | Why it was unreachable |
| --- | --- | --- |
| 瞬息移动 | Teleport (37) | simply missing from `skillModes` |
| 野蛮冲撞 | ShoulderDash (5) | simply missing from `skillModes` |
| 刺杀剑术 | Thrusting (3) | not a cast at all -- `C.SpellToggle`, which the gateway did not forward |
| 半月弯刀 | HalfMoon (4) | same |
| 烈火剑法 | FlamingSword (8) | armed by `C.SpellToggle`, then rides on the next swing |

The last three are a subsystem, not three switches. `HumanObject.Attack(dir, spell)` takes a
`Spell` on the ordinary attack packet and 1.76's four melee skills travel on it: 攻杀剑术
(Slaying), which the **server** arms on a roll of its own and announces with
`S.SpellToggle`, and the three above, which the player arms. The gateway refused all of
them outright:

```csharp
if (packet is C.Attack attack && (... || attack.Spell != Spell.None))
    throw new InvalidDataException("Only basic attacks are supported");
```

`src/sword-arts.js` is the subsystem: the switches, the arming, and `attackSpell()`, which
reproduces `Client/MirObjects/PlayerObject.cs:1355-1420` -- four sequential ifs, so the last
one that matches wins, 刺杀 wanting the *second* cell ahead occupied and 半月 sweeping the
facing direction plus its neighbours (`MapControl.CanHalfMoon`).

野蛮冲撞 needed one more thing: `S.UserDash` arrives once per cell crossed, and a client
that ignores it leaves the player standing where the server no longer thinks they are. That
is a desynchronised position, not a missing animation.

### Every colour the server sent arrived empty

`System.Drawing.Color` exposes R, G and B as get-only properties, and this gateway's
serialiser strips get-only properties (so that `UserItem.IsAdded` and friends do not
explode on a packet whose `Info` was never resolved). The consequence was silent:

```
{"ObjectID":3,"NameColour":{}}
```

Eight server packets carry a colour, and for a player it is not decoration.
`PlayerObject.GetNameColour` is where 1.76 says **红名** (`PKPoints >= 200` -> `Color.Red`),
**灰名** (`BrownTime` -> `SaddleBrown`), and which side of a guild war someone is on
(green / blue / orange). None of it could reach the screen. A `JsonConverter<Color>` writing
`"#rrggbb"` -- and `null` for an unset colour, so the browser keeps its own default rather
than painting names black -- fixed all eight at once.

### Smaller, and each one a thing a player would notice

| Packet | What was missing |
| --- | --- |
| `ObjectLeveled` | the level-up flash on anyone who levels, your own character included |
| `ObjectName` | a renamed object kept its old label, which is cached by object id |
| `InTrapRock` | 困魔咒 holds a player still and the server says so **only** here; without it the client looks broken rather than trapped, and keeps asking to move |
| `UpdateNotice` | 公告 -- the pack ships `Envir/Notice.txt` and the server sends it when it changed since your last logout |
| `ItemUpgraded` | the weapon coming back from 修炼 carries its new stats here and nowhere else |
| `PlayerInspect` + `C.Inspect` | 查看装备: the one thing 1.76 lets you look at on another player |

## What is missing and still missing

Unchanged from `docs/mir-176-open-items.md`, and none of it is a packet-level oversight --
each is a system with a UI attached:

- **行会 / 沙巴克** -- 15 packets. Deprioritised by the account owner, not cancelled.
- **师徒** -- `9helper-0` on Bichon carries the whole menu.
- **结婚 / 离婚** -- `9marryman` (月老) on `M101`.
- **好友列表** -- `FriendUpdate` and four commands. Whether 1.76 itself had this has not
  been settled from the sources, so it is listed rather than claimed.
- **Buff icon strip**, **binding a newly learned spell**.

## What is correctly absent

Checked, and nothing in the pack can reach them: mail, the auction house and trust
merchant, the game shop, rankings, heroes, companions and pets, awakening, socketing,
disassembly, downgrading, fishing, item rental, mounts, observing, the world-map teleporter,
`Roll` (`ROLLDIE`/`ROLLYUT` appear nowhere in the pack), quests (`MapQuest_def/` was empty),
`SetCompass`, `SetTimer`/`ExpireTimer`, `MapEffect` (mining only), and `OpenBrowser`.

`TIMERECALL`, which six pack scripts do use, needed nothing: it is a server-side delayed
action with no client packet at all.
