// src/modules/RGBShift.js
// Drift cromático degenerativo (suave), con offsets que oscilan en el tiempo.

export const RGBShift = {
  name: "RGB Shift",
  params: {
    amount: 2,     // magnitud base de píxeles
    oscSpeed: 0.25, // velocidad de oscilación (Hz aprox)
    wrap: true
  },
  controls: [
    { type: "slider", param: "amount", label: "Amount (px)", min: 0, max: 10, step: 1 },
    { type: "slider", param: "oscSpeed", label: "Osc Speed", min: 0, max: 2, step: 0.05 },
    { type: "checkbox", param: "wrap", label: "Wrap edges" }
  ],
  processFrame(srcCanvas, dstCanvas, params, t /*sec*/, dt /*ms*/) {
    const w = srcCanvas.width, h = srcCanvas.height;
    const sctx = srcCanvas.getContext('2d');
    const dctx = dstCanvas.getContext('2d', { desynchronized: true });

    const src = sctx.getImageData(0, 0, w, h);
    const s = src.data;
    const out = dctx.createImageData(w, h);
    const o = out.data;

    // offsets suaves (oscilan con el tiempo)
    const mag = params.amount || 0;
    const spd = params.oscSpeed || 0;
    const rx = mag * Math.sin(t * Math.PI * 2 * spd + 0.0);
    const ry = mag * Math.cos(t * Math.PI * 2 * (spd * 0.8) + 1.1);
    const gx = mag * Math.sin(t * Math.PI * 2 * (spd * 1.1) + 2.2);
    const gy = mag * Math.cos(t * Math.PI * 2 * (spd * 0.9) + 0.3);
    const bx = mag * Math.sin(t * Math.PI * 2 * (spd * 0.7) + 1.7);
    const by = mag * Math.cos(t * Math.PI * 2 * (spd * 1.3) + 2.9);

    const wrap = !!params.wrap;
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    const sample = (x, y, c) => {
      let xi = Math.round(x), yi = Math.round(y);
      if (wrap) {
        xi = ((xi % w) + w) % w;
        yi = ((yi % h) + h) % h;
      } else {
        xi = clamp(xi, 0, w - 1);
        yi = clamp(yi, 0, h - 1);
      }
      return s[(yi * w + xi) * 4 + c];
    };

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        o[i + 0] = sample(x + rx, y + ry, 0);
        o[i + 1] = sample(x + gx, y + gy, 1);
        o[i + 2] = sample(x + bx, y + by, 2);
        o[i + 3] = 255;
      }
    }
    dctx.putImageData(out, 0, 0);
  }
};

export default RGBShift;
