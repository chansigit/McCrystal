"""
Packet definitions matching Shared/ClientPackets.cs and Shared/ServerPackets.cs.

Wire format (from Shared/Packet.cs):
  [uint16 LE total_length] [int16 LE packet_id] [payload ...]

For compressed packets (e.g. NPCGoods), the payload is GZip-compressed.
"""

import gzip
import struct
from .codec import BinaryReader, BinaryWriter
from .enums import (
    ClientPacketIds,
    ServerPacketIds,
    MirDirection,
    MirClass,
    MirGender,
    Spell,
    ChatType,
    MirGridType,
    PanelType,
    DamageType,
    BuffType,
)


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------

class Packet:
    packet_id: int = -1
    compressed: bool = False

    def read_packet(self, reader: BinaryReader):
        pass

    def write_packet(self, writer: BinaryWriter):
        pass

    def to_bytes(self) -> bytes:
        w = BinaryWriter()
        self.write_packet(w)
        payload = w.to_bytes()
        if self.compressed:
            payload = gzip.compress(payload)
        # [uint16 total_len] [int16 packet_id] [payload]
        total_len = 2 + 2 + len(payload)
        header = struct.pack("<Hh", total_len, self.packet_id)
        return header + payload

    def __repr__(self):
        name = type(self).__name__
        attrs = {k: v for k, v in self.__dict__.items() if not k.startswith("_")}
        return f"{name}({attrs})"


# ---------------------------------------------------------------------------
# Registry helpers
# ---------------------------------------------------------------------------

_SERVER_PACKETS: dict[int, type] = {}
_CLIENT_PACKETS: dict[int, type] = {}


def _register_server(cls):
    _SERVER_PACKETS[cls.packet_id] = cls
    return cls


def _register_client(cls):
    _CLIENT_PACKETS[cls.packet_id] = cls
    return cls


def parse_server_packet(packet_id: int, data: bytes) -> Packet | None:
    cls = _SERVER_PACKETS.get(packet_id)
    if cls is None:
        return None
    pkt = cls()
    if pkt.compressed:
        data = gzip.decompress(data)
    pkt.read_packet(BinaryReader(data))
    return pkt


# ===================================================================
# CLIENT PACKETS (sent by the bot)
# ===================================================================

@_register_client
class C_ClientVersion(Packet):
    packet_id = ClientPacketIds.ClientVersion

    def __init__(self, version_hash: bytes = b""):
        self.version_hash = version_hash

    def write_packet(self, w: BinaryWriter):
        w.write_int32(len(self.version_hash))
        w.write_bytes(self.version_hash)


@_register_client
class C_Disconnect(Packet):
    packet_id = ClientPacketIds.Disconnect


@_register_client
class C_KeepAlive(Packet):
    packet_id = ClientPacketIds.KeepAlive

    def __init__(self, time: int = 0):
        self.time = time

    def write_packet(self, w: BinaryWriter):
        w.write_int64(self.time)


@_register_client
class C_Login(Packet):
    packet_id = ClientPacketIds.Login

    def __init__(self, account_id: str = "", password: str = ""):
        self.account_id = account_id
        self.password = password

    def write_packet(self, w: BinaryWriter):
        w.write_string(self.account_id)
        w.write_string(self.password)


@_register_client
class C_NewCharacter(Packet):
    packet_id = ClientPacketIds.NewCharacter

    def __init__(self, name: str = "", gender: int = 0, class_: int = 0):
        self.name = name
        self.gender = gender
        self.class_ = class_

    def write_packet(self, w: BinaryWriter):
        w.write_string(self.name)
        w.write_byte(self.gender)
        w.write_byte(self.class_)


@_register_client
class C_DeleteCharacter(Packet):
    packet_id = ClientPacketIds.DeleteCharacter

    def __init__(self, character_index: int = 0):
        self.character_index = character_index

    def write_packet(self, w: BinaryWriter):
        w.write_int32(self.character_index)


@_register_client
class C_StartGame(Packet):
    packet_id = ClientPacketIds.StartGame

    def __init__(self, character_index: int = 0):
        self.character_index = character_index

    def write_packet(self, w: BinaryWriter):
        w.write_int32(self.character_index)


@_register_client
class C_LogOut(Packet):
    packet_id = ClientPacketIds.LogOut


@_register_client
class C_Turn(Packet):
    packet_id = ClientPacketIds.Turn

    def __init__(self, direction: int = 0):
        self.direction = direction

    def write_packet(self, w: BinaryWriter):
        w.write_byte(self.direction)


