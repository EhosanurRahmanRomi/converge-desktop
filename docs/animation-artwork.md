> Public source copy of the local project record. Machine-specific links have been converted or removed. Raw local evidence and private session data are not published.

# Converge animation artwork

Date: 2026-10-02. Current 1.6.4 artwork, followed by the historical 1.6.3 record.

## Current 1.6.4 artwork

The current themes are **Glowing stars**, **Ghost** and **Flowers**. The rejected comet mode and its PNG are excluded from the 1.6.4 menu/package. The former Ghost image is replaced by `ghost-v2.png`; Flowers retains `flower-blossom-v1.png`. Historical files and prompt specifications below describe 1.6.3 and are not the current theme set.

### Glowing stars: cached code artwork

Glowing stars are original code-drawn sprites, not a generated PNG or embedded video. The user's local video reference (private local reference; excluded from this source repository) was decoded into eight frames; the observed clip is 8.4 seconds at 926 × 520. Its filled five-point shapes, gold/pink/cyan/lilac halos, downward drift, slight sway, slow spin and glow/scale pulses inform the design. Watermark and suggestion-overlay elements are excluded. Findings and extracted frames are saved under reference-findings.md (local evidence or build output; excluded from this source repository).

The renderer caches its star shapes and glow for reuse, then applies movement and opacity within the upper/lower strips. It does not decode or play the reference recording at runtime. Final theme captures passed 16 local appearance checks; scoped performance/motion observations and completed local release gates are recorded in [the 1.6.4 verification record](browser-studio-1.6.4-verification.md). The measurements do not establish a GPU saving versus 1.6.3.

### Ghost v2: original transparent generated asset

- Method: **built-in image-generation tool**, with a transparent background.
- Current file: [ghost-v2.png](../renderer/ghost-v2.png).
- Original generator output: exec-7a92a477-b4bb-4295-85cd-f6f39d245b82.png (private local reference; excluded from this source repository).
- Dimensions: **1272 × 1236**, RGBA PNG, **715,076 bytes**.
- SHA-256: `3416c160be60ad2aaebe23855db0654a7a73ac54dad6fc6ccbb853e073ba754d`.

The new character has a compact pearl-white head/body, glossy violet/cyan eyes, lifted arms, a short curled tail and bright cyan/lavender rim light. Its central form is more opaque and simpler for small-size use. Band motion and spectral lights are supplied by code rather than baked into an animated image.

### Exact Ghost v2 generation prompt

The following is the **exact saved generation request**, also available as ghost-v2-prompt.txt (local evidence or build output; excluded from this source repository). The earlier 1.6.3 prompts later in this document remain explicitly reconstructed specifications.

```text
Use case: stylized-concept. Asset type: an original transparent PNG character sprite for a professional desktop application's Ghost animation theme, used very small at 40 to 80 pixels high. Create ONE friendly luminous little ghost, fully isolated and fully inside the canvas, with generous clear transparent margin. A polished premium 3D animated-movie character: compact rounded pearl-white head taking up the upper half, broad clean readable silhouette, large glossy midnight-indigo eyes with tiny cyan highlights, warm playful small smile, two tiny lifted arms, short gently curled floating tail underneath. Brilliant but tasteful cyan and lavender rim light and a vivid violet glow within the lower body, so the character has color and presence on a dark background. Keep its central face/body sufficiently opaque for a recognizable small icon; slightly translucent smooth edges only. A simple expressive cute face that stays readable at small scale. Soft satin material, subtle dimensional shading, strong simple shapes. No smoke cloak or long wispy fabric, no complicated filaments, no specks outside the silhouette, no particles, no stars, no environment, no ground shadow, no text, no watermark, no frame. True transparent background. Single original ghost facing three-quarter front, nearly upright.
```

### Retained Flowers asset

The current Flowers theme uses [flower-blossom-v1.png](../renderer/flower-blossom-v1.png): **1278 × 1230**, RGBA PNG, **1,974,791 bytes**; SHA-256 `a644defaa480c166064921a22af8383f3f5e9b47f6f5af42feaa176849deb5d8`. Its original generator path and reconstructed reusable specification remain below. No NASA/ESO photograph is included in the current themes.

## Historical 1.6.3 artwork

The remaining sections preserve provenance of the previous artwork. They are separate from the current 1.6.4 theme revision and its release checks.

### Historical creation and use

These are original images created with the **built-in image-generation tool**, using `transparent_background: true` and no referenced input images. The generated PNGs were copied into the renderer without replacing them with downloaded photographs. The comet, ghost and flower each have a transparent RGBA background.

