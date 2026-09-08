# classic pack baseline

A tracked copy of the world database the `crystal-classic` pack runs on: 463
maps, their connections and respawn tables, and the item, monster, skill and
quest definitions. `Server.MirDB` is content, not state -- it is written only by
GM and database edits, not by play, which is why a snapshot of it is meaningful.

It is here because the live copy is a single file under `Build/`, which
`.gitignore` excludes wholesale, and nothing backs it up. Accounts and characters
in `Server.MirADB` have an automatic five-minute backup rotation; this had none.

`../pack.yaml` sets `contentRoot: ../..`, pointing back at the server directory
itself, so this pack is a wrapper over the legacy layout rather than a
self-contained pack. Packs/README.md already describes the alternative -- all
four content paths below the manifest -- and moving to it is part of the work
that introduces a second pack.

## Restoring

    cp Packs/classic/baseline/Server.MirDB Build/Server/Debug/Server.MirDB

with the server stopped. Check the sha256 in the commit message against the file
first -- a mismatch means the live database has been edited since, and restoring
would discard those edits.