@_register_client
class C_Walk(Packet):
    packet_id = ClientPacketIds.Walk

    def __init__(self, direction: int = 0):
        self.direction = direction

    def write_packet(self, w: BinaryWriter):
        w.write_byte(self.direction)


@_register_client
class C_Run(Packet):
    packet_id = ClientPacketIds.Run

    def __init__(self, direction: int = 0):
        self.direction = direction

    def write_packet(self, w: BinaryWriter):
        w.write_byte(self.direction)


@_register_client
class C_Chat(Packet):
    packet_id = ClientPacketIds.Chat

    def __init__(self, message: str = ""):
        self.message = message

    def write_packet(self, w: BinaryWriter):
        w.write_string(self.message)
        w.write_int32(0)  # linked items count


@_register_client
class C_MoveItem(Packet):
    packet_id = ClientPacketIds.MoveItem

    def __init__(self, grid: int = 0, from_: int = 0, to: int = 0):
        self.grid = grid
        self.from_ = from_
        self.to = to

    def write_packet(self, w: BinaryWriter):
        w.write_byte(self.grid)
        w.write_int32(self.from_)
        w.write_int32(self.to)


@_register_client
class C_EquipItem(Packet):
    packet_id = ClientPacketIds.EquipItem

    def __init__(self, grid: int = 0, unique_id: int = 0, to: int = 0):
        self.grid = grid
        self.unique_id = unique_id
        self.to = to

    def write_packet(self, w: BinaryWriter):
        w.write_byte(self.grid)
        w.write_uint64(self.unique_id)
        w.write_int32(self.to)


@_register_client
class C_UseItem(Packet):
    packet_id = ClientPacketIds.UseItem

    def __init__(self, unique_id: int = 0, grid: int = MirGridType.Inventory):
        self.unique_id = unique_id
        self.grid = grid

    def write_packet(self, w: BinaryWriter):
        w.write_uint64(self.unique_id)
        w.write_byte(self.grid)


@_register_client
class C_DropItem(Packet):
    packet_id = ClientPacketIds.DropItem

    def __init__(self, unique_id: int = 0, count: int = 1, hero_inventory: bool = False):
        self.unique_id = unique_id
        self.count = count
        self.hero_inventory = hero_inventory

    def write_packet(self, w: BinaryWriter):
        w.write_uint64(self.unique_id)
        w.write_uint16(self.count)
        w.write_bool(self.hero_inventory)


@_register_client
class C_DropGold(Packet):
    packet_id = ClientPacketIds.DropGold

    def __init__(self, amount: int = 0):
        self.amount = amount

    def write_packet(self, w: BinaryWriter):
        w.write_uint32(self.amount)


@_register_client
class C_PickUp(Packet):
    packet_id = ClientPacketIds.PickUp


@_register_client
class C_Attack(Packet):
    packet_id = ClientPacketIds.Attack

    def __init__(self, direction: int = 0, spell: int = Spell.NONE):
        self.direction = direction
        self.spell = spell

    def write_packet(self, w: BinaryWriter):
        w.write_byte(self.direction)
        w.write_byte(self.spell)


@_register_client
class C_RangeAttack(Packet):
    packet_id = ClientPacketIds.RangeAttack

    def __init__(self, direction: int = 0, location: tuple = (0, 0),
                 target_id: int = 0, target_location: tuple = (0, 0)):
        self.direction = direction
        self.location = location
        self.target_id = target_id
        self.target_location = target_location

    def write_packet(self, w: BinaryWriter):
        w.write_byte(self.direction)
        w.write_int32(self.location[0])
        w.write_int32(self.location[1])
        w.write_uint32(self.target_id)
        w.write_int32(self.target_location[0])
        w.write_int32(self.target_location[1])


@_register_client
class C_Magic(Packet):
    packet_id = ClientPacketIds.Magic

    def __init__(self, object_id: int = 0, spell: int = 0, direction: int = 0,
                 target_id: int = 0, location: tuple = (0, 0), spell_target_lock: bool = False):
        self.object_id = object_id
        self.spell = spell
        self.direction = direction
        self.target_id = target_id
        self.location = location
        self.spell_target_lock = spell_target_lock

    def write_packet(self, w: BinaryWriter):
        w.write_uint32(self.object_id)
        w.write_byte(self.spell)
        w.write_byte(self.direction)
        w.write_uint32(self.target_id)
        w.write_int32(self.location[0])
        w.write_int32(self.location[1])
        w.write_bool(self.spell_target_lock)


