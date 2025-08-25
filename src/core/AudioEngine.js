// src/core/AudioEngine.js
// sum(voices + externalBus) -> BiquadFilter -> Waveshaper -> Compressor -> MasterGain -> destination

export class AudioEngine {
  constructor() {
    this.ctx = null;

    this.voiceSum = null;
    this.externalBus = null; // entrada para beatbox u otras fuentes
    this.masterFilter = null;
    this.masterDrive = null;
    this.masterComp = null;
    this.masterGain = null;

    this.voices = []; // { osc, gain, pan }
    this.voiceCount = 0;

    // params
    this.isOn = false;
    this._targetVol = 0.2;
    this.waveform = "sawtooth";
    this.filterType = "lowpass";
    this.filterCutoff = 800;   // bajo para notar el filtro
    this.filterQ = 1.2;        // resonancia audible
    this.drive = 0.2;
  }

  ensure() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.voiceSum = this.ctx.createGain();
    this.voiceSum.gain.value = 1.0;

    this.externalBus = this.ctx.createGain();
    this.externalBus.gain.value = 1.0;

    this.masterFilter = this.ctx.createBiquadFilter();
    this.masterFilter.type = this.filterType;
    this.masterFilter.frequency.value = this.filterCutoff;
    this.masterFilter.Q.value = this.filterQ;

    this.masterDrive = this.ctx.createWaveShaper();
    this._updateDriveCurve();

    this.masterComp = this.ctx.createDynamicsCompressor();
    this.masterComp.threshold.value = -18;
    this.masterComp.knee.value = 24;
    this.masterComp.ratio.value = 3;
    this.masterComp.attack.value = 0.003;
    this.masterComp.release.value = 0.25;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.0;

    // Mezcla voces + bus externo y pasa por FX
    const preFXSum = this.ctx.createGain();
    this.voiceSum.connect(preFXSum);
    this.externalBus.connect(preFXSum);
    preFXSum
      .connect(this.masterFilter)
      .connect(this.masterDrive)
      .connect(this.masterComp)
      .connect(this.masterGain)
      .connect(this.ctx.destination);

    return this.ctx;
  }

  async resume() {
    this.ensure();
    if (this.ctx.state === "suspended") { try { await this.ctx.resume(); } catch {} }
    return this.ctx.state;
  }
  getState() { return this.ctx ? this.ctx.state : "uninitialized"; }

  // GainNode para conectar fuentes externas (beatbox)
  getExternalInput() { this.ensure(); return this.externalBus; }

  setVoices(n) {
    this.ensure();
    const count = Math.max(1, Math.min(3, n|0));
    while (this.voices.length > count) {
      const v = this.voices.pop();
      try { v.osc.stop(); } catch {}
      v.osc.disconnect(); v.gain.disconnect(); v.pan.disconnect();
    }
    while (this.voices.length < count) {
      const osc = this.ctx.createOscillator();
      osc.type = this.waveform;
      const gain = this.ctx.createGain(); gain.gain.value = 0.0;
      const pan = this.ctx.createStereoPanner(); pan.pan.value = 0.0;
      osc.connect(gain).connect(pan).connect(this.voiceSum);
      osc.start();
      this.voices.push({ osc, gain, pan, targetGain: 0.5 });
    }
    this.voiceCount = count;
    this._rebalancePans();
    this._refreshVoiceGains();
  }

  _rebalancePans() {
    const n = this.voices.length;
    const pans = (n === 1) ? [0] : (n === 2) ? [-0.6, 0.6] : [-0.7, 0, 0.7];
    this.voices.forEach((v,i)=> v.pan.pan.value = pans[i]);
  }
  _refreshVoiceGains() {
    const n = Math.max(1, this.voices.length);
    const perVoice = this._targetVol / n;
    const t = this.ctx.currentTime;
    this.voices.forEach(v => {
      v.targetGain = perVoice;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setTargetAtTime(this.isOn ? perVoice : 0.0, t, 0.03);
    });
  }

  setOn(on) {
    this.ensure();
    this.isOn = !!on;
    const t = this.ctx.currentTime;
    this.masterGain.gain.cancelScheduledValues(t);
    this.masterGain.gain.setTargetAtTime(this.isOn ? 1.0 : 0.0, t, 0.03);
    this._refreshVoiceGains();
  }
  setMasterVolume(vol) { this.ensure(); this._targetVol = Math.max(0, Math.min(1, vol)); this._refreshVoiceGains(); }
  setWaveform(type)     { this.ensure(); this.waveform = type; this.voices.forEach(v => v.osc.type = type); }
  setDrive(amount)      { this.ensure(); this.drive = Math.max(0, Math.min(1, amount)); this._updateDriveCurve(); }

  setFilter(type, cutoff, Q) {
    this.ensure();
    this.filterType = type || this.filterType;
    this.filterCutoff = cutoff ?? this.filterCutoff;
    this.filterQ = Q ?? this.filterQ;
    const t = this.ctx.currentTime;
    this.masterFilter.type = this.filterType;
    this.masterFilter.frequency.cancelScheduledValues(t);
    this.masterFilter.frequency.setTargetAtTime(this.filterCutoff, t, 0.03);
    this.masterFilter.Q.cancelScheduledValues(t);
    this.masterFilter.Q.setTargetAtTime(this.filterQ, t, 0.03);
  }

  _updateDriveCurve() {
    if (!this.masterDrive) return;
    const k = 1 + this.drive * 100;
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.atan(k * x) / Math.atan(k);
    }
    this.masterDrive.curve = curve;
    this.masterDrive.oversample = "2x";
  }

  setFrequencies(freqs = [], stepSeconds = 0.08, headphoneSafe = false) {
    this.ensure();
    const t = this.ctx.currentTime;
    const n = Math.min(this.voices.length, freqs.length);
    for (let i = 0; i < n; i++) {
      let f = freqs[i];
      if (headphoneSafe) f = Math.max(80, Math.min(2000, f));
      f = Math.max(10, Math.min(20000, f));
      const v = this.voices[i];
      v.osc.frequency.cancelScheduledValues(t);
      v.osc.frequency.linearRampToValueAtTime(f, t + Math.max(0.01, stepSeconds * 0.9));
    }
  }
}
