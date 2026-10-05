# Artwork and motion

[← Project](../README.md) · [Architecture](ARCHITECTURE.md)

The current 1.8.1 app on Windows and Mac retains **Glowing stars**, **Ghost** and **Flowers** decoration. The earlier comet theme is excluded; saved comet preferences migrate to Glowing stars. Five chat backgrounds and three team character styles are independently selectable.

## Current assets

| Visual | Implementation | Identity |
|---|---|---|
| Glowing stars | Original code-drawn, cached sprites with gold/pink/cyan/lilac glow, falling drift and slow spin | `renderer/star-ribbons.js` |
| Ghost | Original generated transparent PNG; motion and spectral lights supplied by code | `renderer/ghost-v2.png`, 1272 × 1236, 715,076 bytes |
| Flowers | Original generated transparent blossom; petals/motion supplied by code | `renderer/flower-blossom-v1.png`, 1278 × 1230, 1,974,791 bytes |
| Boss and worker characters | Original SVG/CSS robots, explorers and spirits with decorative work, expressions and document handoff | Desktop renderer HTML/CSS and state updates |
| Chat backgrounds | Still Night sky, Black horror, Alien, Cyberpunk city and Anime twilight; local code/SVG art | `src/browser/page-appearance.js` and renderer CSS; generated into the page preload |

```text
ghost-v2.png
SHA-256: 3416c160be60ad2aaebe23855db0654a7a73ac54dad6fc6ccbb853e073ba754d

flower-blossom-v1.png
SHA-256: a644defaa480c166064921a22af8383f3f5e9b47f6f5af42feaa176849deb5d8
```

Ghost and Flowers were created with the built-in image-generation tool using a transparent background. They are original subject assets, not downloaded photographs. Motion is supplied by code; no reference video is played in the runtime. No NASA or ESO photograph is distributed in these current themes.

## Ghost v2 design request

This is the saved generation request for the current Ghost character:

```text
Use case: stylized-concept. Asset type: an original transparent PNG character sprite for a professional desktop application's Ghost animation theme, used very small at 40 to 80 pixels high. Create ONE friendly luminous little ghost, fully isolated and fully inside the canvas, with generous clear transparent margin. A polished premium 3D animated-movie character: compact rounded pearl-white head taking up the upper half, broad clean readable silhouette, large glossy midnight-indigo eyes with tiny cyan highlights, warm playful small smile, two tiny lifted arms, short gently curled floating tail underneath. Brilliant but tasteful cyan and lavender rim light and a vivid violet glow within the lower body, so the character has color and presence on a dark background. Keep its central face/body sufficiently opaque for a recognizable small icon; slightly translucent smooth edges only. A simple expressive cute face that stays readable at small scale. Soft satin material, subtle dimensional shading, strong simple shapes. No smoke cloak or long wispy fabric, no complicated filaments, no specks outside the silhouette, no particles, no stars, no environment, no ground shadow, no text, no watermark, no frame. True transparent background. Single original ghost facing three-quarter front, nearly upright.
```

The retained Flowers asset is a front-facing pink five-petal blossom with delicate veins, a warm center and fine yellow stamens. Its earlier reusable prompt in the historical record is a reconstructed specification, not a claimed verbatim generation request.

## Bounded decoration

- Both narrow bands share cached assets; subject images are downsampled once to a runtime cache no larger than 512 px on the longest side.
- Stars and Flowers are capped at 30 fps; Ghost at 24 fps.
- The large center/chat backdrops stay still.
- Switching theme preserves the current animation clock and On/Off preference.
- Off stops decorative motion and mood timers while reviewer work continues.
- Hidden/minimized state and reduced motion suspend decoration appropriately.
- Cosmetic mood changes do not indicate measured confidence or answer quality.

The interface previews use controlled fixture state; native startup screenshots show an empty session. They show the design, not a live provider exchange. No quantitative GPU reduction was measured for 1.8.1.