@_register_client
class C_CallNPC(Packet):
    packet_id = ClientPacketIds.CallNPC

    def __init__(self, object_id: int = 0, key: str = ""):
        self.object_id = object_id
        self.key = key

    def write_packet(self, w: BinaryWriter):
        w.write_uint32(self.object_id)
        w.write_string(self.key)


@_register_client
class C_BuyItem(Packet):
    packet_id = ClientPacketIds.BuyItem

    def __init__(self, item_index: int = 0, count: int = 1, panel_type: int = PanelType.Buy):
        self.item_index = item_index
        self.count = count
        self.panel_type = panel_type

    def write_packet(self, w: BinaryWriter):
        w.write_uint64(self.item_index)
        w.write_uint16(self.count)
        w.write_byte(self.panel_type)


@_register_client
class C_SellItem(Packet):
    packet_id = ClientPacketIds.SellItem

    def __init__(self, unique_id: int = 0, count: int = 1):
        self.unique_id = unique_id
        self.count = count

    def write_packet(self, w: BinaryWriter):
        w.write_uint64(self.unique_id)
        w.write_uint16(self.count)


@_register_client
class C_TownRevive(Packet):
    packet_id = ClientPacketIds.TownRevive


# ===================================================================
# SERVER PACKETS (received from server)
# ===================================================================

@_register_server
class S_Connected(Packet):
    packet_id = ServerPacketIds.Connected


@_register_server
class S_ClientVersion(Packet):
    packet_id = ServerPacketIds.ClientVersion

    def __init__(self):
        self.result = 0

    def read_packet(self, r: BinaryReader):
        self.result = r.read_byte()


@_register_server
class S_Disconnect(Packet):
    packet_id = ServerPacketIds.Disconnect

    def __init__(self):
        self.reason = 0

    def read_packet(self, r: BinaryReader):
        self.reason = r.read_byte()


@_register_server
class S_KeepAlive(Packet):
    packet_id = ServerPacketIds.KeepAlive

    def __init__(self):
        self.time = 0

    def read_packet(self, r: BinaryReader):
        self.time = r.read_int64()


@_register_server
class S_Login(Packet):
    packet_id = ServerPacketIds.Login

    def __init__(self):
        self.result = 0

    def read_packet(self, r: BinaryReader):
        self.result = r.read_byte()


@_register_server
class S_LoginSuccess(Packet):
    packet_id = ServerPacketIds.LoginSuccess

    def __init__(self):
        self.characters = []

    def read_packet(self, r: BinaryReader):
        count = r.read_int32()
        self.characters = []
        for _ in range(count):
            self.characters.append(_read_select_info(r))


@_register_server
class S_StartGame(Packet):
    packet_id = ServerPacketIds.StartGame

    def __init__(self):
        self.result = 0
        self.resolution = 0

    def read_packet(self, r: BinaryReader):
        self.result = r.read_byte()
        self.resolution = r.read_int32()


@_register_server
class S_MapInformation(Packet):
    packet_id = ServerPacketIds.MapInformation

    def __init__(self):
        self.map_index = 0
        self.file_name = ""
        self.title = ""

    def read_packet(self, r: BinaryReader):
        self.map_index = r.read_int32()
        self.file_name = r.read_string()
        self.title = r.read_string()
        self.mini_map = r.read_uint16()
        self.big_map = r.read_uint16()
        self.lights = r.read_byte()
        bools = r.read_byte()
        self.lightning = bool(bools & 0x01)
        self.fire = bool(bools & 0x02)
        self.map_dark_light = r.read_byte()
        self.music = r.read_uint16()
        self.weather = r.read_uint16()


