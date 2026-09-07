# McCrystal content packs

A content pack owns immutable or administratively edited gameplay content:

- `Configs`: progression, classes, rates, and system rules
- `Envir`: drops, NPC scripts, quests, shops, recipes, and routes
- `Maps`: server map files
- `Server.MirDB`: maps, items, monsters, magic, NPCs, and other definitions

Runtime state does not belong in a pack. `Server.MirADB`, backups, archives,
guilds, conquests, and exports are resolved from the state directory.

The default `classic` manifest describes the existing server layout without
copying its large map and environment directories. A self-contained pack can
instead keep all four content paths below its own manifest directory.

## Selection

Run from the built server directory:

```sh
dotnet Server.Console.dll --pack classic
dotnet Server.Console.dll --pack /path/to/custom/pack.yaml --state /path/to/instance
dotnet Server.Console.dll --pack classic --validate-pack
```

The corresponding environment variables are `MCCRYSTAL_PACK` and
`MCCRYSTAL_STATE`. With no selection, the server uses `packs/classic/pack.yaml`
when present and otherwise falls back to the legacy current-directory layout.

## Manifest

```yaml
id: example
name: Example Pack
version: 1.0.0
engine: crystal
databaseSchema: 117
locale: en-US
clientAssets: example-assets@1
contentRoot: .
paths:
  configs: Configs
  envir: Envir
  maps: Maps
  database: Server.MirDB
```

Startup validation rejects missing content directories, unreadable databases,
manifest/header schema mismatches, and database schemas unsupported by the
engine.