The PNGs provide the subject artwork. `renderer/star-ribbons.js` supplies the motion: comet travel, ghost drifting, floating blossoms and petals, stars and the layered band backdrop. The two existing reviewer robots and their document handoff remain separate SVG/CSS animation.

The renderer downsamples the selected image once to at most **512 px on its longest side** for its runtime cache. Both bands share that cached image; switching the last band away or disposing the scenes releases it. The original PNG on disk retains the dimensions listed below. Changing a theme preserves the animation clock and the current On/Off setting; a paused scene redraws its newly selected theme once.

### Historical source files

| Theme | Saved renderer asset | Dimensions | Bytes |
|---|---|---:|---:|
| Galaxy & Comets | [comet-realistic-v1.png](../renderer/comet-realistic-v1.png) | 1983 × 793 | 1,681,534 |
| Ghost | [ghost-v1.png](../renderer/ghost-v1.png) | 1312 × 1199 | 1,061,538 |
| Flowers | [flower-blossom-v1.png](../renderer/flower-blossom-v1.png) | 1278 × 1230 | 1,974,791 |

Original generation outputs:

- Comet: exec-b9b8b24c-952e-4176-9d10-0e47baff2a38.png (private local reference; excluded from this source repository)
- Ghost: exec-53884c92-f9ea-4486-ab2f-7f5a9989c4bb.png (private local reference; excluded from this source repository)
- Flower: exec-bbd79629-d52b-4788-8b78-ba72e90e7cc6.png (private local reference; excluded from this source repository)

### Historical reconstructed design prompts

The following are reusable **reconstructed design prompts**, based on the selected subjects and inspected artwork. They are not claimed to be verbatim copies of the original generation requests. Use a transparent background with each prompt.

#### Galaxy & Comets

```text
Create a wide, isolated, realistic luminous comet as original artwork for a space-themed interface. Put a small bright cream-white coma near the lower-right end. Extend a broad, gently curved pale-gold dust tail toward the upper left, with a narrower cool-blue ion-like tail above it. Use soft diffuse gas, delicate wisps, filamentary texture and a subtle luminous halo. Keep the subject fully within the canvas with clean transparent space around its edges. The head should feel like a glowing cloud, and the tails should feel like fine dust and gas. Avoid hard polygon outlines, paper-plane shapes, geometric star-cross heads, background scenery, lettering and watermarks. Transparent PNG, high detail, wide composition.
```

The comet's diffuse visual treatment was informed by [NASA's view of Comet NEOWISE's structured tails](https://science.nasa.gov/image-article/apod-2020-july-22-the-structured-tails-of-comet-neowise/) and [ESO's view of Comet C/2024 G3 (ATLAS)](https://eso.org/public/images/potw2505b/). These pages are look references only. Their photographs are not distributed in Converge.

#### Ghost

```text
Create one original friendly floating ghost for a gentle animated interface. Give it a soft pearl-white luminous body, large glossy dark-violet eyes, a small warm smile and faint rosy cheeks. Its lower body should flow into translucent blue and lavender curls, with delicate ethereal edges and a soft glow. Use polished three-dimensional lighting and fine detail while keeping a readable, charming silhouette at small size. Center the complete character with transparent space around it. No scenery, lettering, watermark, horror elements or recognizable branded character. Transparent PNG.
```

#### Flowers

```text
Create one isolated pink five-petal blossom viewed from the front, with realistic macro detail. Show delicate petal veins, subtle folds, translucent highlights, a warm pink center and fine golden-yellow stamens. Use soft natural lighting, blush-pink petals and clean, softly defined edges. Center the complete flower with room around every petal. No stem, leaves, scenery, lettering or watermark. It should remain recognizable when used as a small drifting sprite. Transparent PNG.
```

### Historical verified asset identities

SHA-256 values of the renderer files:

```text
comet-realistic-v1.png
bf910747b820cca9ab5e96b62fc61d9792da2eb4e8dca4e4d5d1b6802faf719c

ghost-v1.png
cf6e72ff823be9259effc05b173ecd1f3f5cdf51efd6b44ac3ec263db7e5f26f

flower-blossom-v1.png
a644defaa480c166064921a22af8383f3f5e9b47f6f5af42feaa176849deb5d8
```

Artwork provenance and file identity are separate from release testing. Historical release results are in [the 1.6.3 verification document](browser-studio-1.6.3-verification.md); current checks are tracked in [the 1.6.4 verification document](browser-studio-1.6.4-verification.md).