@_register_server
class S_UserInformation(Packet):
    packet_id = ServerPacketIds.UserInformation

    def __init__(self):
        self.object_id = 0
        self.name = ""
        self.class_ = 0
        self.gender = 0
        self.level = 0
        self.location = (0, 0)
        self.direction = 0
        self.hp = 0
        self.mp = 0
        self.experience = 0
        self.max_experience = 0
        self.gold = 0
        self.inventory = []
        self.equipment = []
        self.magics = []

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.real_id = r.read_uint32()
        self.name = r.read_string()
        self.guild_name = r.read_string()
        self.guild_rank = r.read_string()
        self.name_colour = r.read_int32()
        self.class_ = r.read_byte()
        self.gender = r.read_byte()
        self.level = r.read_uint16()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()
        self.hair = r.read_byte()
        self.hp = r.read_int32()
        self.mp = r.read_int32()
        self.experience = r.read_int64()
        self.max_experience = r.read_int64()
        self.level_effects = r.read_uint16()
        self.has_hero = r.read_bool()
        self.hero_behaviour = r.read_byte()
        # Inventory
        self.inventory = _read_user_item_array(r)
        # Equipment
        self.equipment = _read_user_item_array(r)
        # Quest inventory
        self.quest_inventory = _read_user_item_array(r)
        self.gold = r.read_uint32()
        self.credit = r.read_uint32()
        self.has_expanded_storage = r.read_bool()
        self.has_storage_password = r.read_bool()
        self.require_storage_password = r.read_bool()
        self.storage_password_last_set = r.read_int64()
        self.expanded_storage_expiry = r.read_int64()
        # Magics
        count = r.read_int32()
        self.magics = []
        for _ in range(count):
            self.magics.append(_read_client_magic(r))
        # Intelligent creatures (skip)
        ic_count = r.read_int32()
        for _ in range(ic_count):
            _skip_intelligent_creature(r)
        self.summoned_creature_type = r.read_byte()
        self.creature_summoned = r.read_bool()
        self.allow_observe = r.read_bool()
        self.observer = r.read_bool()


@_register_server
class S_UserLocation(Packet):
    packet_id = ServerPacketIds.UserLocation

    def __init__(self):
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()


@_register_server
class S_ObjectPlayer(Packet):
    packet_id = ServerPacketIds.ObjectPlayer

    def __init__(self):
        self.object_id = 0
        self.name = ""
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.name = r.read_string()
        self.guild_name = r.read_string()
        self.guild_rank_name = r.read_string()
        self.name_colour = r.read_int32()
        self.class_ = r.read_byte()
        self.gender = r.read_byte()
        self.level = r.read_uint16()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()
        self.hair = r.read_byte()
        self.light = r.read_byte()
        self.weapon = r.read_int16()
        self.weapon_effect = r.read_int16()
        self.armour = r.read_int16()
        self.poison = r.read_uint16()
        self.dead = r.read_bool()
        self.hidden = r.read_bool()
        self.effect = r.read_byte()
        self.wing_effect = r.read_byte()
        self.extra = r.read_bool()
        self.mount_type = r.read_int16()
        self.riding_mount = r.read_bool()
        self.fishing = r.read_bool()
        self.transform_type = r.read_int16()
        self.element_orb_effect = r.read_uint32()
        self.element_orb_lvl = r.read_uint32()
        self.element_orb_max = r.read_uint32()
        count = r.read_int32()
        self.buffs = [r.read_byte() for _ in range(count)]
        self.level_effects = r.read_uint16()


@_register_server
class S_ObjectRemove(Packet):
    packet_id = ServerPacketIds.ObjectRemove

    def __init__(self):
        self.object_id = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()


@_register_server
class S_ObjectTurn(Packet):
    packet_id = ServerPacketIds.ObjectTurn

    def __init__(self):
        self.object_id = 0
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()


@_register_server
class S_ObjectWalk(Packet):
    packet_id = ServerPacketIds.ObjectWalk

    def __init__(self):
        self.object_id = 0
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()


@_register_server
class S_ObjectRun(Packet):
    packet_id = ServerPacketIds.ObjectRun

    def __init__(self):
        self.object_id = 0
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()


@_register_server
class S_Chat(Packet):
    packet_id = ServerPacketIds.Chat

    def __init__(self):
        self.message = ""
        self.chat_type = 0

    def read_packet(self, r: BinaryReader):
        self.message = r.read_string()
        self.chat_type = r.read_byte()


@_register_server
class S_ObjectChat(Packet):
    packet_id = ServerPacketIds.ObjectChat

    def __init__(self):
        self.object_id = 0
        self.text = ""
        self.chat_type = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.text = r.read_string()
        self.chat_type = r.read_byte()


@_register_server
class S_ObjectMonster(Packet):
    packet_id = ServerPacketIds.ObjectMonster

    def __init__(self):
        self.object_id = 0
        self.name = ""
        self.location = (0, 0)
        self.direction = 0
        self.dead = False

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.name = r.read_string()
        self.name_colour = r.read_int32()
        self.location = (r.read_int32(), r.read_int32())
        self.image = r.read_uint16()
        self.direction = r.read_byte()
        self.effect = r.read_byte()
        self.ai = r.read_byte()
        self.light = r.read_byte()
        self.dead = r.read_bool()
        self.skeleton = r.read_bool()
        self.poison = r.read_uint16()
        self.hidden = r.read_bool()
        self.shock_time = r.read_int64()
        self.binding_shot_center = r.read_bool()
        self.extra = r.read_bool()
        self.extra_byte = r.read_byte()
        self.master_object_id = r.read_uint32()
        self.rarity = r.read_byte()
        count = r.read_int32()
        self.buffs = [r.read_byte() for _ in range(count)]


