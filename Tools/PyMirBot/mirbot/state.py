"""
Game state automatically updated from server packets.

Tracks the bot's own character (position, HP/MP, inventory, etc.)
and nearby objects (players, monsters, NPCs, ground items).
"""

from dataclasses import dataclass, field

from .enums import (
    GameStage,
    MirDirection,
    MirClass,
    MirGender,
    ServerPacketIds,
)


@dataclass
class ObjectInfo:
    """Basic info about a nearby game object."""
    object_id: int = 0
    name: str = ""
    location: tuple[int, int] = (0, 0)
    direction: int = 0
    dead: bool = False
    # Extra fields populated per type
    extras: dict = field(default_factory=dict)


@dataclass
class GameState:
    """Full game state, updated by packet handlers."""
    stage: GameStage = GameStage.NONE

    # Character info (from S_UserInformation)
    object_id: int = 0
    name: str = ""
    level: int = 0
    class_: MirClass = MirClass.Warrior
    gender: MirGender = MirGender.Male
    location: tuple[int, int] = (0, 0)
    direction: MirDirection = MirDirection.Up
    hp: int = 0
    mp: int = 0
    max_hp: int = 0
    max_mp: int = 0
    experience: int = 0
    max_experience: int = 0
    gold: int = 0
    credit: int = 0
    dead: bool = False

    # Map info
    map_index: int = 0
    map_title: str = ""
    map_file: str = ""

    # Inventory and equipment
    inventory: list = field(default_factory=list)
    equipment: list = field(default_factory=list)
    magics: list = field(default_factory=list)

    # Known item definitions: {item_index: ItemInfo dict}
    item_infos: dict = field(default_factory=dict)

    # Nearby objects: {object_id: ObjectInfo}
    players: dict[int, ObjectInfo] = field(default_factory=dict)
    monsters: dict[int, ObjectInfo] = field(default_factory=dict)
    npcs: dict[int, ObjectInfo] = field(default_factory=dict)
    ground_items: dict[int, ObjectInfo] = field(default_factory=dict)

    # Buffs: {buff_type: buff_dict}
    buffs: dict = field(default_factory=dict)

    # Character select list
    characters: list = field(default_factory=list)

    # NPC dialog state
    npc_page: list[str] = field(default_factory=list)


