"""
High-level async API for controlling a game character.

Usage:
    bot = MirClient()
    await bot.connect("127.0.0.1", 7000, "Build/Client/Debug/Client.exe")
    chars = await bot.login("account", "password")
    await bot.select_character(0)
    await bot.walk(MirDirection.Up)
"""

import asyncio
import hashlib
import logging
import math
from typing import Callable

from .connection import MirConnection
from .enums import (
    GameStage,
    MirDirection,
    MirClass,
    MirGender,
    Spell,
    ChatType,
    ServerPacketIds,
    MirGridType,
    PanelType,
)
from .packets import (
    C_ClientVersion, C_Disconnect, C_Login,
    C_StartGame, C_LogOut,
    C_Turn, C_Walk, C_Run,
    C_Chat, C_Attack, C_RangeAttack, C_Magic,
    C_UseItem, C_DropItem, C_PickUp, C_DropGold,
    C_MoveItem, C_EquipItem,
    C_CallNPC, C_BuyItem, C_SellItem,
    C_TownRevive,
    S_Connected, S_ClientVersion, S_Login, S_LoginSuccess,
    S_StartGame, S_UserInformation,
    S_LogOutSuccess, S_NPCResponse, S_NPCGoods,
)
from .state import GameState, ObjectInfo, register_state_handlers

log = logging.getLogger(__name__)

# Timing constants (seconds)
WALK_DELAY = 0.6
RUN_DELAY = 0.4
ATTACK_DELAY = 1.0
MAGIC_DELAY = 1.5
ACTION_DELAY = 0.15  # minimum between any two packets

# Direction offset table: MirDirection → (dx, dy)
_DIR_OFFSETS = {
    MirDirection.Up:        ( 0, -1),
    MirDirection.UpRight:   ( 1, -1),
    MirDirection.Right:     ( 1,  0),
    MirDirection.DownRight: ( 1,  1),
    MirDirection.Down:      ( 0,  1),
    MirDirection.DownLeft:  (-1,  1),
    MirDirection.Left:      (-1,  0),
    MirDirection.UpLeft:    (-1, -1),
}


