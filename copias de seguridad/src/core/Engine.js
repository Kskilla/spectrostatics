// src/core/Engine.js
// Motor Spectrostatics con múltiples agujas:
//  - Imagen scrollea (tiempo)
//  - Cadena de módulos
//  - Agujas: lista de x en px; drag sobre canvas mueve la más cercana
//  - onAfterStep({ columns: [{x,luma,r,g,b}], width, height, t, dt })

export class Engine {
  constructor(canvas, {
    modules = [],
    maxDim = 768,
    stepMs = 80,
    getParams = () => ({}),
    onAfterStep = () => {},
    initialNeedleFracs = [0.5] // fracciones 0..1
  } = {}) {
    this.canvas = canvas;
    this.ctxOut = canvas.getContext('2d', { desynchronized: true });
    this.modules = modules;
    this.maxDim = maxDim;
    this.stepMs = stepMs;
    this.getParams = getParams;
    this.onAfterStep = onAfterStep;

    this.workA = document.createElement('canvas');
    this.workB = document.createElement('canvas');
    this.running = false;
    this._acc = 0;
    this._last = 0;
    this._t = 0;

    this.needleXs = []; // en píxeles
    this.needleFracs = initialNeedleFracs.slice(); // 0..1
    this._activeNeedleIndex = 0;

    this._attachNeedleDrag();
  }

  setModules(mods) { this.modules = mods || []; }
  setGetParams(fn) { this.getParams = fn || (() => ({})); }
  setOnAfterStep(fn) { this.onAfterStep = fn || (() => {}); }

  setNeedleFracs(fracs = []) {
    this.needleFracs = fracs.map(f => Math.max(0, Math.min(1, f)));
    this._updateNeedleXsFromFracs();
  }

  async setImageBitmap(bitmap) {
    const scale = Math.min(1, this.maxDim / Math.max(bitmap.width, bitmap.height));
    const W = Math.max(1, Math.floor(bitmap.width * scale));
    const H = Math.max(1, Math.floor(bitmap.height * scale));
    [this.workA, this.workB, this.canvas].forEach(cv => { cv.width = W; cv.height = H; });

    const a = this.workA.getContext('2d', { desynchronized: true });
    const b = this.workB.getContext('2d', { desynchronized: true });
    a.clearRect(0, 0, W, H); a.drawImage(bitmap, 0, 0, W, H);
    b.clearRect(0, 0, W, H); b.drawImage(bitmap, 0, 0, W, H);

    // si no hay agujas definidas, centrada
    if (this.needleFracs.length === 0) this.needleFracs = [0.5];
    this._updateNeedleXsFromFracs();

    this.running = true;
    this._acc = 0; this._t = 0; this._last = performance.now();
    this._tick();
  }

  stop() { this.running = false; }

  _swap() { const tmp = this.workA; this.workA = this.workB; this.workB = tmp; }

  _scroll(src, dst, dx) {
    const w = src.width, h = src.height;
    const dctx = dst.getContext('2d');
    if (!dx) { dctx.drawImage(src, 0, 0); return; }
    const s = ((dx % w) + w) % w;
    dctx.clearRect(0, 0, w, h);
    dctx.drawImage(src, s, 0, w - s, h, 0, 0, w - s, h);
    if (s > 0) dctx.drawImage(src, 0, 0, s, h, w - s, 0, s, h);
  }

  _columnStats(x) {
    const w = this.workA.width, h = this.workA.height;
    const xi = Math.max(0, Math.min(w - 1, x|0));
    const data = this.workA.getContext('2d').getImageData(xi, 0, 1, h).data;
    let sr=0, sg=0, sb=0;
    for (let i=0;i<h;i++){ sr += data[i*4+0]; sg += data[i*4+1]; sb += data[i*4+2]; }
    const r = sr/h, g = sg/h, b = sb/h;
    const luma = 0.2126*r + 0.7152*g + 0.0722*b;
    return { x: xi, luma, r, g, b };
  }

  _processOnce(dt) {
    const core = this.getParams('CORE') || { scrollSpeed: 30 };
    const pixelsPerSec = core.scrollSpeed ?? 30;
    const dx = Math.max(0, Math.round((pixelsPerSec * dt) / 1000));

    // 1) Scroll
    this._scroll(this.workA, this.workB, dx);
    this._swap();

    // 2) Módulos
    for (const mod of this.modules) {
      const params = this.getParams(mod.name) || mod.params || {};
      if (mod?.processFrame) {
        mod.processFrame(this.workA, this.workB, params, this._t, dt);
        this._swap();
      }
    }

    // 3) Render
    this.ctxOut.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctxOut.drawImage(this.workA, 0, 0);

    // 4) Agujas
    this.ctxOut.save();
    this.ctxOut.lineWidth = 2;
    this.needleXs.forEach((x, i) => {
      const sel = (i === this._activeNeedleIndex);
      this.ctxOut.strokeStyle = sel ? 'rgba(255,80,80,0.95)' : 'rgba(255,160,160,0.6)';
      this.ctxOut.beginPath(); this.ctxOut.moveTo(x + 0.5, 0); this.ctxOut.lineTo(x + 0.5, this.canvas.height); this.ctxOut.stroke();
    });
    this.ctxOut.restore();

    // 5) Stats por aguja -> audio
    const columns = this.needleXs.map(x => this._columnStats(x));
    this.onAfterStep({ columns, width: this.canvas.width, height: this.canvas.height, t: this._t, dt });
  }

  _tick = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = Math.min(250, now - this._last);
    this._last = now; this._acc += dt; this._t += dt/1000;

    while (this._acc >= this.stepMs) { this._processOnce(this.stepMs); this._acc -= this.stepMs; }
    requestAnimationFrame(this._tick);
  }

  _updateNeedleXsFromFracs() {
    const W = this.canvas.width || 1;
    this.needleXs = this.needleFracs.map(f => Math.max(0, Math.min(W-1, Math.round(f * (W-1)))));
  }

  // ——— Drag: selecciona y arrastra la aguja más cercana ———
  _attachNeedleDrag() {
    const el = this.canvas;
    let dragging = false;

    const nearestIndex = (px) => {
      let best = 0, bd = 1e9;
      this.needleXs.forEach((x,i)=>{ const d = Math.abs(x-px); if (d<bd){ bd=d; best=i; }});
      return best;
    };

    const eventXToCanvasX = (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return Math.max(0, Math.min(this.canvas.width - 1, Math.round(x * (this.canvas.width / rect.width))));
    };

    const down = (e) => {
      const cx = eventXToCanvasX(e);
      this._activeNeedleIndex = nearestIndex(cx);
      dragging = true;
      el.setPointerCapture?.(e.pointerId);
      this._moveActiveNeedleTo(cx);
    };
    const move = (e) => { if (!dragging) return; this._moveActiveNeedleTo(eventXToCanvasX(e)); };
    const up   = (e) => { dragging = false; try { el.releasePointerCapture?.(e.pointerId); } catch {} };

    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  _moveActiveNeedleTo(canvasX) {
    const i = this._activeNeedleIndex;
    this.needleXs[i] = canvasX;
    const W = this.canvas.width || 1;
    this.needleFracs[i] = this.needleXs[i] / (W - 1);
  }
}
