// src/core/BeatEngine.js
// Sampler sintético 808-like: kick, snare, hihat. Scheduler preciso con lookahead.
// Incluye funciones de probabilidad por step para variar el patrón.

export class BeatEngine {
  constructor(ctx, destination, { onStep = () => {} } = {}) {
    this.ctx = ctx;
    this.dest = destination; // GainNode (audio.getExternalInput())
    this.onStep = onStep;

    this.isRunning = false;
    this.bpm = 110;
    this.stepIndex = 0; // 0..15
    this.lookahead = 0.025;        // 25ms
    this.scheduleAheadTime = 0.1;  // 100ms
    this.timer = null;

    // patrones por pista (boolean[16])
    this.kick = Array(16).fill(false);
    this.snare = Array(16).fill(false);
    this.hat = Array(16).fill(false);

    // patrón por defecto 4/4
    [0, 8].forEach(i => this.kick[i] = true);
    [4, 12].forEach(i => this.snare[i] = true);
    for (let i=0;i<16;i++) if ([2,6,10,14].includes(i)) this.hat[i] = true;

    // volúmenes
    this.kickVol = 0.9;
    this.snareVol = 0.5;
    this.hatVol = 0.35;

    // fns de probabilidad (opcionales)
    this.probKick = null;
    this.probSnare = null;
    this.probHat = null;

    this._nextNoteTime = 0;
  }

  setBPM(bpm) { this.bpm = Math.max(40, Math.min(220, bpm)); }
  setVolumes({ kick, snare, hat }) {
    if (kick != null) this.kickVol = Math.max(0, Math.min(1, kick));
    if (snare != null) this.snareVol = Math.max(0, Math.min(1, snare));
    if (hat != null) this.hatVol = Math.max(0, Math.min(1, hat));
  }
  setPattern(track, arr16) {
    if (!Array.isArray(arr16) || arr16.length !== 16) return;
    if (track === "kick") this.kick = arr16.slice();
    if (track === "snare") this.snare = arr16.slice();
    if (track === "hat") this.hat = arr16.slice();
  }
  setProbFns({ kick, snare, hat } = {}) {
    this.probKick = kick || null;
    this.probSnare = snare || null;
    this.probHat = hat || null;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.stepIndex = 0;
    this._nextNoteTime = this.ctx.currentTime + 0.05;
    this.timer = setInterval(() => this._scheduler(), this.lookahead * 1000);
  }
  stop() {
    this.isRunning = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  _scheduler() {
    const secPerBeat = 60.0 / this.bpm;    // negra
    const secPerStep = secPerBeat / 4.0;   // 16avos

    while (this._nextNoteTime < this.ctx.currentTime + this.scheduleAheadTime) {
      // probabilidades mezclando patrón base on/off con probFNs
      const baseK = this.kick[this.stepIndex] ? 1 : 0;
      const baseS = this.snare[this.stepIndex] ? 1 : 0;
      const baseH = this.hat[this.stepIndex] ? 1 : 0;

      const pk = (this.probKick ? this.probKick(this.stepIndex, this._nextNoteTime) : 1) * baseK;
      const ps = (this.probSnare ? this.probSnare(this.stepIndex, this._nextNoteTime) : 1) * baseS;
      const ph = (this.probHat ? this.probHat(this.stepIndex, this._nextNoteTime) : 1) * baseH;

      if (Math.random() < pk) this._triggerKick(this._nextNoteTime, this.kickVol);
      if (Math.random() < ps) this._triggerSnare(this._nextNoteTime, this.snareVol);
      if (Math.random() < ph) this._triggerHat(this._nextNoteTime, this.hatVol);

      this.onStep(this.stepIndex, this._nextNoteTime);

      // avanza step
      this._nextNoteTime += secPerStep;
      this.stepIndex = (this.stepIndex + 1) % 16;
    }
  }

  // ---- Sintetizadores simples ----
  _triggerKick(t, vol=0.9) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    gain.gain.value = 0.0;
    osc.connect(gain).connect(this.dest);

    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.12);

    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);

    osc.start(t);
    osc.stop(t + 0.2);
  }

  _triggerSnare(t, vol=0.5) {
    const noise = this._whiteNoise();
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 700;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;

    noise.connect(bp).connect(hp).connect(gain).connect(this.dest);

    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    setTimeout(()=> { noise.stop(); }, (t - this.ctx.currentTime + 0.15)*1000);
  }

  _triggerHat(t, vol=0.35) {
    const noise = this._whiteNoise();
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass"; hp.frequency.value = 5000; hp.Q.value = 0.7;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0;

    noise.connect(hp).connect(gain).connect(this.dest);

    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    setTimeout(()=> { noise.stop(); }, (t - this.ctx.currentTime + 0.08)*1000);
  }

  _whiteNoise() {
    const bufferSize = 0.5 * this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = false;
    src.start = src.start.bind(src);
    src.stop = src.stop.bind(src);
    src.start(0);
    return src;
  }
}
