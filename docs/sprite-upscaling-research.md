# Sprite upscaling research

Date: 2026-09-07. Question: can the browser client's sprites be made to look
less blocky on a Retina display by upscaling the art 2x and drawing it at the
same on-screen size?

Every figure below was measured on this repository's own assets in
`Build/Client/Debug/Data`, not taken from documentation.

The corpus was re-counted by `Tools/SpriteHD/survey.py`, which walks every
`*.Lib` under `Data` and reads every frame header. **The first pass undercounted
it by a factor of four.**

| | Measured |
| --- | --- |
| Libraries | 1,443 |
| Frames | 1,870,142 |
| Pixels | 13.14 Gpx, so 52.55 Gpx at 2x |
| On disk | 7.10 GiB compressed |
| Monsters | 5.24 Gpx, 39.9% |
| Map | 4.40 Gpx, 33.5% |
| Character armour | 1.07 Gpx, 8.1% |

## The finding that decides the tool: this art is not pixel art

Mir 2 sprites are pre-rendered 3D downsampled to small bitmaps. Measured on
`Monster/002.Lib`, 74 frames at a median of 88x88: about **97 distinct opaque
colours per frame**, heavily anti-aliased.

That breaks the whole class of "correct" pixel-art scalers, which key off exact
RGB equality between neighbouring pixels. Measured share of boundary pixels each
scaler actually changes:

| Scaler | Boundary pixels changed |
| --- | --- |
| MMPX | 2.68% |
| ImageMagick epbx2x | 2.63% |
| ImageMagick eagle2x | 4.61% |
| ImageMagick scale2x | 5.17% |
| ImageMagick xbr2x | 22.79% |
| ImageMagick hq2x | 30.35% |
| **xBRZ** | **39.36%** |
| ffmpeg hqx | 72.73%, blurry |
| ffmpeg xbr | alpha destroyed |

MMPX is theoretically the ideal choice, and on this art it changes 0.71% of all
pixels versus plain nearest neighbour. It is a no-op. Its own README concedes
the mechanism: non pixel-art images fall back to nearest neighbour. Every
copy-only scaler lands in the same inert band for the same reason.

So the real choice is xBRZ or nothing.

## Recommendation: xBRZ

**Alpha is verified, not assumed**, now against the scaler this project actually
uses. Running `@kayahr/xbrz` on the torture case -- bright red hidden under
alpha-0 pixels, this codebase's own convention -- leaks **192 of 256** output
pixels that satisfy the loader's `a == 0 && rgb != 0` rule. Zeroing the RGB of
transparent pixels first drops that to **exactly 0**, and no red ever reaches a
visible pixel either way. That is what makes pre-pass 1 mandatory rather than
tidy, and `Tools/SpriteHD/xbrz.py` re-zeroes the output as well.

The same torture case was run across the field. `ffmpeg -vf xbr` silently outputs RGB, because
`libavfilter/vf_xbr.c` declares the alpha-less pixel format and libavfilter
strips alpha before the filter runs. No flag fixes it. `hqx` and `super2xsai`
bled the hidden colour into visible edge pixels. **xBRZ produced zero
contamination**: its colour distance makes alpha a first-class term and its
gradient weights each colour by its own alpha.

**Shimmer is structurally impossible, and was measured.** Over six consecutive
frames of one animation, the fraction of pixels changing between consecutive
frames:

| | Inter-frame change | Ratio to floor |
| --- | --- | --- |
| Source at 1x | 30.89% | — |
| Nearest neighbour 2x | 30.89% | 1.000 |
| xBRZ 2x | 35.79% | 1.159 |

The nearest-neighbour row validates the metric, since it cannot add temporal
noise. xBRZ sits 16% above that floor, fully explained by bounded neighbourhood
spread. Perturbing a 6x6 block in one source frame changes the xBRZ output only
within a 3-pixel halo, so nothing outside that radius can differ between frames.

The deer's walk cycle, re-measured through the finished pipeline rather than a
sample, came out at 22.54% against a 22.54% floor: **ratio 1.114**.

**Speed:** 27.2 Mpx/s single threaded, so the whole corpus in about 4 minutes.

## Ruled out

**Upscayl and the whole ncnn family.** In `Real-ESRGAN-ncnn-vulkan`,
`waifu2x-ncnn-vulkan` and Upscayl, which is a fork of the first, the alpha
channel never enters the network. It is upscaled by a plain bicubic layer while
RGB goes through the GAN. GAN-sharp colour stapled to a bicubic-soft mask, with
no relationship between them. On binary-alpha sprites that is a guaranteed edge
mismatch.