class MirClient:
    """High-level async game bot API."""

    def __init__(self):
        self._conn = MirConnection()
        self._state = GameState()
        self._event_handlers: dict[str, list[Callable]] = {}
        self._waiters: dict[int, list[asyncio.Future]] = {}
        register_state_handlers(self._conn, self._state)
        # Wire internal waiters
        self._conn.on_any_packet(self._dispatch_waiter)

    # -- Properties --

    @property
    def state(self) -> GameState:
        return self._state

    @property
    def connected(self) -> bool:
        return self._conn.connected

    # -- Connection --

    async def connect(self, host: str, port: int, client_exe_path: str):
        """Connect to the game server and pass the version check.

        Args:
            host: Server IP address.
            port: Server port (usually 7000).
            client_exe_path: Path to the game client exe for MD5 version hash.
        """
        # Compute version hash
        md5 = hashlib.md5()
        with open(client_exe_path, "rb") as f:
            for chunk in iter(lambda: f.read(8192), b""):
                md5.update(chunk)
        version_hash = md5.digest()

        await self._conn.connect(host, port)

        # Wait for S_Connected
        await self._wait_for(ServerPacketIds.Connected, timeout=10)
        log.info("Received S_Connected")

        # Send version
        await self._conn.send(C_ClientVersion(version_hash=version_hash))

        # Wait for version check result
        pkt = await self._wait_for(ServerPacketIds.ClientVersion, timeout=10)
        if pkt.result != 1:
            await self._conn.disconnect()
            raise ConnectionError(f"Version check failed: result={pkt.result}")
        log.info("Version check passed")

    async def login(self, account: str, password: str) -> list[dict]:
        """Login and return the character list.

        Returns:
            List of character info dicts with keys: index, name, level, class, gender.
        """
        await self._conn.send(C_Login(account_id=account, password=password))
        pkt = await self._wait_for(ServerPacketIds.LoginSuccess, timeout=10,
                                   alt_ids=[ServerPacketIds.Login])
        if isinstance(pkt, S_Login):
            reasons = {0: "account disabled", 3: "account not found", 4: "wrong password"}
            raise ConnectionError(f"Login failed: {reasons.get(pkt.result, f'code {pkt.result}')}")
        self._state.stage = GameStage.SELECT
        return self._state.characters

    async def select_character(self, index: int) -> GameState:
        """Select a character and enter the game world.

        Args:
            index: Character index from the list returned by login().

        Returns:
            The GameState object (continuously updated).
        """
        await self._conn.send(C_StartGame(character_index=index))

        # Wait for S_StartGame confirmation
        pkt = await self._wait_for(ServerPacketIds.StartGame, timeout=15)
        if pkt.result != 4:
            reasons = {0: "disabled", 1: "not logged in", 2: "load error", 3: "creating"}
            raise ConnectionError(
                f"Start game failed: {reasons.get(pkt.result, f'code {pkt.result}')}")

        # Wait for S_UserInformation
        await self._wait_for(ServerPacketIds.UserInformation, timeout=15)
        log.info("In game as %s (Lv%d %s) at %s",
                 self._state.name, self._state.level,
                 MirClass(self._state.class_).name, self._state.location)
        return self._state

    async def logout(self):
        """Log out to character select."""
        await self._conn.send(C_LogOut())
        await self._wait_for(ServerPacketIds.LogOutSuccess, timeout=10)

    async def disconnect(self):
        """Disconnect from the server."""
        if self._conn.connected:
            try:
                await self._conn.send(C_Disconnect())
            except Exception:
                pass
            await self._conn.disconnect()
        self._state.stage = GameStage.NONE

    # -- Movement --

    async def turn(self, direction: MirDirection):
        """Turn to face a direction."""
        await self._conn.send(C_Turn(direction=int(direction)))
        self._state.direction = direction
        await asyncio.sleep(ACTION_DELAY)

    async def walk(self, direction: MirDirection):
        """Walk one tile in a direction."""
        await self._conn.send(C_Walk(direction=int(direction)))
        dx, dy = _DIR_OFFSETS[direction]
        x, y = self._state.location
        self._state.location = (x + dx, y + dy)
        self._state.direction = direction
        await asyncio.sleep(WALK_DELAY)

    async def run(self, direction: MirDirection):
        """Run two tiles in a direction."""
        await self._conn.send(C_Run(direction=int(direction)))
        dx, dy = _DIR_OFFSETS[direction]
        x, y = self._state.location
        self._state.location = (x + dx * 2, y + dy * 2)
        self._state.direction = direction
        await asyncio.sleep(RUN_DELAY)

    # -- Combat --

    async def attack(self, direction: MirDirection, spell: Spell = Spell.NONE):
        """Physical attack in a direction."""
        await self._conn.send(C_Attack(direction=int(direction), spell=int(spell)))
        self._state.direction = direction
        await asyncio.sleep(ATTACK_DELAY)

    async def cast(self, spell: Spell, target_id: int = 0,
                   location: tuple[int, int] | None = None,
                   direction: MirDirection | None = None):
        """Cast a spell.

        Args:
            spell: The spell to cast.
            target_id: Target object ID (for targeted spells).
            location: Target location (for AoE spells). Defaults to own location.
            direction: Facing direction. Defaults to current.
        """
        if location is None:
            location = self._state.location
        if direction is None:
            direction = self._state.direction
        await self._conn.send(C_Magic(
            object_id=self._state.object_id,
            spell=int(spell),
            direction=int(direction),
            target_id=target_id,
            location=location,
        ))
        await asyncio.sleep(MAGIC_DELAY)

    # -- Items --

    async def use_item(self, unique_id: int, grid: int = MirGridType.Inventory):
        """Use an item from inventory."""
        await self._conn.send(C_UseItem(unique_id=unique_id, grid=grid))
        await asyncio.sleep(ACTION_DELAY)

    async def drop_item(self, unique_id: int, count: int = 1):
        """Drop an item on the ground."""
        await self._conn.send(C_DropItem(unique_id=unique_id, count=count))
        await asyncio.sleep(ACTION_DELAY)

    async def drop_gold(self, amount: int):
        """Drop gold on the ground."""
        await self._conn.send(C_DropGold(amount=amount))
        await asyncio.sleep(ACTION_DELAY)

    async def pick_up(self):
        """Pick up item/gold from the ground."""
        await self._conn.send(C_PickUp())
        await asyncio.sleep(ACTION_DELAY)

    async def move_item(self, grid: int, from_slot: int, to_slot: int):
        """Move an item within a grid (inventory)."""
        await self._conn.send(C_MoveItem(grid=grid, from_=from_slot, to=to_slot))
        await asyncio.sleep(ACTION_DELAY)

    async def equip_item(self, unique_id: int, to_slot: int,
                         grid: int = MirGridType.Inventory):
        """Equip an item."""
        await self._conn.send(C_EquipItem(grid=grid, unique_id=unique_id, to=to_slot))
        await asyncio.sleep(ACTION_DELAY)

    # -- NPC --

    async def talk_to_npc(self, object_id: int, key: str = "@Main") -> list[str]:
        """Talk to an NPC and return the dialog page.

        Args:
            object_id: The NPC's object ID.
            key: Dialog key (default "@Main" for initial dialog).

        Returns:
            List of dialog page strings.
        """
        self._state.npc_page = []
        await self._conn.send(C_CallNPC(object_id=object_id, key=key))
        pkt = await self._wait_for(ServerPacketIds.NPCResponse, timeout=10)
        return self._state.npc_page

    async def buy_item(self, item_index: int, count: int = 1,
                       panel_type: int = PanelType.Buy):
        """Buy an item from an NPC shop."""
        await self._conn.send(C_BuyItem(
            item_index=item_index, count=count, panel_type=panel_type))
        await asyncio.sleep(ACTION_DELAY)

    async def sell_item(self, unique_id: int, count: int = 1):
        """Sell an item to an NPC."""
        await self._conn.send(C_SellItem(unique_id=unique_id, count=count))
        await asyncio.sleep(ACTION_DELAY)

    # -- Chat --

    async def say(self, message: str):
        """Send a chat message."""
        await self._conn.send(C_Chat(message=message))
        await asyncio.sleep(ACTION_DELAY)

    # -- Revive --

    async def revive(self):
        """Revive at town."""
        await self._conn.send(C_TownRevive())
        await self._wait_for(ServerPacketIds.Revived, timeout=15)
        self._state.dead = False

    # -- Events --

    def on(self, event: str, callback: Callable):
        """Register an event callback.

        Supported events: "chat", "struck", "death", "object_player",
        "object_monster", "object_died", "damage", "level_up", "any".
        """
        self._event_handlers.setdefault(event, []).append(callback)

    def on_packet(self, packet_id: int, callback: Callable):
        """Register a raw packet handler."""
        self._conn.on_packet(packet_id, callback)

    # -- Helpers --

    async def wait(self, seconds: float):
        """Async sleep helper."""
        await asyncio.sleep(seconds)

    async def wait_disconnect(self):
        """Block until disconnected."""
        await self._conn.wait_disconnect()

    def nearby_monsters(self, alive_only: bool = True) -> list[ObjectInfo]:
        """Get list of nearby monsters, sorted by distance."""
        monsters = list(self._state.monsters.values())
        if alive_only:
            monsters = [m for m in monsters if not m.dead]
        my_loc = self._state.location
        monsters.sort(key=lambda m: _distance(my_loc, m.location))
        return monsters

    def nearby_players(self) -> list[ObjectInfo]:
        """Get list of nearby players, sorted by distance."""
        players = list(self._state.players.values())
        my_loc = self._state.location
        players.sort(key=lambda p: _distance(my_loc, p.location))
        return players

    def find_npc(self, name: str) -> ObjectInfo | None:
        """Find a nearby NPC by name (case-insensitive)."""
        name_lower = name.lower()
        for npc in self._state.npcs.values():
            if name_lower in npc.name.lower():
                return npc
        return None

    def find_item_in_inventory(self, name: str) -> dict | None:
        """Find an item in inventory by name. Requires item_infos to be populated."""
        name_lower = name.lower()
        for item in self._state.inventory:
            if item is None:
                continue
            info = self._state.item_infos.get(item.get("item_index"))
            if info and name_lower in info.get("name", "").lower():
                return item
        return None

    def direction_to(self, target: tuple[int, int]) -> MirDirection:
        """Calculate the MirDirection from current location to a target."""
        return calc_direction(self._state.location, target)

    # -- Internal --

    async def _wait_for(self, packet_id: int, timeout: float = 10,
                        alt_ids: list[int] | None = None):
        """Wait for a specific packet (or one of alt_ids) and return it."""
        ids = [packet_id] + (alt_ids or [])
        futures = []
        for pid in ids:
            fut = asyncio.get_event_loop().create_future()
            self._waiters.setdefault(pid, []).append(fut)
            futures.append(fut)

        try:
            done, pending = await asyncio.wait(
                futures, timeout=timeout, return_when=asyncio.FIRST_COMPLETED)
            for f in pending:
                f.cancel()
            if not done:
                raise TimeoutError(f"Timed out waiting for packet {packet_id}")
            return done.pop().result()
        finally:
            # Clean up waiters
            for pid in ids:
                waiters = self._waiters.get(pid, [])
                for f in futures:
                    if f in waiters:
                        waiters.remove(f)

    def _dispatch_waiter(self, pkt):
        """Dispatch received packet to any waiting futures."""
        pid = pkt.packet_id
        waiters = self._waiters.get(pid, [])
        for fut in waiters[:]:
            if not fut.done():
                fut.set_result(pkt)


# -- Module-level utility functions --

def _distance(a: tuple[int, int], b: tuple[int, int]) -> float:
    """Chebyshev distance (grid distance)."""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def calc_direction(from_: tuple[int, int], to: tuple[int, int]) -> MirDirection:
    """Calculate the MirDirection from one point to another."""
    dx = to[0] - from_[0]
    dy = to[1] - from_[1]

    if dx == 0 and dy == 0:
        return MirDirection.Up

    # Use atan2 to get angle, map to 8 directions
    angle = math.atan2(dy, dx)  # radians, 0 = east
    # Convert to 0-7 index: 0=Up, 1=UpRight, ..., 7=UpLeft
    # atan2 gives: 0=right, pi/2=down, -pi/2=up
    # We want: 0=up, 1=upright, 2=right, 3=downright, ...
    # Rotate by -pi/2 to make up=0, then normalize
    index = round((angle + math.pi / 2) / (math.pi / 4)) % 8
    return MirDirection(index)
