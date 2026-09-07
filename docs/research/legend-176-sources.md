# Legend of Mir 2 1.76 source archive

Downloaded on 2026-09-07 into `ThirdParty/legend-176/repos/`. Each available
repository is a shallow clone containing its complete current working tree.
The download directory is intentionally ignored by Git because several packs
contain large assets, third-party game data, and untrusted Windows executables.

Do not execute binaries from these archives. Treat packs without an explicit
license as research material only, and do not redistribute their contents.

## Usable gameplay and map packs

| Local directory | Source | Revision | Size | Maps | Notes |
| --- | --- | --- | ---: | ---: | --- |
| `crystalm2-176` | <https://gitee.com/reheyibei1/CrystalM2_1> | `afb7fd3ea32833abbb9512ca195b373e7d5b37c1` | 390 MB | 1,849 in `Maps.zip` | Crystal-based 1.76 pack with `Configs`, `Envir`, SQLite databases, NPC scripts, items, monsters, and skills. No explicit license found. |
| `mir2-geem2` | <https://github.com/cjlaaa/Mir2-GeeM2> | `9981a8d7aeccadd4a7fb786055ff612ceccda035` | 304 MB | 605 | GPL-3.0 GeeM2 configuration derived from a 1.76 base. Includes post-1.76 maps, heroes, skills, and systems. |
| `buyi-legend` | <https://gitee.com/mylgd/mir2server> | `3952c536c6de04cae12b0c8ce42a6f53ec08d428` | 335 MB | 373 | GEE 1.76 retro gameplay pack with no new skills, small random item bonuses, sets, and Fire Dragon content. Research-only copyright notice. |
| `buyi-classic` | <https://gitee.com/robin.wu/mir2_server_cloth_legend> | `1ecf8a225d7191a91556379b49e356a271e75a23` | 818 MB | 981 | GEE 1.76-derived pack with inscriptions, heroes, combo skills, and later equipment. Research-only copyright notice. |
| `classic-drop-rates` | <https://github.com/zxz88601151/mir2-drop-rates> | `1da72077f789bc698f27d657b2fb93515e00ae05` | 2.5 MB | 0 | Supplemental Chinese and English classic monster drop tables. Its license restricts redistribution and commercial use. |

The four map-bearing packs contain 3,808 `.map` files in total, counting files
inside the Crystal pack's `Maps.zip`. This is a raw count and includes duplicate
maps and post-1.76 additions.

## Indexed but not useful as gameplay packs

| Local directory | Source | Revision | Reason |
| --- | --- | --- | --- |
| `ksirc-cq-client-176` | <https://gitee.com/ksirc/cq> | `a50b55bc36aa4b68107b7c9cfadf3130592fe2bc` | README-only placeholder; no client or map data. |
| `nanian-classic-176` | <https://gitee.com/edjx/nanian> | `ca1de7575061f95f46d61ab44433f37b7d522db8` | Static download-site pages only; no server data. |
| `swxzs-176-20161209` | <https://gitee.com/kangchen/SWXZS1.76_2016.12.09> | `7b805e5f77ee04e3d3770b4ad4f48a1d85f3ac18` | One obsolete iOS OTA manifest; linked IPA is not archived. |
| `swxzs-176-20161215` | <https://gitee.com/kangchen/SWXZS1.76_12.15> | `d1c75d71cb2dded46a6fdff7bf26dd26f8725b52` | One obsolete iOS OTA manifest; linked IPA is not archived. |

These were retained so later research does not repeatedly classify the same
search results as possible gameplay packs.

## Unavailable repositories

The Gitee search index advertises the following repositories, but anonymous Git
access currently fails. They were not downloaded:

- <https://gitee.com/mrzhqiang/mirserver-1.76> - AppleM2 1.76 server.
- <https://gitee.com/mrzhqiang/GameM2_PanGu1.76> - Pangu retro 1.76 pack.
- <https://gitee.com/mrzhqiang/mirclient-1.76> - indexed matching client; the Git repository reports no refs.
- <https://gitee.com/CrystalMir2/CrystalM2> - original Crystal pack; the public fork above supplies revision `afb7fd3`.

## Import policy

Never copy an entire pack over the running McCrystal server. Import into a new
versioned pack and convert one content class at a time: maps and connections,
spawns, NPC definitions and scripts, items, monsters, skills, then drop tables.
Record source revisions and licenses in the destination pack manifest, remove
post-1.76 content explicitly, and run the pack validator before activation.
