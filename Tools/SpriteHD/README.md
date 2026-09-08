# SpriteHD

Offline tooling for the sprite upscaling work described in
`docs/sprite-upscaling-research.md`. Nothing here runs at game time.

```sh
npm install --prefix Tools/SpriteHD
python3 Tools/SpriteHD/compare.py --library Monster/004 --action Walking \
    --direction 2 --out /tmp/deer --zoom 2 --fps-divisor 0.5
```

| File | Role |
| --- | --- |
| `mirlib.py` | `.Lib` v3 reader, mirroring `Client.Web/GameAssets.cs` |
| `prepass.py` | Alpha canonicalisation, shadow de-dithering, cropping |
| `xbrz.mjs` | Batch xBRZ over one long-lived node process |
| `xbrz.py` | Python side of that pipe |
| `compare.py` | Four-way flipbook: the only test that can see shimmer |

`@kayahr/xbrz` is GPL-3.0-only while this repository is GPL-2.0. It is a
build-time asset tool that is never linked into the client, and its output is
image data rather than a derived work of its code, so it stays here in `Tools/`
and out of `Client.Web/`.
