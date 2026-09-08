#!/usr/bin/env python3
"""List every map's respawn table straight out of Server.MirDB.

The respawn tables live only in the binary database, so "which map has Zuma
statues" is otherwise a guess. This reads the header and the MapInfo block --
the first block in the file -- and stops there, mirroring
Server/MirDatabase/MapInfo.cs and RespawnInfo.cs.

Monster names come from the running admin console, which is the only place that
maps a monster index to a name without parsing the item table first:

    curl -s -c jar -X POST http://127.0.0.1:5081/api/login \
         -H 'Content-Type: application/json' -H 'X-Admin-Console: 1' \
         -d '{"password":"..."}'
    curl -s -b jar 'http://127.0.0.1:5081/api/db/monsters?q=' > monsters.json

Usage:
    dump_spawns.py [--db PATH] [--monsters monsters.json] [--map NAME] [--monster NAME]
"""

import argparse
import json
import struct
import sys

DEFAULT_DB = "Build/Server/Debug/Server.MirDB"


class Reader:
    def __init__(self, data):
        self.d = data
        self.p = 0

    def i32(self):
        v = struct.unpack_from("<i", self.d, self.p)[0]
        self.p += 4
        return v

    def u16(self):
        v = struct.unpack_from("<H", self.d, self.p)[0]
        self.p += 2
        return v

    def u8(self):
        v = self.d[self.p]
        self.p += 1
        return v

    def boolean(self):
        return self.u8() != 0

    def string(self):
        # BinaryReader.ReadString: 7-bit encoded length, then UTF-8.
        n = shift = 0
        while True:
            byte = self.d[self.p]
            self.p += 1
            n |= (byte & 0x7F) << shift
            if not byte & 0x80:
                break
            shift += 7
        v = self.d[self.p:self.p + n].decode("utf-8")
        self.p += n
        return v


def read_maps(path):
    r = Reader(open(path, "rb").read())
    version = r.i32()
    r.i32()  # custom version
    for _ in range(5):  # Map, Item, Monster, NPC, Quest indexes
        r.i32()
    if version >= 63:
        r.i32()  # gameshop
    if version >= 66:
        r.i32()  # conquest
    if version >= 68:
        r.i32()  # respawn

    maps = []
    for _ in range(r.i32()):
        m = {"Index": r.i32(), "FileName": r.string(), "Title": r.string()}
        r.u16(); r.u8(); r.u16()  # MiniMap, Light, BigMap
        for _ in range(r.i32()):  # SafeZones
            r.i32(); r.i32(); r.u16(); r.boolean()
        respawns = []
        for _ in range(r.i32()):
            spawn = {"Monster": r.i32(), "X": r.i32(), "Y": r.i32(),
                     "Count": r.u16(), "Spread": r.u16()}
            r.u16(); r.u8(); r.string()  # Delay, Direction, RoutePath
            if version > 67:
                r.u16(); r.i32(); r.boolean(); r.u16()
            respawns.append(spawn)
        m["Respawns"] = respawns
        for _ in range(r.i32()):  # Movements
            for _ in range(5):
                r.i32()
            r.boolean(); r.boolean()
            if version >= 69:
                r.i32()
            if version >= 95:
                r.boolean(); r.i32()
        r.boolean(); r.boolean(); r.string()  # NoTeleport, NoReconnect, NoReconnectMap
        for _ in range(11):  # NoRandom .. Fire
            r.boolean()
        r.i32(); r.boolean(); r.i32(); r.u8()  # FireDamage, Lightning, LightningDamage, dark
        for _ in range(r.i32()):  # MineZones
            r.i32(); r.i32(); r.u16(); r.u8()
        r.u8(); r.boolean(); r.boolean(); r.boolean(); r.u16()  # mine, mount, bridle, fight, music
        if version >= 78:
            r.boolean()  # NoTownTeleport
        if version >= 79:
            r.boolean()  # NoReincarnation
        if version >= 110:
            r.u16()  # WeatherParticles
        if version >= 111:
            r.boolean(); r.u8()  # GT, GTIndex
        if version >= 114:
            for _ in range(5):
                r.boolean()
            r.i32(); r.boolean(); r.boolean(); r.i32()
        maps.append(m)
    return version, maps


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default=DEFAULT_DB)
    parser.add_argument("--monsters", help="monsters.json from /api/db/monsters")
    parser.add_argument("--map", help="only maps whose title or filename contains this")
    parser.add_argument("--monster", help="only maps that spawn this monster")
    args = parser.parse_args()

    version, maps = read_maps(args.db)
    names = {}
    if args.monsters:
        names = {r["index"]: r["name"] for r in json.load(open(args.monsters))}

    def name_of(index):
        return names.get(index, "#%d" % index)

    sys.stderr.write("database version %d, %d maps\n" % (version, len(maps)))
    for m in maps:
        if args.map and args.map.lower() not in (m["Title"] + m["FileName"]).lower():
            continue
        counts = {}
        for spawn in m["Respawns"]:
            key = name_of(spawn["Monster"])
            counts[key] = counts.get(key, 0) + spawn["Count"]
        if args.monster and not any(args.monster.lower() in k.lower() for k in counts):
            continue
        if not counts:
            continue
        rows = sorted(counts.items(), key=lambda t: -t[1])
        print("%4d %-14s %-26s %s" % (
            m["Index"], m["FileName"], m["Title"],
            ", ".join("%s %d" % (k, v) for k, v in rows)))


if __name__ == "__main__":
    main()