@_register_server
class S_ObjectAttack(Packet):
    packet_id = ServerPacketIds.ObjectAttack

    def __init__(self):
        self.object_id = 0
        self.location = (0, 0)
        self.direction = 0
        self.spell = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()
        self.spell = r.read_byte()
        self.level = r.read_byte()
        self.type = r.read_byte()


@_register_server
class S_Struck(Packet):
    packet_id = ServerPacketIds.Struck

    def __init__(self):
        self.attacker_id = 0

    def read_packet(self, r: BinaryReader):
        self.attacker_id = r.read_uint32()


@_register_server
class S_ObjectStruck(Packet):
    packet_id = ServerPacketIds.ObjectStruck

    def __init__(self):
        self.object_id = 0
        self.attacker_id = 0
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.attacker_id = r.read_uint32()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()


@_register_server
class S_DamageIndicator(Packet):
    packet_id = ServerPacketIds.DamageIndicator

    def __init__(self):
        self.damage = 0
        self.type = 0
        self.object_id = 0

    def read_packet(self, r: BinaryReader):
        self.damage = r.read_int32()
        self.type = r.read_byte()
        self.object_id = r.read_uint32()


@_register_server
class S_HealthChanged(Packet):
    packet_id = ServerPacketIds.HealthChanged

    def __init__(self):
        self.hp = 0
        self.mp = 0

    def read_packet(self, r: BinaryReader):
        self.hp = r.read_int32()
        self.mp = r.read_int32()


@_register_server
class S_Death(Packet):
    packet_id = ServerPacketIds.Death

    def __init__(self):
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()


@_register_server
class S_ObjectDied(Packet):
    packet_id = ServerPacketIds.ObjectDied

    def __init__(self):
        self.object_id = 0
        self.location = (0, 0)
        self.direction = 0
        self.type = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()
        self.type = r.read_byte()


@_register_server
class S_GainExperience(Packet):
    packet_id = ServerPacketIds.GainExperience

    def __init__(self):
        self.amount = 0

    def read_packet(self, r: BinaryReader):
        self.amount = r.read_uint32()


@_register_server
class S_LevelChanged(Packet):
    packet_id = ServerPacketIds.LevelChanged

    def __init__(self):
        self.level = 0
        self.experience = 0
        self.max_experience = 0

    def read_packet(self, r: BinaryReader):
        self.level = r.read_uint16()
        self.experience = r.read_int64()
        self.max_experience = r.read_int64()


@_register_server
class S_GainedItem(Packet):
    packet_id = ServerPacketIds.GainedItem

    def __init__(self):
        self.item = None

    def read_packet(self, r: BinaryReader):
        self.item = _read_user_item(r)


@_register_server
class S_GainedGold(Packet):
    packet_id = ServerPacketIds.GainedGold

    def __init__(self):
        self.gold = 0

    def read_packet(self, r: BinaryReader):
        self.gold = r.read_uint32()


@_register_server
class S_LoseGold(Packet):
    packet_id = ServerPacketIds.LoseGold

    def __init__(self):
        self.gold = 0

    def read_packet(self, r: BinaryReader):
        self.gold = r.read_uint32()


@_register_server
class S_ObjectNPC(Packet):
    packet_id = ServerPacketIds.ObjectNpc

    def __init__(self):
        self.object_id = 0
        self.name = ""
        self.location = (0, 0)
        self.image = 0
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.name = r.read_string()
        self.name_colour = r.read_int32()
        self.image = r.read_uint16()
        self.colour = r.read_int32()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()
        count = r.read_int32()
        self.quest_ids = [r.read_int32() for _ in range(count)]


@_register_server
class S_NPCResponse(Packet):
    packet_id = ServerPacketIds.NPCResponse

    def __init__(self):
        self.page = []

    def read_packet(self, r: BinaryReader):
        count = r.read_int32()
        self.page = [r.read_string() for _ in range(count)]


@_register_server
class S_ObjectItem(Packet):
    packet_id = ServerPacketIds.ObjectItem

    def __init__(self):
        self.object_id = 0
        self.name = ""
        self.location = (0, 0)
        self.image = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.name = r.read_string()
        self.name_colour = r.read_int32()
        self.location = (r.read_int32(), r.read_int32())
        self.image = r.read_uint16()
        self.grade = r.read_byte()