def register_state_handlers(connection, state: GameState):
    """Wire up packet handlers that keep *state* in sync."""
    from .packets import (
        S_Connected, S_ClientVersion, S_Login, S_LoginSuccess,
        S_StartGame, S_MapInformation, S_UserInformation, S_UserLocation,
        S_ObjectPlayer, S_ObjectRemove, S_ObjectTurn, S_ObjectWalk, S_ObjectRun,
        S_Chat, S_ObjectMonster, S_HealthChanged,
        S_Death, S_ObjectDied, S_GainExperience, S_LevelChanged,
        S_GainedItem, S_GainedGold, S_LoseGold,
        S_ObjectNPC, S_NPCResponse, S_ObjectItem, S_ObjectGold,
        S_MapChanged, S_ObjectHealth, S_Poisoned,
        S_Revived, S_AddBuff, S_RemoveBuff,
        S_LogOutSuccess, S_NewItemInfo, S_Pushed,
        S_DeleteItem, S_NPCGoods,
    )

    def on_connected(pkt: S_Connected):
        state.stage = GameStage.LOGIN

    def on_login_success(pkt: S_LoginSuccess):
        state.characters = pkt.characters
        state.stage = GameStage.SELECT

    def on_start_game(pkt: S_StartGame):
        if pkt.result == 4:  # success
            state.stage = GameStage.GAME

    def on_map_info(pkt: S_MapInformation):
        state.map_index = pkt.map_index
        state.map_file = pkt.file_name
        state.map_title = pkt.title

    def on_user_info(pkt: S_UserInformation):
        state.object_id = pkt.object_id
        state.name = pkt.name
        state.class_ = MirClass(pkt.class_)
        state.gender = MirGender(pkt.gender)
        state.level = pkt.level
        state.location = pkt.location
        state.direction = MirDirection(pkt.direction)
        state.hp = pkt.hp
        state.mp = pkt.mp
        state.max_hp = pkt.hp  # server sends current as max initially
        state.max_mp = pkt.mp
        state.experience = pkt.experience
        state.max_experience = pkt.max_experience
        state.gold = pkt.gold
        state.inventory = pkt.inventory
        state.equipment = pkt.equipment
        state.magics = pkt.magics
        state.dead = False

    def on_user_location(pkt: S_UserLocation):
        state.location = pkt.location
        state.direction = MirDirection(pkt.direction)

    def on_health_changed(pkt: S_HealthChanged):
        state.hp = pkt.hp
        state.mp = pkt.mp

    def on_death(pkt: S_Death):
        state.dead = True
        state.location = pkt.location
        state.direction = MirDirection(pkt.direction)

    def on_revived(pkt: S_Revived):
        state.dead = False

    def on_pushed(pkt: S_Pushed):
        state.location = pkt.location
        state.direction = MirDirection(pkt.direction)

    def on_gain_experience(pkt: S_GainExperience):
        state.experience += pkt.amount

    def on_level_changed(pkt: S_LevelChanged):
        state.level = pkt.level
        state.experience = pkt.experience
        state.max_experience = pkt.max_experience

    def on_gained_gold(pkt: S_GainedGold):
        state.gold += pkt.gold

    def on_lose_gold(pkt: S_LoseGold):
        state.gold = max(0, state.gold - pkt.gold)

    def on_gained_item(pkt: S_GainedItem):
        if pkt.item:
            # Place in first empty inventory slot
            for i, slot in enumerate(state.inventory):
                if slot is None:
                    state.inventory[i] = pkt.item
                    break
            else:
                state.inventory.append(pkt.item)

    def on_delete_item(pkt: S_DeleteItem):
        for i, item in enumerate(state.inventory):
            if item and item.get("unique_id") == pkt.unique_id:
                if pkt.count >= item.get("count", 1):
                    state.inventory[i] = None
                else:
                    item["count"] = item.get("count", 1) - pkt.count
                break

    def on_new_item_info(pkt: S_NewItemInfo):
        if pkt.info:
            state.item_infos[pkt.info["index"]] = pkt.info

    # -- Nearby objects --

    def on_object_player(pkt: S_ObjectPlayer):
        state.players[pkt.object_id] = ObjectInfo(
            object_id=pkt.object_id,
            name=pkt.name,
            location=pkt.location,
            direction=pkt.direction,
            dead=pkt.dead,
        )

    def on_object_monster(pkt: S_ObjectMonster):
        state.monsters[pkt.object_id] = ObjectInfo(
            object_id=pkt.object_id,
            name=pkt.name,
            location=pkt.location,
            direction=pkt.direction,
            dead=pkt.dead,
        )

    def on_object_npc(pkt: S_ObjectNPC):
        state.npcs[pkt.object_id] = ObjectInfo(
            object_id=pkt.object_id,
            name=pkt.name,
            location=pkt.location,
            direction=pkt.direction,
        )

    def on_object_item(pkt: S_ObjectItem):
        state.ground_items[pkt.object_id] = ObjectInfo(
            object_id=pkt.object_id,
            name=pkt.name,
            location=pkt.location,
        )

    def on_object_gold(pkt: S_ObjectGold):
        state.ground_items[pkt.object_id] = ObjectInfo(
            object_id=pkt.object_id,
            name=f"Gold ({pkt.gold})",
            location=pkt.location,
            extras={"gold": pkt.gold},
        )

    def on_object_remove(pkt: S_ObjectRemove):
        oid = pkt.object_id
        state.players.pop(oid, None)
        state.monsters.pop(oid, None)
        state.npcs.pop(oid, None)
        state.ground_items.pop(oid, None)

    def _update_object_pos(object_id, location, direction):
        for collection in (state.players, state.monsters, state.npcs):
            obj = collection.get(object_id)
            if obj:
                obj.location = location
                obj.direction = direction
                return

    def on_object_turn(pkt: S_ObjectTurn):
        _update_object_pos(pkt.object_id, pkt.location, pkt.direction)

    def on_object_walk(pkt: S_ObjectWalk):
        _update_object_pos(pkt.object_id, pkt.location, pkt.direction)

    def on_object_run(pkt: S_ObjectRun):
        _update_object_pos(pkt.object_id, pkt.location, pkt.direction)

    def on_object_died(pkt: S_ObjectDied):
        for collection in (state.players, state.monsters):
            obj = collection.get(pkt.object_id)
            if obj:
                obj.dead = True
                obj.location = pkt.location
                return

    def on_object_health(pkt: S_ObjectHealth):
        for collection in (state.players, state.monsters):
            obj = collection.get(pkt.object_id)
            if obj:
                obj.extras["health_percent"] = pkt.percent
                return

    # -- Buffs --

    def on_add_buff(pkt: S_AddBuff):
        if pkt.buff:
            state.buffs[pkt.buff["type"]] = pkt.buff

    def on_remove_buff(pkt: S_RemoveBuff):
        state.buffs.pop(pkt.type, None)

    # -- Map changed --

    def on_map_changed(pkt: S_MapChanged):
        state.map_index = pkt.map_index
        state.map_file = pkt.file_name
        state.map_title = pkt.title
        state.location = pkt.location
        state.direction = MirDirection(pkt.direction)
        # Clear nearby objects on map change
        state.players.clear()
        state.monsters.clear()
        state.npcs.clear()
        state.ground_items.clear()

    # -- NPC dialog --

    def on_npc_response(pkt: S_NPCResponse):
        state.npc_page = pkt.page

    def on_npc_goods(pkt: S_NPCGoods):
        pass  # handled at client level

    # -- Logout --

    def on_logout_success(pkt: S_LogOutSuccess):
        state.characters = pkt.characters
        state.stage = GameStage.SELECT
        state.players.clear()
        state.monsters.clear()
        state.npcs.clear()
        state.ground_items.clear()

    # -- Register all handlers --

    connection.on_packet(ServerPacketIds.Connected, on_connected)
    connection.on_packet(ServerPacketIds.LoginSuccess, on_login_success)
    connection.on_packet(ServerPacketIds.StartGame, on_start_game)
    connection.on_packet(ServerPacketIds.MapInformation, on_map_info)
    connection.on_packet(ServerPacketIds.UserInformation, on_user_info)
    connection.on_packet(ServerPacketIds.UserLocation, on_user_location)
    connection.on_packet(ServerPacketIds.HealthChanged, on_health_changed)
    connection.on_packet(ServerPacketIds.Death, on_death)
    connection.on_packet(ServerPacketIds.Revived, on_revived)
    connection.on_packet(ServerPacketIds.Pushed, on_pushed)
    connection.on_packet(ServerPacketIds.GainExperience, on_gain_experience)
    connection.on_packet(ServerPacketIds.LevelChanged, on_level_changed)
    connection.on_packet(ServerPacketIds.GainedGold, on_gained_gold)
    connection.on_packet(ServerPacketIds.LoseGold, on_lose_gold)
    connection.on_packet(ServerPacketIds.GainedItem, on_gained_item)
    connection.on_packet(ServerPacketIds.DeleteItem, on_delete_item)
    connection.on_packet(ServerPacketIds.NewItemInfo, on_new_item_info)
    connection.on_packet(ServerPacketIds.ObjectPlayer, on_object_player)
    connection.on_packet(ServerPacketIds.ObjectMonster, on_object_monster)
    connection.on_packet(ServerPacketIds.ObjectNpc, on_object_npc)
    connection.on_packet(ServerPacketIds.ObjectItem, on_object_item)
    connection.on_packet(ServerPacketIds.ObjectGold, on_object_gold)
    connection.on_packet(ServerPacketIds.ObjectRemove, on_object_remove)
    connection.on_packet(ServerPacketIds.ObjectTurn, on_object_turn)
    connection.on_packet(ServerPacketIds.ObjectWalk, on_object_walk)
    connection.on_packet(ServerPacketIds.ObjectRun, on_object_run)
    connection.on_packet(ServerPacketIds.ObjectDied, on_object_died)
    connection.on_packet(ServerPacketIds.ObjectHealth, on_object_health)
    connection.on_packet(ServerPacketIds.AddBuff, on_add_buff)
    connection.on_packet(ServerPacketIds.RemoveBuff, on_remove_buff)
    connection.on_packet(ServerPacketIds.MapChanged, on_map_changed)
    connection.on_packet(ServerPacketIds.NPCResponse, on_npc_response)
    connection.on_packet(ServerPacketIds.NPCGoods, on_npc_goods)
    connection.on_packet(ServerPacketIds.LogOutSuccess, on_logout_success)
