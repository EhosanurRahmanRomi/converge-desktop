/* Converge's small animated star ribbons. All artwork is cached locally. */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const THEMES = Object.freeze({
    stars: { colors: ['#ffe4a0', '#ff9ed2', '#9aefff', '#d8baff'], rgb: ['255,228,160', '255,158,210', '154,239,255', '216,186,255'], night: ['#251b23', '#2b1c28', '#182029'], asset: null, anchor: [.5, .5], tilt: 0 },
    ghost: { colors: ['#8cfbe2', '#8bd9ff', '#cea1ff', '#d9f6ff'], rgb: ['140,251,226', '139,217,255', '206,161,255', '217,246,255'], night: ['#071827', '#201637', '#082732'], asset: 'ghost-v2.png', anchor: [.5, .5], tilt: 0 },
    flowers: { colors: ['#ffabbe', '#93e3c5', '#ffd990', '#f17fb2'], rgb: ['255,171,190', '147,227,197', '255,217,144', '241,127,178'], night: ['#061b17', '#291220', '#091d20'], asset: 'flower-blossom-v1.png', anchor: [.5, .5], tilt: 0 }
  });
  const liveScenes = new Set();
  const documentAssets = new WeakMap(), activeAssets = new Set();
  function fract(value) { return value - Math.floor(value); }
  function random(index, salt) { return fract(Math.sin(index * 127.1 + salt * 311.7) * 43758.5453); }
  function surface(doc, width, height) { const canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
  function freeSurface(canvas) { if (canvas) { canvas.width = 1; canvas.height = 1; } }

  // A graceful loading/error fallback, cached once for each bitmap theme.
  function makeFallback(doc, theme) {
    const canvas = surface(doc, 128, 128);
    const paint = canvas.getContext('2d');
    if (theme === 'ghost') {
      const aura = paint.createRadialGradient(64, 61, 0, 64, 61, 61);
      aura.addColorStop(0, 'rgba(184,234,255,.50)'); aura.addColorStop(.4, 'rgba(154,214,245,.20)'); aura.addColorStop(1, 'rgba(126,198,245,0)');
      paint.fillStyle = aura; paint.fillRect(0, 0, 128, 128); paint.filter = 'blur(1.3px)';
      const cloth = paint.createLinearGradient(40, 18, 76, 113);
      cloth.addColorStop(0, 'rgba(247,252,255,.95)'); cloth.addColorStop(.6, 'rgba(186,231,255,.66)'); cloth.addColorStop(1, 'rgba(139,212,241,0)');
      paint.fillStyle = cloth; paint.beginPath(); paint.moveTo(32, 75); paint.bezierCurveTo(28, 4, 101, 4, 97, 75);
      paint.bezierCurveTo(91, 110, 85, 95, 74, 110); paint.bezierCurveTo(58, 94, 52, 113, 38, 110); paint.quadraticCurveTo(45, 91, 32, 75); paint.fill(); paint.filter = 'none';
      paint.fillStyle = '#143b59'; paint.beginPath(); paint.ellipse(53, 51, 4, 5, 0, 0, TAU); paint.ellipse(77, 51, 4, 5, 0, 0, TAU); paint.fill();
      paint.strokeStyle = '#295774'; paint.lineWidth = 2; paint.beginPath(); paint.arc(65, 60, 9, .15, Math.PI - .15); paint.stroke();
    } else {
      for (let index = 0; index < 10; index++) {
        paint.save(); paint.translate(64, 64); paint.rotate(index * TAU / 10);
        const petal = paint.createRadialGradient(0, -23, 1, 0, -27, 34);
        petal.addColorStop(0, '#ffe5ed'); petal.addColorStop(.65, '#ee99b7'); petal.addColorStop(1, 'rgba(209,107,150,0)');
        paint.fillStyle = petal; paint.beginPath(); paint.ellipse(0, -25, 16, 32, 0, 0, TAU); paint.fill(); paint.restore();
      }
      const center = paint.createRadialGradient(64, 64, 0, 64, 64, 15);
      center.addColorStop(0, '#fff3c7'); center.addColorStop(.65, '#eac976'); center.addColorStop(1, 'rgba(225,172,90,0)');
      paint.fillStyle = center; paint.fillRect(45, 45, 38, 38);
    }
    return { canvas, anchor: [.5, .5], tilt: 0 };
  }
  function acquireAsset(doc, win, theme, listener) {
    if (!THEMES[theme].asset) return null;
    let store = documentAssets.get(doc);
    if (!store) { store = new Map(); documentAssets.set(doc, store); }
    let entry = store.get(theme);
    if (!entry) {
      const fallback = makeFallback(doc, theme);
      entry = { theme, path: THEMES[theme].asset, status: 'loading', error: null, users: 0, listeners: new Set(), texture: fallback.canvas, anchor: fallback.anchor, tilt: fallback.tilt, image: null, store };
      store.set(theme, entry); activeAssets.add(entry);
      const image = new win.Image(); entry.image = image; image.decoding = 'async';
      image.onload = () => {
        if (!entry.users || entry.image !== image) return;
        const scale = Math.min(1, 512 / image.naturalWidth, 512 / image.naturalHeight);
        const bitmap = surface(doc, Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
        const paint = bitmap.getContext('2d'); paint.imageSmoothingEnabled = true; paint.imageSmoothingQuality = 'high';
        paint.drawImage(image, 0, 0, bitmap.width, bitmap.height); freeSurface(entry.texture);
        entry.texture = bitmap; entry.anchor = THEMES[theme].anchor; entry.tilt = THEMES[theme].tilt;
        entry.status = 'ready'; entry.image = null; image.onload = image.onerror = null;
        for (const callback of entry.listeners) callback(entry);
      };
      image.onerror = () => {
        if (!entry.users || entry.image !== image) return;
        entry.status = 'fallback'; entry.error = `Unable to load ${entry.path}`; entry.image = null; image.onload = image.onerror = null;
        for (const callback of entry.listeners) callback(entry);
      };
      // Only the two bitmap-theme artwork files can be requested here.
      image.src = new URL(entry.path, doc.baseURI).href;
    }
    entry.users++; entry.listeners.add(listener); return entry;
  }
  function releaseAsset(entry, listener) {
    if (!entry) return; entry.listeners.delete(listener); entry.users--;
    if (entry.users > 0) return;
    if (entry.image) { entry.image.onload = entry.image.onerror = null; entry.image = null; }
    freeSurface(entry.texture); entry.texture = null; entry.listeners.clear();
    entry.store.delete(entry.theme); activeAssets.delete(entry);
  }
  function assetInfo(entry) { return { theme: entry.theme, path: entry.path, status: entry.status, ready: entry.status === 'ready', error: entry.error, users: entry.users, width: entry.texture?.width || 0, height: entry.texture?.height || 0, bytes: entry.texture ? entry.texture.width * entry.texture.height * 4 : 0 }; }

  function create(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('Star ribbon needs a canvas');
    const opts = options || {}, doc = canvas.ownerDocument, win = doc.defaultView || root;
    const band = opts.band === 'bottom' ? 'bottom' : 'top';
    const fps = Math.min(30, Math.max(12, Number(opts.fps) || 30));
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Star ribbon canvas unavailable');
    const started = performance.now();
    let paused = Boolean(opts.startPaused), disposed = false, elapsed = 0, previousTime = null;
    let frameCount = 0, raf = 0, lastFrame = -Infinity, sizeDirty = true, resizeObserver;
    let drawWidth = 0, drawHeight = 0, nebula, cacheBuilds = 0;
    let theme = Object.hasOwn(THEMES, opts.theme) ? opts.theme : 'stars';
    let sprites = [], dotSprites = [], petalSprite, asset, readableAreas = [];
    const stars = Array.from({ length: band === 'top' ? 104 : 68 }, (_, index) => ({
      x: random(index, 17), y: random(index, 71), depth: .18 + random(index, 59) * .82,
      phase: random(index, 93) * TAU, speed: .14 + random(index, 41) * .47,
      size: index % 17 === 0 ? 8 + random(index, 33) * 6 : 1.6 + random(index, 29) * 3.0,
      color: index % 4, orbit: index % 3 === 0
    }));
    const flowStars = Array.from({ length: band === 'top' ? 88 : 58 }, (_, index) => ({
      x: random(index, 211), y: random(index, 223), depth: index % 15 === 0 ? .94 : .25 + random(index, 227) * .75,
      phase: random(index, 229) * TAU, color: index % 4, large: index % 15 === 0,
      spin: (random(index, 233) - .5) * .12, xNow: 0, yNow: 0, rotation: 0, speed: 0, wrapHeight: 0, drawSize: 0, pulse: 0
    }));
    const pinpoints = Array.from({ length: band === 'top' ? 190 : 130 }, (_, index) => ({
      x: random(index, 241), y: random(index, 251), depth: .10 + random(index, 257) * .75,
      phase: random(index, 263) * TAU, color: index % 4, size: .85 + random(index, 269) * 1.75
    }));
    const actors = Array.from({ length: band === 'top' ? 9 : 7 }, (_, index) => ({
      x: random(index, 131), y: .23 + random(index, 137) * .51, depth: .42 + random(index, 139) * .58,
      phase: random(index, 149) * TAU, speed: .035 + random(index, 151) * .030,
      direction: index % 2 ? -1 : 1, xNow: 0, yNow: 0, rotation: 0, drawWidth: 0, drawHeight: 0
    }));

    function makeStar(color, rgb) {
      const fivePoint = theme === 'stars', size = fivePoint ? 96 : 64, center = size / 2;
      const sprite = surface(doc, size, size), paint = sprite.getContext('2d');
      const glow = paint.createRadialGradient(center, center, 0, center, center, center - 3);
      glow.addColorStop(0, '#ffffff'); glow.addColorStop(fivePoint ? .21 : .055, '#ffffff');
      glow.addColorStop(fivePoint ? .39 : .14, color); glow.addColorStop(fivePoint ? .66 : .36, `rgba(${rgb},${fivePoint ? '.38' : '.22'})`);
      glow.addColorStop(1, `rgba(${rgb},0)`); paint.fillStyle = glow; paint.fillRect(0, 0, size, size);
      if (fivePoint) {
        // A filled five-point silhouette, baked with its glow. No blur or paths are painted in the animation loop.
        paint.beginPath();
        for (let index = 0; index < 10; index++) {
          const angle = -Math.PI / 2 + index * Math.PI / 5, radius = index % 2 ? 14.4 : 30;
          const x = center + Math.cos(angle) * radius, y = center + Math.sin(angle) * radius;
          if (index) paint.lineTo(x, y); else paint.moveTo(x, y);
        }
        paint.closePath();
        const fill = paint.createRadialGradient(center, center - 3, 0, center, center, 35);
        fill.addColorStop(0, '#ffffff'); fill.addColorStop(.64, '#fffdf8'); fill.addColorStop(1, color);
        paint.fillStyle = fill; paint.shadowColor = color; paint.shadowBlur = 8; paint.fill();
        paint.shadowBlur = 0;
      } else {
        paint.fillStyle = '#ffffff'; paint.beginPath(); paint.arc(center, center, 1.5, 0, TAU); paint.fill();
      }
      return sprite;
    }
    function makeDot(rgb) {
      const sprite = surface(doc, 16, 16), paint = sprite.getContext('2d');
      const glow = paint.createRadialGradient(8, 8, 0, 8, 8, 8);
      glow.addColorStop(0, '#ffffff'); glow.addColorStop(.14, '#ffffff');
      glow.addColorStop(.32, `rgba(${rgb},.82)`); glow.addColorStop(1, `rgba(${rgb},0)`);
      paint.fillStyle = glow; paint.fillRect(0, 0, 16, 16); return sprite;
    }
    function buildSprites() {
      for (const sprite of sprites) freeSurface(sprite);
      for (const sprite of dotSprites) freeSurface(sprite);
      freeSurface(petalSprite); petalSprite = null;
      sprites = THEMES[theme].colors.map((color, index) => makeStar(color, THEMES[theme].rgb[index]));
      dotSprites = THEMES[theme].rgb.map(makeDot);
      if (theme === 'flowers') {
        petalSprite = surface(doc, 40, 48); const paint = petalSprite.getContext('2d');
        const petal = paint.createRadialGradient(17, 21, 1, 20, 24, 24);
        petal.addColorStop(0, '#fff4f3'); petal.addColorStop(.55, '#efa7be'); petal.addColorStop(1, 'rgba(221,129,161,0)');
        paint.fillStyle = petal; paint.beginPath(); paint.ellipse(20, 24, 10, 20, -.35, 0, TAU); paint.fill();
      }
    }
    function onAssetReady(entry) {
      if (disposed || entry !== asset) return;
      // A still frame may gain its finished artwork; elapsed time is unchanged.
      if (paused && !doc.hidden) draw();
    }
    buildSprites(); asset = acquireAsset(doc, win, theme, onAssetReady);

    function buildNebula() {
      const width = drawWidth + 64, height = drawHeight + 24;
      freeSurface(nebula); nebula = surface(doc, width, height); const paint = nebula.getContext('2d', { alpha: false });
      const night = paint.createLinearGradient(0, 0, width, height);
      const palette = THEMES[theme];
      night.addColorStop(0, palette.night[0]); night.addColorStop(.48, palette.night[1]); night.addColorStop(1, palette.night[2]);
      paint.fillStyle = night; paint.fillRect(0, 0, width, height);
      paint.globalCompositeOperation = 'screen';
      // These large, irregular mist layers are painted only when dimensions change.
      for (let index = 0; index < 11; index++) {
        const x = width * random(index, 37), y = height * (.18 + random(index, 47) * .64);
        const radius = width * (.13 + random(index, 79) * .15), color = index % 4;
        paint.save(); paint.translate(x, y); paint.scale(1, .24 + random(index, 23) * .19);
        const mist = paint.createRadialGradient(0, 0, 0, 0, 0, radius);
        mist.addColorStop(0, `rgba(${palette.rgb[color]},${index % 3 ? '.11' : '.19'})`);
        mist.addColorStop(.37, `rgba(${palette.rgb[color]},.065)`); mist.addColorStop(1, `rgba(${palette.rgb[color]},0)`);
        paint.fillStyle = mist; paint.fillRect(-radius, -radius, radius * 2, radius * 2); paint.restore();
      }
      const count = Math.min(760, Math.max(210, Math.round(width / 1.9)));
      for (let index = 0; index < count; index++) {
        const x = random(index, 101) * width, y = random(index, 103) * height;
        const ridge = .48 + .24 * Math.sin(x / width * 8.2 + (band === 'bottom' ? 2.6 : .3));
        const inCloud = Math.abs(y / height - ridge) < .24;
        paint.globalAlpha = (inCloud ? .22 : .13) + random(index, 109) * .53;
        const size = index % 53 === 0 ? 9 : .65 + random(index, 107) * 2.2;
        paint.drawImage(dotSprites[index % 4], x - size / 2, y - size / 2, size, size);
      }
      paint.globalAlpha = 1; cacheBuilds++;
    }
    function measure() {
      if (!sizeDirty) return; sizeDirty = false;
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
      const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
      const ratio = Math.min(1.25, Number(win.devicePixelRatio) || 1);
      const scale = Math.min(ratio, 1680 / width, 144 / height);
      const nextWidth = Math.max(1, Math.round(width * scale)), nextHeight = Math.max(1, Math.round(height * scale));
      // Feather bright moving artwork around the actual text, without a plate or dark mask.
      const selectors = band === 'top' ? '.reviewer h2, .reviewer p, .reviewer-eyebrow' : '#bottomStage, #bottomRound, #bottomFiles, #saveFilesCompact, #restoreSplit';
      readableAreas = Array.from(doc.querySelectorAll(selectors), node => {
        const box = node.getBoundingClientRect();
        if (!box.width || !box.height || box.right < rect.left || box.left > rect.right || box.bottom < rect.top || box.top > rect.bottom) return null;
        return { x: (box.left + box.width / 2 - rect.left) * scale, y: (box.top + box.height / 2 - rect.top) * scale, rx: (box.width / 2 + 14) * scale, ry: (box.height / 2 + 10) * scale };
      }).filter(Boolean);
      if (drawWidth === nextWidth && drawHeight === nextHeight) return;
      drawWidth = nextWidth; drawHeight = nextHeight; canvas.width = drawWidth; canvas.height = drawHeight; buildNebula();
    }
    function readability(x, y, radius) {
      let alpha = 1;
      for (const area of readableAreas) {
        const dx = (x - area.x) / (area.rx + radius * .35), dy = (y - area.y) / (area.ry + radius * .25);
        const influence = Math.max(0, 1 - dx * dx - dy * dy);
        alpha = Math.min(alpha, 1 - .68 * influence * influence);
      }
      return alpha;
    }
    function drawFlowStar(star, t) {
      const bandScale = drawHeight / (band === 'top' ? 108 : 56);
      const pulse = .78 + .22 * (.5 + .5 * Math.sin(t * (.48 + star.depth * .31) + star.phase));
      const baseSize = (star.large ? band === 'top' ? 43 + star.depth * 7 : 24 + star.depth * 4 : (band === 'top' ? 6 : 4) + Math.pow(star.depth, 1.6) * (band === 'top' ? 20 : 11)) * bandScale;
      const size = baseSize * (.92 + pulse * .08), margin = baseSize * .6, wrapHeight = drawHeight + margin * 2;
      const speed = drawHeight * (.08 + .145 * star.depth);
      const x = star.x * drawWidth + Math.sin(t * .11 + star.phase) * drawHeight * .023 * star.depth;
      const y = ((star.y * wrapHeight + t * speed) % wrapHeight) - margin;
      const rotation = star.phase * .37 + t * star.spin;
      star.xNow = x; star.yNow = y; star.rotation = rotation; star.speed = speed; star.wrapHeight = wrapHeight; star.drawSize = size; star.pulse = pulse;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
      ctx.globalAlpha = pulse * (.59 + star.depth * .40) * readability(x, y, size / 2);
      ctx.drawImage(sprites[star.color], -size / 2, -size / 2, size, size); ctx.restore();
    }
    function drawPinpoint(point, t) {
      const speed = drawHeight * (.022 + point.depth * .055), margin = 3;
      const x = point.x * drawWidth, y = ((point.y * (drawHeight + margin * 2) + t * speed) % (drawHeight + margin * 2)) - margin;
      const size = point.size * drawHeight / (band === 'top' ? 108 : 56);
      ctx.globalAlpha = (.40 + point.depth * .42) * (.74 + .26 * (.5 + .5 * Math.sin(t * .63 + point.phase)));
      ctx.drawImage(dotSprites[point.color], x - size / 2, y - size / 2, size, size);
    }
    function drawStar(star, t) {
      const drift = t * (.0018 + star.depth * .0026) * (star.color % 2 ? -1 : 1);
      const x = fract(star.x + drift + Math.sin(t * .023 + star.phase) * .016 * star.depth) * drawWidth;
      const y = (.5 + (star.y - .5) * .84 + Math.sin(t * (star.orbit ? .14 : .055) + star.phase) * .09 * star.depth) * drawHeight;
      const pulse = .40 + .60 * Math.pow(.5 + .5 * Math.sin(t * star.speed + star.phase), 2);
      const size = star.size * (.88 + pulse * .23) * Math.min(1.3, drawHeight / 74);
      ctx.globalAlpha = pulse * (.52 + .48 * star.depth) * readability(x, y, size / 2);
      ctx.drawImage(sprites[star.color], x - size / 2, y - size / 2, size, size);
    }
    function actorCount() { return theme === 'stars' ? 0 : theme === 'ghost' ? 5 : actors.length; }
    function ghostPoint(actor, t, index) {
      const margin = drawHeight * .70;
      const x = fract(index / actorCount() + actor.x * .07 + t * .0033 * actor.direction * (.60 + actor.depth)) * (drawWidth + margin * 2) - margin + Math.sin(t * .20 + actor.phase) * drawHeight * .22;
      const y = (.49 + (actor.y - .5) * .21 + Math.sin(t * .33 + actor.phase) * .105 * actor.depth + Math.cos(t * .15 + actor.phase * .7) * .035) * drawHeight;
      return { x, y };
    }
    function drawGhostWisps(t) {
      for (let index = 0; index < actorCount(); index++) {
        const actor = actors[index];
        for (let trail = 5; trail > 0; trail--) {
          const point = ghostPoint(actor, t - trail * 1.15, index);
          const size = drawHeight * (.13 + actor.depth * .055) * (1 + trail * .12);
          const y = point.y + drawHeight * .20 + Math.sin(t * .42 + trail + actor.phase) * drawHeight * .05;
          ctx.globalAlpha = (.32 - trail * .045) * readability(point.x, y, size / 2);
          ctx.drawImage(sprites[(index + trail) % 4], point.x - size / 2, y - size / 2, size, size);
        }
      }
    }
    function drawActor(actor, t, index) {
      const ghost = theme === 'ghost';
      const margin = drawHeight * .95;
      const point = ghost ? ghostPoint(actor, t, index) : null;
      const x = ghost ? point.x : fract(actor.x + t * .0028 * actor.direction * (.55 + actor.depth) + Math.sin(t * .081 + actor.phase) * .023) * (drawWidth + margin * 2) - margin;
      const y = ghost ? point.y : (.5 + (actor.y - .5) * .67 + Math.sin(t * .19 + actor.phase) * .082 * actor.depth) * drawHeight;
      const rotation = ghost ? Math.sin(t * .36 + actor.phase) * .16 + Math.cos(t * .21 + actor.phase) * .055 : actor.phase + t * actor.speed * actor.direction + Math.sin(t * .19 + actor.phase) * .10;
      actor.xNow = x; actor.yNow = y; actor.rotation = rotation;
      const height = (ghost ? band === 'top' ? 94 + actor.depth * 20 : 49 + actor.depth * 11 : band === 'top' ? 36 + actor.depth * 16 : 20 + actor.depth * 10) * drawHeight / (band === 'top' ? 108 : 56);
      const width = height * asset.texture.width / asset.texture.height;
      actor.drawWidth = width; actor.drawHeight = height;
      ctx.save(); ctx.translate(x, y); ctx.rotate(rotation);
      ctx.globalAlpha = ((ghost ? .96 : .79) + Math.sin(t * .35 + actor.phase) * (ghost ? .035 : .06)) * Math.min(readability(x, y, height / 2), readability(x, y - height * .20, height * .25));
      ctx.drawImage(asset.texture, -asset.anchor[0] * width, -asset.anchor[1] * height, width, height); ctx.restore();
    }
    function drawPetals(t) {
      for (let index = 0; index < (band === 'top' ? 18 : 12); index++) {
        const actor = actors[index % actors.length], phase = actor.phase + index * .71;
        const x = fract(actor.x + Math.sin(t * .13 + phase) * .039 + t * .0021 * actor.direction) * drawWidth;
        const y = fract(actor.y + t * .016 + Math.sin(t * .09 + phase) * .08) * drawHeight;
        const size = (8 + actor.depth * 6) * drawHeight / (band === 'top' ? 108 : 56);
        ctx.save(); ctx.translate(x, y); ctx.rotate(t * .37 * actor.direction + Math.sin(t * .24 + phase) * .5);
        ctx.globalAlpha = (.56 + actor.depth * .19) * readability(x, y, size / 2); ctx.drawImage(petalSprite, -size / 2, -size * .6, size, size * 1.2); ctx.restore();
      }
    }
    function draw() {
      if (disposed) return; measure();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(nebula, -32 + Math.sin(elapsed * .043) * 18, -12 + Math.cos(elapsed * .033) * 5);
      ctx.globalCompositeOperation = 'screen';
      if (theme === 'stars') {
        for (const point of pinpoints) drawPinpoint(point, elapsed);
        for (const star of flowStars) drawFlowStar(star, elapsed);
      } else {
        for (const star of stars) drawStar(star, elapsed);
        if (theme === 'ghost') drawGhostWisps(elapsed);
        ctx.globalCompositeOperation = theme === 'ghost' ? 'screen' : 'source-over';
        for (let index = 0; index < actorCount(); index++) drawActor(actors[index], elapsed, index);
        if (theme === 'flowers') drawPetals(elapsed);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; frameCount++;
    }
    function effectiveFps() { return theme === 'ghost' ? Math.min(24, fps) : fps; }
    function tick(now) {
      raf = 0;
      if (disposed || paused || doc.hidden) { previousTime = null; return; }
      if (previousTime !== null) elapsed += Math.min(.15, (now - previousTime) / 1000);
      previousTime = now;
      if (now - lastFrame >= 1000 / effectiveFps() - 1) { draw(); lastFrame = now; }
      raf = win.requestAnimationFrame(tick);
    }
    function schedule() { if (!disposed && !paused && !doc.hidden && !raf) raf = win.requestAnimationFrame(tick); }
    function onVisibility() { if (doc.hidden) { win.cancelAnimationFrame(raf); raf = 0; previousTime = null; } else schedule(); }
    function onResize() { sizeDirty = true; if (paused || doc.hidden) draw(); }
    doc.addEventListener('visibilitychange', onVisibility); win.addEventListener('resize', onResize);
    if (typeof win.ResizeObserver === 'function') { resizeObserver = new win.ResizeObserver(onResize); resizeObserver.observe(canvas); }
    draw(); schedule();
    const controller = Object.freeze({
      setPaused(value) { paused = Boolean(value); if (paused) { win.cancelAnimationFrame(raf); raf = 0; previousTime = null; } else schedule(); },
      setTheme(value) {
        if (disposed || !Object.hasOwn(THEMES, value)) return false;
        if (theme === value) return true;
        releaseAsset(asset, onAssetReady); theme = value; asset = acquireAsset(doc, win, theme, onAssetReady);
        buildSprites(); buildNebula(); draw(); return true;
      },
      diagnostics() {
        const procedural = theme === 'stars' && !disposed, ready = procedural || asset?.status === 'ready';
        const ownTextures = [nebula, ...sprites, ...dotSprites, petalSprite].filter(Boolean);
        return { supported: true, canvasId: canvas.id || null, mode: 'canvas2d', band, theme, paused, disposed, frames: frameCount, seconds: Number(elapsed.toFixed(3)), fpsLimit: effectiveFps(), configuredFpsLimit: fps, width: drawWidth, height: drawHeight, ageMs: Math.round(performance.now() - started), stars: theme === 'stars' ? flowStars.length : stars.length, pinpoints: theme === 'stars' ? pinpoints.length : 0,
          activeStars: theme === 'stars' ? flowStars.slice(0, 12).map((star, index) => ({ id: index, x: Number(star.xNow.toFixed(2)), y: Number(star.yNow.toFixed(2)), depth: Number(star.depth.toFixed(3)), rotation: Number(star.rotation.toFixed(3)), size: Number(star.drawSize.toFixed(3)), pulse: Number(star.pulse.toFixed(3)), speed: Number(star.speed.toFixed(3)), wrapHeight: Number(star.wrapHeight.toFixed(3)) })) : [],
          activeActors: actors.slice(0, actorCount()).map((actor, index) => ({ id: index, x: Number(actor.xNow.toFixed(2)), y: Number(actor.yNow.toFixed(2)), rotation: Number(actor.rotation.toFixed(3)), width: Number(actor.drawWidth.toFixed(3)), height: Number(actor.drawHeight.toFixed(3)) })), assetPath: THEMES[theme].asset, assetStatus: procedural ? 'procedural' : asset?.status || 'disposed', assetReady: Boolean(ready), assetLoaded: Boolean(asset?.status === 'ready'), assetError: asset?.error || null, sharedAssetBytes: asset?.texture ? asset.texture.width * asset.texture.height * 4 : 0, cacheBuilds, cachedSprites: sprites.length + dotSprites.length + (petalSprite ? 1 : 0) + (asset?.texture ? 1 : 0), cacheBytes: disposed ? 0 : ownTextures.reduce((bytes, texture) => bytes + texture.width * texture.height * 4, 0) };
      },
      dispose() { if (disposed) return; disposed = true; win.cancelAnimationFrame(raf); raf = 0; doc.removeEventListener('visibilitychange', onVisibility); win.removeEventListener('resize', onResize); if (resizeObserver) resizeObserver.disconnect(); freeSurface(nebula); nebula = null; for (const sprite of sprites) freeSurface(sprite); sprites = []; for (const sprite of dotSprites) freeSurface(sprite); dotSprites = []; readableAreas = []; freeSurface(petalSprite); petalSprite = null; releaseAsset(asset, onAssetReady); asset = null; liveScenes.delete(controller); }
    });
    liveScenes.add(controller); return controller;
  }
  root.ConvergeStarRibbons = Object.freeze({ create, diagnostics() { return Array.from(liveScenes, scene => scene.diagnostics()); }, assetDiagnostics() { return Array.from(activeAssets, assetInfo); }, supported: typeof root.document !== 'undefined', version: '3.0.0' });
})(globalThis);