**chaiNNer's default alpha path** runs the model twice over black and white
backgrounds and returns the black composite, destroying colour behind alpha 0.
Its Separate Alpha toggle carries chaiNNer's own warning about dark borders, and
is only offered for 1- and 3-channel models. Only a genuine 4-channel model
bypasses the machinery.

## Runner-up, if xBRZ's look disappoints

`2x-Gen5-Alpha` in chaiNNer. Of 671 models on OpenModelDB, 53 are tagged
pixel-art, only 6 are 2x, the newest is from 2022, and only four models in the
whole database declare 4 input and output channels. This is the only 2x
pixel-art model with a real alpha channel.

Its temporal consistency is unproven and unbounded. Real-ESRGAN's own README
admits block inconsistency, because it crops the input into tiles and processes
them separately, so identical pixels in a different context give different
output. That is the shimmer mechanism, conceded upstream.

## Mir-specific landmines

### The shadows are a fake-transparency hack

The highest-value finding here, and it is not about upscaling. The shadow in a
real frame is a perfect 50% checkerboard dither: one colour, `RGBA(16,8,8,255)`,
laid on one parity of `(x + y) % 2` with nothing on the other. It was a 1999
trick to fake 50% opacity on hardware that ignored alpha.

The earlier "81% of frames" was a monster-only figure. Over a 4,000-frame random
sample of the whole corpus it is 21.3%, and the breakdown is the useful part,
because it says the dither is exactly and only on the things that cast a shadow:

| Group | Frames with a dither region |
| --- | --- |
| `AArmour` | 100% |
| `CArmour` | 71.4% |
| `Monster` | 59.9% |
| `Transform` | 57.6% |
| `Map` | 5.7% |
| Weapons and weapon effects | 0% |

Detection has to be per frame **and** per colour. A whole-frame parity test only
reaches 93% on the deer because the animal's own dark pixels dilute it; grouping
on the exact colour first gives 99.4-100%. And the parity flips between frames of
one cycle -- deer frame 48 sits on the opposite parity to the other five -- so a
parity assumed once and reused would shift the shadow by a pixel mid-animation.

xBRZ reads the checkerboard as diagonal geometry and turns it into lumpy blobs
with round holes. HQX smears it into grey mush. Neither is right and both are
obvious.

The fix beats any upscaler: detect the single-parity dither, replace it with a
solid region at alpha 128, then upscale. That produces a better shadow than the
original engine could render, and may be worth doing even if nothing else ships.

The LOMCN community predicted this three years ago, so it is a corpus-wide
property rather than an artefact of one sample.

### The alpha-0-with-colour convention

Measured over a 4,000-frame random sample of the whole corpus: alpha is 99.3%
binary, 47.8% at zero, with 0.69% genuinely semi-transparent. Pixels that are
transparent *and* carry colour -- the ones the loader would force opaque -- are
**0.27% of all pixels**, nearly three times the first estimate.

The danger is its interaction with the loader. `Client/MirGraphics/MLibrary.cs`
forces `a == 0 && rgb != 0` to `a = 255`. Upscalers faithfully quadruple those
hidden-colour pixels, so if that rule runs after re-import the entire hidden
backdrop turns opaque, a full-frame halo.

Cheap test: assert no output pixel satisfies `a == 0 && (r|g|b) != 0`.

### Three more

Mask layers, where `HasMask` -- the top bit of the shadow byte -- gives a frame a
second image layer that must be upscaled with identical settings or the two
desynchronise. Counted across the whole corpus this is **120 frames out of
1,870,142, or 0.01%**, so it is a correctness detail rather than a workload.

Per-frame offsets, which are cropped bounding-box origins and **must be doubled**
on re-import or the animation jitters.

Storage, since 7.10 GiB at four times the pixels is about 30 GB, and 47.8% of
pixels are transparent padding, so cropping first is worth real money.

## Pre-passes, in order

1. Decode and canonicalise alpha: apply the client's rule, then zero the RGB of
   all remaining alpha-0 pixels. Before upscaling, not after.
2. Replace dithered shadows with solid colour at alpha 128.
3. Colour-dilate opaque edge colours outward into the transparent region.
   Verified to drive fringing to exactly zero for the blending scalers. xBRZ
   does not need it, but it is free insurance.
4. Crop to the opaque bounding box, recording offsets.
5. Upscale 2x.
6. Re-threshold alpha back toward binary to preserve hard silhouettes.
7. Double all offsets on re-import.

