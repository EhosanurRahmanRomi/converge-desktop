/* Converge's original procedural galaxy. No images, network requests, or dependencies. */
(function (root) {
  'use strict';
  const VERTEX = 'attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}';
  // Bake the unchanged five-octave fields once. They do not depend on time;
  // animation only moves the coordinates at which the fields are sampled.
  const FIELD_KERNEL = `
    float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    float fbm(vec2 p){float v=0.,a=.5;mat2 m=mat2(1.62,1.17,-1.17,1.62);for(int i=0;i<5;i++){v+=a*noise(p);p=m*p+vec2(17.3,9.2);a*=.49;}return v;}
  `;
  const BAKE_FRAGMENT = `
    precision highp float;
    uniform vec2 bakeResolution;
    uniform vec2 fieldExtent;
    uniform float fieldKind;
    ${FIELD_KERNEL}
    void main(){
      vec2 p=(gl_FragCoord.xy/bakeResolution-.5)*fieldExtent;
      if(fieldKind<.5){
        gl_FragColor=vec4(fbm(p+vec2(3.7,1.2)),fbm(p*3.+vec2(1.7,-2.4)),0.,1.);
      }else{
        gl_FragColor=vec4(fbm(p+vec2(9.7,21.3)),fbm(p*2.7+vec2(12.1,-8.6)),fbm(p*1.15+4.),1.);
      }
    }
  `;
  const FRAGMENT = `
    precision highp float;
    uniform vec2 resolution;
    uniform float time;
    uniform float brightness;
    uniform sampler2D backgroundField;
    uniform sampler2D galaxyField;
    uniform vec2 backgroundExtent;
    float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
    mat2 rotate(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
    vec3 stars(vec2 p,float grid,float speed){
      p+=vec2(time*speed,time*speed*.39)+vec2(sin(time*.018),cos(time*.014))*speed*12.;p*=grid;vec2 cell=floor(p),f=fract(p)-.5;
      float h=hash(cell+31.7),h2=hash(cell+77.1);vec2 offset=(vec2(h,h2)-.5)*.64;
      float d=length(f-offset),size=mix(.017,.055,pow(h,13.));
      float pin=exp(-d*d/(size*size)),glow=.035*exp(-d*d/(size*size*35.));
      float twinkle=.66+.34*sin(time*(.45+h*1.5)+h2*40.);
      vec3 color=mix(vec3(.47,.72,1.),vec3(1.,.67,.91),h2);
      float flare=pow(h,44.)*.010/(abs(f.x-offset.x)*abs(f.y-offset.y)*150.+.09)*exp(-d*15.);
      flare*=1.+(1.-step(20.,grid))*2.6*pow(.5+.5*sin(time*.85+h2*17.),6.);
      return color*(pin+glow+flare)*twinkle*step(.36,h);
    }
    vec3 orbitalComet(vec2 q,float radius,float rate,float offset,vec3 color){
      float angle=atan(q.y,q.x),phase=time*rate+offset;
      float delta=mod(angle-phase+3.141593,6.283185)-3.141593;
      float radial=length(q)-radius;
      float tail=smoothstep(-.74,-.57,delta)*(1.-smoothstep(-.015,.065,delta))*exp(-max(-delta,0.)*4.4);
      float streak=exp(-radial*radial*65000.)*tail*.20;
      float haze=exp(-radial*radial*5500.)*tail*.032;
      float head=exp(-radial*radial*36000.-delta*delta*2800.)*1.12;
      float pulse=.68+.32*sin(time*.041+offset*2.);
      return color*(streak+haze+head)*pulse;
    }
    vec3 foregroundGlint(vec2 p,vec2 origin,float phase){
      vec2 center=origin+vec2(sin(time*.055+phase),cos(time*.041+phase))*.032;
      vec2 ray=p-center;float d=length(ray);
      float beat=.12+.88*pow(.5+.5*sin(time*.71+phase),5.);
      float core=exp(-d*d*90000.)*.64;
      float sparkle=.009/(abs(ray.x)*abs(ray.y)*17000.+.035)*exp(-d*68.);
      return mix(vec3(.55,.84,1.),vec3(.92,.66,1.),.5+.5*sin(phase))*(core+sparkle)*beat;
    }
    vec3 meteor(vec2 p,float offset,float period,vec2 start,vec2 velocity){
      float phase=mod(time+offset,period);
      float active=smoothstep(0.,.3,phase)*(1.-smoothstep(1.05,1.8,phase));
      vec2 head=start+velocity*phase;
      vec2 tangent=normalize(velocity),ray=p-head;
      float along=dot(ray,tangent),across=dot(ray,vec2(-tangent.y,tangent.x));
      float trail=exp(-across*across*240000.)*exp(-abs(along)*14.)*(1.-step(0.,along));
      float pin=exp(-dot(ray,ray)*125000.);
      return vec3(.63,.84,1.)*(trail*.5+pin*.65)*active;
    }
    void main(){
      vec2 uv=gl_FragCoord.xy/resolution, p=(uv-.5)*vec2(resolution.x/resolution.y,1.);
      vec2 drift=vec2(sin(time*.011),cos(time*.009))*.08;
      vec2 flow=p*2.2+drift;
      vec2 cloudField=texture2D(backgroundField,flow/backgroundExtent+.5).rg;
      float n=cloudField.r,wisps=cloudField.g;
      vec3 color=vec3(.009,.012,.045);
      float cloud=pow(max(0.,n-.24),2.)*1.45;
      color+=mix(vec3(.05,.12,.70),vec3(.56,.025,.68),smoothstep(.32,.68,wisps))*cloud;
      color+=vec3(.04,.33,.55)*pow(max(0.,wisps-.43),2.)*1.1;

      vec2 q=rotate(-.22+sin(time*.006)*.025)*(p-vec2(.015,.015));
      q*=.82;q.y*=1.58;float r=length(q),a=atan(q.y,q.x);
      float turn=a-r*7.6-time*.055;
      vec2 warped=rotate(time*.016)*q*6.3;
      // The disk ends at r=1.34, hence every visible warped coordinate is
      // within +/-8.442. The cached square has a margin beyond that circle.
      vec3 detail=texture2D(galaxyField,warped/17.3+.5).rgb;
      float grain=detail.r;
      float filament=detail.g;
      float arms=pow(.5+.5*cos(turn*3.+grain*.95),3.5);
      float ribbons=pow(.5+.5*cos(turn*9.+grain*2.),12.);
      float disk=exp(-r*2.65)*(1.-smoothstep(.19,1.34,r));
      float fog=pow(max(grain-.20,0.),1.5);
      vec3 violet=vec3(.49,.075,1.05),pink=vec3(1.22,.055,.62),blue=vec3(.04,.68,1.15);
      float hue=.5+.5*sin(turn*2.+r*7.+filament*4.);
      vec3 armColor=mix(violet,pink,smoothstep(.18,.82,hue));
      armColor=mix(armColor,blue,smoothstep(.60,.95,filament));
      color+=armColor*disk*(.15+arms*2.2)*fog*3.5;
      color+=vec3(.73,.55,1.)*ribbons*disk*(.22+grain)*.55;
      float lace=pow(max(filament-.53,0.)*2.8,2.2);
      color+=mix(vec3(.44,.8,1.),vec3(1.,.57,.94),hue)*lace*disk*(.2+arms)*1.6;
      float dust=pow(max(0.,.61-detail.b),3.0)*15.;
      color*=1.-clamp(dust*disk*.6,0.,.65);
      float core=exp(-r*r*99.);
      color+=vec3(1.0,.78,.98)*core*3.7+vec3(.39,.30,.75)*exp(-r*r*12.)*.34;
      color+=stars(p,132.,.0006)*.38+stars(p,82.,.0012)*.64+stars(p,39.,.0029)*.74+stars(p,16.,.0048)*.82;
      color+=orbitalComet(q,.48,.105,.72,vec3(.45,.83,1.));
      color+=orbitalComet(q,.73,-.078,3.86,vec3(.88,.58,1.));
      color+=orbitalComet(q,.94,.055,1.98,vec3(.59,.70,1.));
      color+=foregroundGlint(p,vec2(-.64,.30),.8)+foregroundGlint(p,vec2(.67,-.30),3.4)+foregroundGlint(p,vec2(-.41,-.28),5.2);
      color+=meteor(p,8.,22.,vec2(-.67,.29),vec2(.87,-.42));
      color+=meteor(p,17.,31.,vec2(.70,.37),vec2(-.82,-.51))*.7;
      float vignette=1.-smoothstep(.5,1.65,length(p))*.28;
      color=1.-exp(-color*brightness*1.14);
      color=pow(color,vec3(.89))*vignette;
      gl_FragColor=vec4(color,1.);
    }
  `;

  function compile(gl, type, code) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, code); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const error = gl.getShaderInfoLog(shader); gl.deleteShader(shader); throw new Error(error || 'Galaxy shader failed');
    }
    return shader;
  }

  function create(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('Galaxy needs a canvas');
    const opts = options || {};
    const doc = canvas.ownerDocument;
    const win = doc.defaultView || root;
    const originalVisibility = canvas.style.visibility;
    const brightness = Number.isFinite(opts.brightness) ? Math.min(2, Math.max(.15, opts.brightness)) : 1.15;
    const fps = Math.min(30, Math.max(12, Number(opts.fps) || 30));
    let gl, program, buffer, vertex, fragment, ctx, fallbackCanvas, renderCanvas = canvas;
    let bakeProgram, bakeFragment, bakeFramebuffer, backgroundField, galaxyField;
    let mode = 'webgl', error = null, disposed = false, paused = opts.startPaused === true, contextLost = false;
    let raf = 0, frameCount = 0, lastFrame = -Infinity, elapsed = 0, previousTime = null;
    let width = 0, height = 0, drawWidth = 0, drawHeight = 0, resizeObserver, sizeDirty = true;
    let resolutionLocation, timeLocation, brightnessLocation, backgroundExtentLocation;
    let bakeResolutionLocation, fieldExtentLocation, fieldKindLocation;
    let maxTextureSize = 0, bakeCount = 0, fieldBytes = 0;
    let background, galaxy, stars = [], glows = [];
    const start = performance.now();

    function cleanupGL() {
      if (gl && !contextLost) {
        if (buffer) gl.deleteBuffer(buffer);
        if (program) gl.deleteProgram(program);
        if (vertex) gl.deleteShader(vertex);
        if (fragment) gl.deleteShader(fragment);
        if (bakeProgram) gl.deleteProgram(bakeProgram);
        if (bakeFragment) gl.deleteShader(bakeFragment);
        if (bakeFramebuffer) gl.deleteFramebuffer(bakeFramebuffer);
        if (backgroundField) gl.deleteTexture(backgroundField);
        if (galaxyField) gl.deleteTexture(galaxyField);
      }
      buffer = program = vertex = fragment = null;
      bakeProgram = bakeFragment = bakeFramebuffer = backgroundField = galaxyField = null;
      fieldBytes = 0;
    }
    function bindQuad(selectedProgram) {
      gl.useProgram(selectedProgram); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const position = gl.getAttribLocation(selectedProgram, 'position');
      gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    }
    function bakeField(existing, textureWidth, textureHeight, extentX, extentY, kind) {
      const result = existing || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, result);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, textureWidth, textureHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bakeFramebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, result, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        if (!existing) gl.deleteTexture(result);
        throw new Error('Galaxy field framebuffer unavailable');
      }
      bindQuad(bakeProgram); gl.viewport(0, 0, textureWidth, textureHeight);
      gl.uniform2f(bakeResolutionLocation, textureWidth, textureHeight);
      gl.uniform2f(fieldExtentLocation, extentX, extentY); gl.uniform1f(fieldKindLocation, kind);
      const dither = gl.isEnabled(gl.DITHER); gl.disable(gl.DITHER);
      gl.drawArrays(gl.TRIANGLES, 0, 6); if (dither) gl.enable(gl.DITHER);
      bakeCount++;
      return result;
    }
    function prepareFields() {
      // The background domain follows aspect ratio so even extremely wide or
      // tall windows retain the same noise rather than clamping or repeating.
      const extentX = 2.2 * drawWidth / drawHeight + .20, extentY = 2.40;
      const textureWidth = Math.min(maxTextureSize, Math.max(64, Math.ceil(drawWidth * 1.5)));
      const textureHeight = Math.min(maxTextureSize, Math.max(64, Math.ceil(drawHeight * 1.5)));
      backgroundField = bakeField(backgroundField, textureWidth, textureHeight, extentX, extentY, 0);
      const detailSize = Math.min(2048, maxTextureSize);
      if (!galaxyField) galaxyField = bakeField(null, detailSize, detailSize, 17.3, 17.3, 1);
      fieldBytes = 4 * (textureWidth * textureHeight + detailSize * detailSize);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); bindQuad(program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, backgroundField);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, galaxyField);
      gl.uniform2f(backgroundExtentLocation, extentX, extentY);
      gl.viewport(0, 0, drawWidth, drawHeight);
    }
    function initGL() {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WebGL unavailable');
      mode = 'webgl'; renderCanvas = canvas;
      if (fallbackCanvas) { fallbackCanvas.remove(); fallbackCanvas = null; canvas.style.visibility = originalVisibility; }
      vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
      fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      program = gl.createProgram(); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Galaxy shader link failed');
      buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      bindQuad(program);
      resolutionLocation = gl.getUniformLocation(program, 'resolution'); timeLocation = gl.getUniformLocation(program, 'time'); brightnessLocation = gl.getUniformLocation(program, 'brightness');
      gl.uniform1f(brightnessLocation, brightness);
      backgroundExtentLocation = gl.getUniformLocation(program, 'backgroundExtent');
      gl.uniform1i(gl.getUniformLocation(program, 'backgroundField'), 0);
      gl.uniform1i(gl.getUniformLocation(program, 'galaxyField'), 1);
      bakeFragment = compile(gl, gl.FRAGMENT_SHADER, BAKE_FRAGMENT);
      bakeProgram = gl.createProgram(); gl.attachShader(bakeProgram, vertex); gl.attachShader(bakeProgram, bakeFragment); gl.linkProgram(bakeProgram);
      if (!gl.getProgramParameter(bakeProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(bakeProgram) || 'Galaxy bake shader link failed');
      bakeResolutionLocation = gl.getUniformLocation(bakeProgram, 'bakeResolution');
      fieldExtentLocation = gl.getUniformLocation(bakeProgram, 'fieldExtent'); fieldKindLocation = gl.getUniformLocation(bakeProgram, 'fieldKind');
      bakeFramebuffer = gl.createFramebuffer(); maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      drawWidth = drawHeight = 0; sizeDirty = true; measure();
    }

    function fract(n) { return n - Math.floor(n); }
    function hash2(x, y) { return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453); }
    function noise2(x, y) {
      const ix = Math.floor(x), iy = Math.floor(y); let fx = fract(x), fy = fract(y);
      fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
      return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
    }
    function fbm2(x, y) {
      let value = 0, amplitude = .5;
      for (let octave = 0; octave < 4; octave++) { value += noise2(x,y) * amplitude; const nx = x * 1.62 - y * 1.17 + 17.3; y = x * 1.17 + y * 1.62 + 9.2; x = nx; amplitude *= .49; }
      return value;
    }
    function texture(size, type) {
      const surface = doc.createElement('canvas'); surface.width = size; surface.height = size;
      const surfaceCtx = surface.getContext('2d'); const pixels = surfaceCtx.createImageData(size, size);
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const px = (x / size - .5) * 2.5, py = (y / size - .5) * 2.5;
        const n = fbm2(px*3+9.7,py*3+21.3), fine = fbm2(px*9+12.1,py*9-8.6);
        let red, green, blue, alpha = 1;
        if (type === 'background') {
          const cloud = Math.pow(Math.max(0,n-.22),2)*1.65;
          red = .03 + cloud * (.21+fine*.6); green = .035 + cloud*(.18+(1-fine)*.20); blue = .12+cloud*.96;
        } else {
          const radius = Math.hypot(px,py)*.82, angle = Math.atan2(py,px)-radius*7.6;
          const arms = Math.pow(.5+.5*Math.cos(angle*3+n*.95),3.5);
          const ribbons = Math.pow(.5+.5*Math.cos(angle*9+n*2),12);
          const disk = Math.exp(-radius*2.65) * Math.max(0,Math.min(1,(1.28-radius)*3));
          const hue = .5+.5*Math.sin(angle*2+radius*7+fine*4), fog = Math.pow(Math.max(n-.20,0),1.5);
          const intensity = disk * (.15+arms*2.2)*fog*4.4;
          const blueGlow = Math.max(0,fine-.53)*3;
          const core = Math.exp(-radius*radius*99)*3.7, ribbonLight=ribbons*disk*(.22+n)*.55;
          red = (.49 + hue*.73)*intensity+blueGlow*disk*.4+core+ribbonLight*.73;
          green = (.075+Math.max(0,fine-.60)*1.5)*intensity+blueGlow*disk*.55+core*.78+ribbonLight*.55;
          blue = (1.05-hue*.43)*intensity+blueGlow*disk*.8+core*.98+ribbonLight;
          const dust = Math.max(0,.61-fbm2(px*3.5+4,py*3.5+4));
          const dim = 1-Math.min(.6,dust*dust*dust*18*disk); red*=dim;green*=dim;blue*=dim;
          alpha = Math.min(1,disk*2.5);
        }
        const i = (y*size+x)*4;
        pixels.data[i] = Math.pow(1-Math.exp(-red*brightness*1.14),.89)*255;
        pixels.data[i+1] = Math.pow(1-Math.exp(-green*brightness*1.14),.89)*255;
        pixels.data[i+2] = Math.pow(1-Math.exp(-blue*brightness*1.14),.89)*255;
        pixels.data[i+3] = alpha*255;
      }
      surfaceCtx.putImageData(pixels,0,0); return surface;
    }
    function initFallback() {
      mode = 'canvas2d'; cleanupGL();
      drawWidth = drawHeight = 0; sizeDirty = true;
      // A canvas cannot change context types after WebGL allocation. Use an owned sibling only in that case.
      ctx = !gl && canvas.getContext('2d', { alpha: false });
      if (!ctx) {
        fallbackCanvas = doc.createElement('canvas'); fallbackCanvas.setAttribute('aria-hidden','true');
        fallbackCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
        canvas.insertAdjacentElement('afterend',fallbackCanvas); canvas.style.visibility = 'hidden';
        renderCanvas = fallbackCanvas; ctx = renderCanvas.getContext('2d', { alpha: false });
      }
      if (!ctx) throw new Error('No canvas renderer available');
      background = texture(256, 'background'); galaxy = texture(448, 'galaxy');
      stars = Array.from({length:360}, (_,i) => ({x:hash2(i,31),y:hash2(i,73),z:.2+hash2(i,51)*.8,size:hash2(i,23),phase:hash2(i,97)*Math.PI*2}));
      glows = ['#9bd6ff','#efb5ff','#ffffff'].map(color => {
        const sprite = doc.createElement('canvas'); sprite.width = sprite.height = 40;
        const paint = sprite.getContext('2d'), gradient = paint.createRadialGradient(20,20,0,20,20,20);
        gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.07,color);gradient.addColorStop(.22,color+'99');gradient.addColorStop(1,color+'00');
        paint.fillStyle = gradient;paint.fillRect(0,0,40,40);return sprite;
      });
    }

    function measure() {
      if (!sizeDirty) return;
      sizeDirty = false;
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width || canvas.clientWidth || 1));
      const nextHeight = Math.max(1, Math.round(rect.height || canvas.clientHeight || 1));
      const ratio = Math.min(1.25, Number(win.devicePixelRatio) || 1);
      const scale = Math.min(ratio, 1050/nextWidth, 720/nextHeight);
      const nextDrawWidth = Math.max(1, Math.round(nextWidth*scale)), nextDrawHeight = Math.max(1,Math.round(nextHeight*scale));
      if (nextDrawWidth === drawWidth && nextDrawHeight === drawHeight && nextWidth === width && nextHeight === height) return;
      width = nextWidth; height = nextHeight; drawWidth = nextDrawWidth; drawHeight = nextDrawHeight;
      renderCanvas.width = drawWidth; renderCanvas.height = drawHeight;
      if (mode === 'webgl' && !contextLost) prepareFields();
    }
    function drawFallback(t) {
      ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over'; ctx.fillStyle='#050719';ctx.fillRect(0,0,drawWidth,drawHeight);
      const zoom = Math.max(drawWidth,drawHeight)*1.48;
      ctx.drawImage(background,(drawWidth-zoom)/2+Math.sin(t*.011)*24,(drawHeight-zoom)/2+Math.cos(t*.009)*20,zoom,zoom);
      ctx.save();ctx.translate(drawWidth*.515,drawHeight*.48);ctx.rotate(-.22+Math.sin(t*.006)*.025);ctx.scale(1,.63);
      ctx.rotate(-t*.022);ctx.globalCompositeOperation='screen';const diameter = drawHeight*2.10;
      ctx.drawImage(galaxy,-diameter/2,-diameter/2,diameter,diameter);ctx.restore();
      ctx.globalCompositeOperation='screen';
      for (let i=0;i<stars.length;i++) {
        const star=stars[i]; const sx=fract(star.x+t*.0007*star.z+Math.sin(t*.018)*.012*star.z)*drawWidth,sy=fract(star.y+t*.00027*star.z+Math.cos(t*.014)*.012*star.z)*drawHeight;
        const twinkle=.55+.45*Math.sin(t*(.45+star.z*1.5)+star.phase);const size=star.size>.96?13:star.size>.87?6:2;
        ctx.globalAlpha=(.35+.65*star.z)*twinkle;ctx.drawImage(glows[i%3],sx-size/2,sy-size/2,size,size);
        if(size>6){ctx.strokeStyle='#e3e8ff';ctx.lineWidth=.5;ctx.beginPath();ctx.moveTo(sx-5,sy);ctx.lineTo(sx+5,sy);ctx.moveTo(sx,sy-5);ctx.lineTo(sx,sy+5);ctx.stroke();}
      }
      drawOrbitalComet(t,.48,.105,.72,'#a0ddff',0);
      drawOrbitalComet(t,.73,-.078,3.86,'#d8abff',1);
      drawOrbitalComet(t,.94,.055,1.98,'#c1cfff',0);
      drawForegroundGlint(t,-.64,.30,.8,0);
      drawForegroundGlint(t,.67,-.30,3.4,1);
      drawForegroundGlint(t,-.41,-.28,5.2,0);
      drawMeteor(t,8,22,-.67,.29,.87,-.42,1);
      drawMeteor(t,17,31,.70,.37,-.82,-.51,.7);
      ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';
    }
    function drawOrbitalComet(t,radius,rate,offset,color,sprite) {
      const phase=-(t*rate+offset),r=drawHeight*radius/.82,pulse=.68+.32*Math.sin(t*.041+offset*2);
      ctx.save();ctx.translate(drawWidth*.515,drawHeight*.48);ctx.rotate(-.22+Math.sin(t*.006)*.025);ctx.scale(1,1/1.58);
      ctx.strokeStyle=color;ctx.lineWidth=.85;
      for(let i=0;i<18;i++){const a=i*.037;ctx.globalAlpha=.34*Math.exp(-a*4.4)*pulse*(1-Math.max(0,(a-.57)/.14));ctx.beginPath();ctx.arc(0,0,r,phase+a,phase+a+.039);ctx.stroke();}
      const sx=Math.cos(phase)*r,sy=Math.sin(phase)*r;ctx.globalAlpha=pulse*.85;ctx.drawImage(glows[sprite],sx-10,sy-10,20,20);ctx.fillStyle='#e5e9ff';ctx.beginPath();ctx.arc(sx,sy,1.25,0,Math.PI*2);ctx.fill();ctx.restore();
    }
    function drawForegroundGlint(t,x,y,phase,sprite) {
      const sx=drawWidth*.5+(x+Math.sin(t*.055+phase)*.032)*drawHeight,sy=drawHeight*(.5-y-Math.cos(t*.041+phase)*.032);
      const beat=.12+.88*Math.pow(.5+.5*Math.sin(t*.71+phase),5);
      ctx.globalAlpha=beat*.85;ctx.drawImage(glows[sprite],sx-13,sy-13,26,26);
      ctx.globalAlpha=beat*.64;ctx.strokeStyle=sprite?'#e7c5ff':'#cceeff';ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(sx-10,sy);ctx.lineTo(sx+10,sy);ctx.moveTo(sx,sy-10);ctx.lineTo(sx,sy+10);ctx.stroke();
    }
    function drawMeteor(t,offset,period,x,y,vx,vy,intensity) {
      const phase=(t+offset)%period;if(phase>=1.8)return;
      const active=Math.min(1,phase/.3)*Math.max(0,Math.min(1,(1.8-phase)/.75));
      const sx=drawWidth*.5+(x+vx*phase)*drawHeight,sy=drawHeight*(.5-y-vy*phase),distance=Math.hypot(vx,vy);
      const tx=vx/distance*92,ty=-vy/distance*92;
      const gradient=ctx.createLinearGradient(sx-tx,sy-ty,sx,sy);gradient.addColorStop(0,'#b8ddff00');gradient.addColorStop(1,'#d5e8ff');
      ctx.globalAlpha=active*.7*intensity;ctx.strokeStyle=gradient;ctx.lineWidth=1.4;ctx.beginPath();ctx.moveTo(sx-tx,sy-ty);ctx.lineTo(sx,sy);ctx.stroke();ctx.drawImage(glows[0],sx-4,sy-4,8,8);
    }
    function draw() {
      if (disposed || contextLost) return;
      try { measure(); }
      catch(failure) {
        if(mode!=='webgl')throw failure;
        error=String(failure.message||failure);initFallback();measure();
      }
      if (mode === 'webgl') { gl.uniform2f(resolutionLocation,drawWidth,drawHeight);gl.uniform1f(timeLocation,elapsed);gl.drawArrays(gl.TRIANGLES,0,6); }
      else drawFallback(elapsed);
      frameCount++;
    }
    function tick(now) {
      raf = 0;
      if (disposed || paused || doc.hidden || contextLost) { previousTime=null;return; }
      if (previousTime !== null) elapsed+=Math.min(.15,(now-previousTime)/1000);
      previousTime=now;
      if(now-lastFrame>=1000/fps-1){draw();lastFrame=now;}
      raf=win.requestAnimationFrame(tick);
    }
    function schedule() { if(!disposed&&!paused&&!doc.hidden&&!contextLost&&!raf) raf=win.requestAnimationFrame(tick); }
    function onVisibility() { if(doc.hidden){win.cancelAnimationFrame(raf);raf=0;previousTime=null;}else schedule(); }
    function onLost(event) { event.preventDefault();contextLost=true;win.cancelAnimationFrame(raf);raf=0;previousTime=null;cleanupGL(); }
    function onRestored() {
      contextLost=false;
      try { initGL();draw();schedule(); }
      catch(failure){error=String(failure.message||failure);initFallback();drawWidth=drawHeight=0;sizeDirty=true;draw();schedule();}
    }
    try { if(opts.forceCanvas2D) throw new Error('Canvas2D explicitly selected');initGL(); }
    catch(failure){error=String(failure.message||failure);initFallback();}
    canvas.addEventListener('webglcontextlost',onLost);canvas.addEventListener('webglcontextrestored',onRestored);
    doc.addEventListener('visibilitychange',onVisibility);
    function onResize(){sizeDirty=true;if(paused||doc.hidden)draw();}
    if (typeof win.ResizeObserver === 'function') { resizeObserver=new win.ResizeObserver(onResize);resizeObserver.observe(canvas); }
    win.addEventListener('resize',onResize);
    draw();schedule();
    return Object.freeze({
      setPaused(value){paused=Boolean(value);if(paused){win.cancelAnimationFrame(raf);raf=0;previousTime=null;}else schedule();},
      diagnostics(){return {supported:true,mode,paused,disposed,contextLost,frames:frameCount,seconds:Number(elapsed.toFixed(3)),fpsLimit:fps,width:drawWidth,height:drawHeight,ageMs:Math.round(performance.now()-start),fallbackReason:error,fieldBakes:bakeCount,fieldTextureBytes:fieldBytes};},
      dispose(){if(disposed)return;disposed=true;win.cancelAnimationFrame(raf);raf=0;doc.removeEventListener('visibilitychange',onVisibility);win.removeEventListener('resize',onResize);canvas.removeEventListener('webglcontextlost',onLost);canvas.removeEventListener('webglcontextrestored',onRestored);if(resizeObserver)resizeObserver.disconnect();cleanupGL();if(fallbackCanvas){fallbackCanvas.remove();canvas.style.visibility=originalVisibility;}background=galaxy=null;stars=[];glows=[];}
    });
  }
  root.ConvergeGalaxy = Object.freeze({create,supported:typeof root.document!=='undefined',version:'2.2.0'});
})(globalThis);