@_register_server
class S_ObjectGold(Packet):
    packet_id = ServerPacketIds.ObjectGold

    def __init__(self):
        self.object_id = 0
        self.gold = 0
        self.location = (0, 0)

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.gold = r.read_uint32()
        self.location = (r.read_int32(), r.read_int32())


@_register_server
class S_MapChanged(Packet):
    packet_id = ServerPacketIds.MapChanged

    def __init__(self):
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.map_index = r.read_int32()
        self.file_name = r.read_string()
        self.title = r.read_string()
        self.mini_map = r.read_uint16()
        self.big_map = r.read_uint16()
        self.lights = r.read_byte()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()
        self.map_dark_light = r.read_byte()
        self.music = r.read_uint16()
        self.weather = r.read_uint16()


@_register_server
class S_ObjectHealth(Packet):
    packet_id = ServerPacketIds.ObjectHealth

    def __init__(self):
        self.object_id = 0
        self.percent = 0
        self.expire = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.percent = r.read_byte()
        self.expire = r.read_byte()


@_register_server
class S_Poisoned(Packet):
    packet_id = ServerPacketIds.Poisoned

    def __init__(self):
        self.poison = 0

    def read_packet(self, r: BinaryReader):
        self.poison = r.read_uint16()


@_register_server
class S_Magic(Packet):
    packet_id = ServerPacketIds.Magic

    def __init__(self):
        self.spell = 0
        self.target_id = 0
        self.target = (0, 0)
        self.cast = False
        self.level = 0

    def read_packet(self, r: BinaryReader):
        self.spell = r.read_byte()
        self.target_id = r.read_uint32()
        self.target = (r.read_int32(), r.read_int32())
        self.cast = r.read_bool()
        self.level = r.read_byte()
        count = r.read_int32()
        self.secondary_target_ids = [r.read_uint32() for _ in range(count)]


@_register_server
class S_ObjectMagic(Packet):
    packet_id = ServerPacketIds.ObjectMagic

    def __init__(self):
        self.object_id = 0
        self.location = (0, 0)
        self.direction = 0
        self.spell = 0

    def read_packet(self, r: BinaryReader):
        self.object_id = r.read_uint32()
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()
        self.spell = r.read_byte()
        self.target_id = r.read_uint32()
        self.target = (r.read_int32(), r.read_int32())
        self.cast = r.read_bool()
        self.level = r.read_byte()
        self.self_broadcast = r.read_bool()
        count = r.read_int32()
        self.secondary_target_ids = [r.read_uint32() for _ in range(count)]


@_register_server
class S_Revived(Packet):
    packet_id = ServerPacketIds.Revived


@_register_server
class S_AddBuff(Packet):
    packet_id = ServerPacketIds.AddBuff

    def __init__(self):
        self.buff = None

    def read_packet(self, r: BinaryReader):
        self.buff = _read_client_buff(r)


@_register_server
class S_RemoveBuff(Packet):
    packet_id = ServerPacketIds.RemoveBuff

    def __init__(self):
        self.type = 0
        self.object_id = 0

    def read_packet(self, r: BinaryReader):
        self.type = r.read_byte()
        self.object_id = r.read_uint32()


@_register_server
class S_NPCGoods(Packet):
    packet_id = ServerPacketIds.NPCGoods
    compressed = True

    def __init__(self):
        self.items = []
        self.rate = 1.0
        self.panel_type = 0

    def read_packet(self, r: BinaryReader):
        count = r.read_int32()
        self.items = [_read_user_item(r) for _ in range(count)]
        self.rate = r.read_single()
        self.panel_type = r.read_byte()
        self.hide_added_stats = r.read_bool()


@_register_server
class S_LogOutSuccess(Packet):
    packet_id = ServerPacketIds.LogOutSuccess

    def __init__(self):
        self.characters = []

    def read_packet(self, r: BinaryReader):
        count = r.read_int32()
        self.characters = [_read_select_info(r) for _ in range(count)]


@_register_server
class S_NewItemInfo(Packet):
    packet_id = ServerPacketIds.NewItemInfo

    def __init__(self):
        self.info = None

    def read_packet(self, r: BinaryReader):
        self.info = _read_item_info(r)


@_register_server
class S_Pushed(Packet):
    packet_id = ServerPacketIds.Pushed

    def __init__(self):
        self.location = (0, 0)
        self.direction = 0

    def read_packet(self, r: BinaryReader):
        self.location = (r.read_int32(), r.read_int32())
        self.direction = r.read_byte()