Steps 1 and 7 silently ruin the result if skipped.

Do not sheet-tile for a deterministic scaler. Cross-frame bleed at tile seams
was measured at 2 pixels in 153,600, and the technique is an AI-only mitigation
whose evidence base is Stable Diffusion rather than ESRGAN.

## Tooling on macOS Apple Silicon

A first look with no install, since ImageMagick exposes an undocumented
pixel-art suite:

```sh
magick in.png -define magnify:method=xbr2x -magnify out.png
```

Note ImageMagick's `xbr2x` is not xBRZ and is measurably weaker on this art.

For the real thing at corpus scale, use the WASM port from one persistent
process rather than a CLI per file. The native CLIs build a 64 MB colour
distance table per process, about 150 ms fixed, which across 461,902 frames is
about two hours instead of four minutes.

```sh
npm install @kayahr/xbrz
```

`xbrzscale` corrupts 8-bit palette PNGs; normalise to PNG32 first if using it.

## Does a GPU help

For xBRZ, no. It is a small integer kernel over a 3x3 neighbourhood, CPU-bound,
embarrassingly parallel, and finishes the corpus in about four minutes on one
core. Staging 7.6 GB to a cluster takes longer than running the job locally.

For the AI route, decisively yes, and it is the only thing that makes that route
thinkable. A rough estimate for a 23-block ESRGAN over 6.90 Gpx is six or more
hours on a laptop. A GPU removes the time objection but not the temporal
consistency or alpha objections, which are properties of the models.

## The prior attempt, and why it does not transfer

April 2023 on LOMCN, a user batch-upscaled 60,000 images from `tiles.lib` with
SwinIR4x and Real-ESRGAN4x and gave up, saying the win goes to whoever upscales
the animations without creating an inconsistent mess.

It failed on four things, three of which do not apply here:

1. **Map tiles at 4x, which must match at their edges.** Seamless tiling is a
   fundamentally harder constraint than free-floating sprites, and it is what
   killed the run. This project is not doing tiles.
2. **Re-import was never solved.** The project died at packaging. This
   repository has `LibraryEditor/` with a working library writer.
3. **Non-deterministic 4x AI models mixed together, per frame.** Every
   consistency risk maximised. A deterministic 2x scaler has none of them.
4. **The shadow problem, predicted and never addressed.** There is now a fix.

What does transfer is the observation that the assets do not contain enough
detail to invent more.

## Verdict

Worth doing, scoped as de-blocking rather than remastering.

The objection that the assets lack detail is correct and is about a different
goal. That thread was trying to make an AI invent detail at 4x. This project
wants 2x at unchanged on-screen size on a Retina display, which asks for the
same information to stop being rendered as visible 2x2 blocks. That is
achievable and visible.

Three honest caveats. No 2x scaler adds genuine detail; xBRZ vectorises and
smooths edges rather than synthesising information. xBRZ softens the
anti-aliased texture in places and introduces about 1,332 new colours per frame,
so it is not a faithful transform. And the single highest-value change is the
shadow fix, which is not upscaling at all and will be more visible on a Retina
display than the 2x scale itself.

Start with one monster: run the pre-passes, run xBRZ, and flipbook an eight-frame
walk cycle at 10 fps. Shimmer is obvious in motion and invisible in stills, so
every still comparison, including the ones in this document, is blind to the
failure mode that matters most.

Comparison images were generated to `~/Desktop/mir-upscale-evidence/`.

## The experiment, run

`Tools/SpriteHD/` implements it. `compare.py` renders a cycle four ways over real
grass tiles, aligned on the frame anchor so the only differences are the ones
under test: the art as the browser draws it today, the shadow fix alone, xBRZ,
and xBRZ with the ground upscaled too. It writes an animated GIF at the
animation's own interval, because that is the only view that can see shimmer.

```sh
npm install --prefix Tools/SpriteHD
python3 Tools/SpriteHD/compare.py --library Monster/004 --action Walking \
    --direction 2 --out /tmp/deer --zoom 2 --fps-divisor 0.5
```

Results on the deer, Zuma Taurus and Behemoth: no shimmer, and the shadow fix is
the change you notice first, exactly as predicted. The fourth panel answers the
one open design question -- a 2x monster standing on 1x ground does not read as
wrong, because the ground is high-frequency noise that xBRZ barely alters.

The GIF writer uses ffmpeg with one palette for the whole sequence. Pillow
quantises each page separately, which invents dithering on top of the art being
judged for dithering artefacts.