@_register_server
class S_DeleteItem(Packet):
    packet_id = ServerPacketIds.DeleteItem

    def __init__(self):
        self.unique_id = 0
        self.count = 0

    def read_packet(self, r: BinaryReader):
        self.unique_id = r.read_uint64()
        self.count = r.read_uint16()


@_register_server
class S_MagicCast(Packet):
    packet_id = ServerPacketIds.MagicCast

    def __init__(self):
        self.spell = 0

    def read_packet(self, r: BinaryReader):
        self.spell = r.read_byte()


@_register_server
class S_UseItem(Packet):
    packet_id = ServerPacketIds.UseItem

    def __init__(self):
        self.unique_id = 0
        self.success = False
        self.grid = 0

    def read_packet(self, r: BinaryReader):
        self.unique_id = r.read_uint64()
        self.success = r.read_bool()
        self.grid = r.read_byte()


@_register_server
class S_DropItem(Packet):
    packet_id = ServerPacketIds.DropItem

    def __init__(self):
        self.unique_id = 0
        self.count = 0
        self.success = False

    def read_packet(self, r: BinaryReader):
        self.unique_id = r.read_uint64()
        self.count = r.read_uint16()
        self.hero_item = r.read_bool()
        self.success = r.read_bool()


@_register_server
class S_SellItem(Packet):
    packet_id = ServerPacketIds.SellItem

    def __init__(self):
        self.unique_id = 0
        self.count = 0
        self.success = False

    def read_packet(self, r: BinaryReader):
        self.unique_id = r.read_uint64()
        self.count = r.read_uint16()
        self.success = r.read_bool()


# ===================================================================
# Helper functions for reading compound types
# ===================================================================

def _read_select_info(r: BinaryReader) -> dict:
    """Read a SelectInfo struct."""
    return {
        "index": r.read_int32(),
        "name": r.read_string(),
        "level": r.read_uint16(),
        "class": r.read_byte(),
        "gender": r.read_byte(),
        "last_access": r.read_int64(),
    }


def _read_user_item_array(r: BinaryReader) -> list:
    """Read a nullable UserItem[] as sent by the server."""
    if not r.read_bool():
        return []
    count = r.read_int32()
    items = []
    for _ in range(count):
        if r.read_bool():
            items.append(_read_user_item(r))
        else:
            items.append(None)
    return items


def _read_user_item(r: BinaryReader) -> dict:
    """Read a UserItem struct (matches UserItem.Save/constructor)."""
    item = {
        "unique_id": r.read_uint64(),
        "item_index": r.read_int32(),
        "current_dura": r.read_uint16(),
        "max_dura": r.read_uint16(),
        "count": r.read_uint16(),
        "ac": r.read_byte(),
        "mac": r.read_byte(),
        "dc": r.read_byte(),
        "mc": r.read_byte(),
        "sc": r.read_byte(),
        "accuracy": r.read_byte(),
        "agility": r.read_byte(),
        "hp": r.read_byte(),
        "mp": r.read_byte(),
        "attack_speed": r.read_sbyte(),
        "luck": r.read_sbyte(),
        "soul_bound_id": r.read_int32(),
        "bools": r.read_byte(),
        "strong": r.read_byte(),
        "magic_resist": r.read_byte(),
        "poison_resist": r.read_byte(),
        "health_recovery": r.read_byte(),
        "mana_recovery": r.read_byte(),
        "poison_recovery": r.read_byte(),
        "critical_rate": r.read_byte(),
        "critical_damage": r.read_byte(),
        "freezing": r.read_byte(),
        "poison_attack": r.read_byte(),
    }
    # Awake
    count = r.read_int32()
    item["awake"] = [r.read_byte() for _ in range(count)]
    item["refine_added"] = r.read_byte()
    item["refine_chance"] = r.read_int32()
    item["refine_added_value"] = r.read_int32()
    item["refine_success_chance"] = r.read_int32()
    # slots
    slot_count = r.read_int32()
    item["slots"] = []
    for _ in range(slot_count):
        if r.read_bool():
            item["slots"].append(_read_user_item(r))
        else:
            item["slots"].append(None)
    item["gem_count"] = r.read_uint32()
    # Expiry
    item["expiry"] = r.read_int64()
    item["sealed_info"] = {"expiry_date": r.read_int64(), "sealed": r.read_bool()}
    return item


def _read_item_info(r: BinaryReader) -> dict:
    """Read an ItemInfo struct."""
    return {
        "index": r.read_int32(),
        "name": r.read_string(),
        "type": r.read_byte(),
        "grade": r.read_byte(),
        "required_type": r.read_byte(),
        "required_class": r.read_byte(),
        "required_gender": r.read_byte(),
        "set": r.read_byte(),
        "shape": r.read_int16(),
        "effect": r.read_byte(),
        "weight": r.read_byte(),
        "light": r.read_byte(),
        "required_amount": r.read_byte(),
        "image": r.read_uint16(),
        "durability": r.read_uint16(),
        "stack_size": r.read_uint16(),
        "price": r.read_uint32(),
        "min_ac": r.read_byte(),
        "max_ac": r.read_byte(),
        "min_mac": r.read_byte(),
        "max_mac": r.read_byte(),
        "min_dc": r.read_byte(),
        "max_dc": r.read_byte(),
        "min_mc": r.read_byte(),
        "max_mc": r.read_byte(),
        "min_sc": r.read_byte(),
        "max_sc": r.read_byte(),
        "hp": r.read_uint16(),
        "mp": r.read_uint16(),
        "accuracy": r.read_byte(),
        "agility": r.read_byte(),
        "speed": r.read_sbyte(),
        "luck": r.read_sbyte(),
        "attack_speed": r.read_sbyte(),
        "start_item": r.read_bool(),
        "bag_weight": r.read_byte(),
        "hand_weight": r.read_byte(),
        "wear_weight": r.read_byte(),
        "bind": r.read_int16(),
        "strong": r.read_byte(),
        "magic_resist": r.read_byte(),
        "poison_resist": r.read_byte(),
        "health_recovery": r.read_byte(),
        "spell_recovery": r.read_byte(),
        "poison_recovery": r.read_byte(),
        "hp_rate": r.read_byte(),
        "mp_rate": r.read_byte(),
        "critical_rate": r.read_byte(),
        "critical_damage": r.read_byte(),
        "bools": r.read_byte(),
        "max_ac_rate": r.read_byte(),
        "max_mac_rate": r.read_byte(),
        "holy": r.read_byte(),
        "freezing": r.read_byte(),
        "poison_attack": r.read_byte(),
        "unique": r.read_int16(),
        "random_stats_id": r.read_byte(),
        "can_awaken": r.read_bool(),
        "tool_tip": r.read_string(),
    }


def _read_client_magic(r: BinaryReader) -> dict:
    """Read a ClientMagic struct."""
    return {
        "spell": r.read_byte(),
        "base_cost": r.read_byte(),
        "level_cost": r.read_byte(),
        "icon": r.read_uint16(),
        "level1": r.read_byte(),
        "level2": r.read_byte(),
        "level3": r.read_byte(),
        "need1": r.read_uint16(),
        "need2": r.read_uint16(),
        "need3": r.read_uint16(),
        "level": r.read_byte(),
        "key": r.read_byte(),
        "experience": r.read_uint16(),
        "delay": r.read_int64(),
        "range": r.read_int32(),
        "cast_time": r.read_int64(),
        "toggle": r.read_bool(),
    }


def _read_client_buff(r: BinaryReader) -> dict:
    """Read a ClientBuff struct."""
    buff = {
        "type": r.read_byte(),
        "caster": r.read_string(),
        "visible": r.read_bool(),
        "object_id": r.read_uint32(),
        "expire_time": r.read_int64(),
        "infinite": r.read_bool(),
        "paused": r.read_bool(),
    }
    count = r.read_int32()
    buff["values"] = [r.read_int32() for _ in range(count)]
    return buff


def _skip_intelligent_creature(r: BinaryReader):
    """Skip over a ClientIntelligentCreature in the stream."""
    r.read_byte()   # PetType
    r.read_int32()   # Icon
    r.read_string()  # CustomName
    r.read_int32()   # Fullness
    r.read_byte()    # SlotIndex
    r.read_int64()   # ExpireTime
    r.read_int64()   # BlackstoneTime
    r.read_int64()   # MaintainFoodTime
    # Filter
    r.read_bool()    # PickupGrade
    r.read_bool()    # PickupAll
    r.read_bool()    # PickupGold
    r.read_bool()    # PickupWeapons
    r.read_bool()    # PickupArmours
    r.read_bool()    # PickupHelmets
    r.read_bool()    # PickupBoots
    r.read_bool()    # PickupBelts
    r.read_bool()    # PickupAccessories
    r.read_bool()    # PickupOthers
    r.read_byte()    # pickupMode
