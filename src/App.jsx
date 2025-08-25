// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import { Engine } from "./core/Engine";
import { AudioEngine } from "./core/AudioEngine";
import { BeatEngine } from "./core/BeatEngine";
import { RGBShift } from "./modules/RGBShift";
import Controls from "./ui/Controls";
import "./index.css";

// ---- Pitch utils ----
const NOTES = [
  { name: "C2", midi: 36 }, { name: "D2", midi: 38 }, { name: "E2", midi: 40 }, { name: "F2", midi: 41 }, { name: "G2", midi: 43 }, { name: "A2", midi: 45 }, { name: "B2", midi: 47 },
  { name: "C3", midi: 48 }, { name: "D3", midi: 50 }, { name: "E3", midi: 52 }, { name: "F3", midi: 53 }, { name: "G3", midi: 55 }, { name: "A3", midi: 57 }, { name: "B3", midi: 59 },
  { name: "C4", midi: 60 }, { name: "D4", midi: 62 }, { name: "E4", midi: 64 }, { name: "F4", midi: 65 }, { name: "G4", midi: 67 }, { name: "A4", midi: 69 }, { name: "B4", midi: 71 }
];
const SCALES = {
  pentMinor: [0,3,5,7,10],
  pentMajor: [0,2,4,7,9],
  major:     [0,2,4,5,7,9,11],
  minor:     [0,2,3,5,7,8,10],
  whole:     [0,2,4,6,8,10],
  chromatic: [0,1,2,3,4,5,6,7,8,9,10,11]
};
const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
function quantizeLumaToFreq(luma, baseMidi, octaves, scaleName) {
  const scale = SCALES[scaleName] || SCALES.pentMinor;
  const totalSteps = scale.length * Math.max(1, octaves|0);
  const idx = Math.round((Math.max(0, Math.min(255, luma)) / 255) * totalSteps);
  const octave = Math.min(octaves - 1, Math.floor(idx / scale.length));
  const degree = scale[Math.min(scale.length - 1, idx % scale.length)];
  const midi = baseMidi + octave * 12 + degree;
  return midiToFreq(midi);
}

export default function App() {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const audioRef = useRef(null);
  const beatRef = useRef(null);
  const lastColumnsRef = useRef(null); // para sync-to-beat

  // Visual modules
  const [modules] = useState([RGBShift]);
  const [paramsByModule, setParamsByModule] = useState(() => {
    const init = {}; modules.forEach(m => { init[m.name] = { ...(m.params || {}) }; }); return init;
  });

  // Core (scroll)
  const [coreParams, setCoreParams] = useState({ scrollSpeed: 40 });

  // Audio master
  const [audioOn, setAudioOn] = useState(true);
  const [volume, setVolume] = useState(0.25);
  const [waveform, setWaveform] = useState("sawtooth");
  const [drive, setDrive] = useState(0.2);
  const [filterType, setFilterType] = useState("lowpass");
  const [filterCutoff, setFilterCutoff] = useState(800);
  const [filterQ, setFilterQ] = useState(1.2);
  const [modFilterBy, setModFilterBy] = useState("luma");
  const [headphoneSafe, setHeadphoneSafe] = useState(true);
  const [audioState, setAudioState] = useState("uninitialized");

  // Pitch mapping
  const [pitchMode, setPitchMode] = useState("quantized");
  const [syncToBeat, setSyncToBeat] = useState(true);
  const [baseMidi, setBaseMidi] = useState(45);
  const [octaves, setOctaves] = useState(3);
  const [scaleName, setScaleName] = useState("pentMinor");
  const [baseFreq, setBaseFreq] = useState(90);
  const [freqRange, setFreqRange] = useState(2200);

  // Needles
  const [needleCount, setNeedleCount] = useState(2);
  const [needleFracs, setNeedleFracs] = useState([0.33, 0.66]);

  // Beatbox
  const [bpm, setBpm] = useState(110);
  const [kickVol, setKickVol] = useState(0.9);
  const [snareVol, setSnareVol] = useState(0.5);
  const [hatVol, setHatVol] = useState(0.35);
  const [kickPat, setKickPat] = useState(Array(16).fill(false).map((_,i)=> i===0 || i===8));
  const [snarePat, setSnarePat] = useState(Array(16).fill(false).map((_,i)=> i===4 || i===12));
  const [hatPat, setHatPat] = useState(Array(16).fill(false).map((_,i)=> [2,6,10,14].includes(i)));
  const [beatOn, setBeatOn] = useState(true);

  // Cargar imagen + IDENTIDAD POR IMAGEN
  async function handleFiles(files) {
    const file = files?.[0]; if (!file) return;
    await audioRef.current?.resume();
    setAudioState(audioRef.current?.getState() || "unknown");

    const bmp = await createImageBitmap(file);

    // --- Identidad por imagen (escala/tonalidad/BPM según color medio) ---
    const off = document.createElement('canvas');
    off.width = Math.min(256, bmp.width);
    off.height = Math.min(256, bmp.height);
    const octx = off.getContext('2d');
    octx.drawImage(bmp, 0, 0, off.width, off.height);
    const { data } = octx.getImageData(0, 0, off.width, off.height);
    let sr=0, sg=0, sb=0;
    for (let i=0;i<data.length;i+=4){ sr+=data[i]; sg+=data[i+1]; sb+=data[i+2]; }
    const n = data.length/4;
    const r = sr/n, g=sg/n, b=sb/n;
    const maxc = Math.max(r,g,b), minc = Math.min(r,g,b);
    const v = maxc, s = maxc ? (maxc-minc)/maxc : 0;
    let h = 0;
    if (maxc !== minc) {
      const d = maxc - minc;
      h = maxc===r ? ((g-b)/d)%6 : maxc===g ? ((b-r)/d)+2 : ((r-g)/d)+4;
      h *= 60; if (h<0) h+=360;
    }
    const hue = h;
    const sat = s;
    const val = v/255;

    const modeByHue = (deg) => {
      if (deg<30 || deg>=330) return "minor";
      if (deg<90)  return "pentMajor";
      if (deg<150) return "major";
      if (deg<210) return "whole";
      if (deg<270) return "pentMinor";
      return "minor";
    };
    const baseByVal = (val) => {
      const mids = [36,40,43,45,48,50,52,55,57,60]; // C2..C4-ish
      return mids[Math.floor(val*(mids.length-1))];
    };
    const bpmBySat = (sat) => Math.round(80 + sat*80); // 80..160

    setScaleName(modeByHue(hue));
    setBaseMidi(baseByVal(val));
    setOctaves( sat<0.35 ? 2 : sat<0.7 ? 3 : 4 );
    const targetBpm = bpmBySat(sat);
    setBpm(targetBpm);
    beatRef.current?.setBPM(targetBpm);
    // --- fin identidad por imagen ---

    engineRef.current?.setImageBitmap(bmp);
    engineRef.current?.setNeedleFracs(needleFracs.slice(0, needleCount));
  }

  async function enableAudio() {
    audioRef.current?.ensure();
    await audioRef.current?.resume();
    audioRef.current?.setOn(true);
    audioRef.current?.setMasterVolume(headphoneSafe ? Math.min(volume, 0.3) : volume);
    setAudioOn(true);
    setAudioState(audioRef.current?.getState() || "unknown");
  }

  // Montaje inicial
  useEffect(() => {
    const engine = new Engine(canvasRef.current, {
      modules,
      maxDim: 768,
      stepMs: 80,
      getParams: (name) => (name === "CORE" ? coreParams : (paramsByModule[name] || {})),
      initialNeedleFracs: needleFracs,
      onAfterStep: ({ columns }) => {
        lastColumnsRef.current = columns;

        if (!syncToBeat) {
          const cols = columns || [];
          let freqs;
          if (pitchMode === "quantized") {
            freqs = cols.map(({ luma }) => quantizeLumaToFreq(luma, baseMidi, octaves, scaleName));
          } else {
            freqs = cols.map(({ luma }) => baseFreq + (Math.max(0, Math.min(255, luma)) / 255) * freqRange);
          }
          audioRef.current?.setFrequencies(freqs, 0.08, headphoneSafe);
        }

        // modulación de filtro
        if (columns && columns.length) {
          let cutoff = filterCutoff;
          if (modFilterBy === "luma") {
            const avgL = columns.reduce((a,c)=>a+c.luma,0)/columns.length;
            const factor = 0.5 + 0.5*(avgL/255);
            cutoff = Math.max(100, Math.min(12000, filterCutoff * factor));
          } else if (modFilterBy === "color") {
            const avg = columns.reduce((acc, c)=>({ r:acc.r+c.r, g:acc.g+c.g, b:acc.b+c.b }), {r:0,g:0,b:0});
            avg.r/=columns.length; avg.g/=columns.length; avg.b/=columns.length;
            const maxc = Math.max(avg.r, avg.g, avg.b), minc = Math.min(avg.r, avg.g, avg.b);
            const sat = maxc ? (maxc - minc) / maxc : 0;
            const factor = 0.4 + 0.8*sat;
            cutoff = Math.max(100, Math.min(12000, filterCutoff * factor));
          }
          audioRef.current?.setFilter(filterType, cutoff, filterQ);
        }
      }
    });
    engineRef.current = engine;

    const audio = new AudioEngine();
    audioRef.current = audio;
    audio.setVoices(needleCount);
    audio.setWaveform(waveform);
    audio.setDrive(drive);
    audio.setFilter(filterType, filterCutoff, filterQ);
    audio.setMasterVolume(headphoneSafe ? Math.min(volume, 0.3) : volume);
    audio.setOn(audioOn);
    setAudioState(audio.getState());

    // BeatEngine con probabilidad condicionada por imagen
    const beat = new BeatEngine(audio.ensure(), audio.getExternalInput(), {
      onStep: (stepIdx) => {
        if (!syncToBeat) return;
        const cols = lastColumnsRef.current || [];
        let freqs;
        if (pitchMode === "quantized") {
          freqs = cols.map(({ luma }) => quantizeLumaToFreq(luma, baseMidi, octaves, scaleName));
        } else {
          freqs = cols.map(({ luma }) => baseFreq + (Math.max(0, Math.min(255, luma)) / 255) * freqRange);
        }
        audioRef.current?.setFrequencies(freqs, 0.08, headphoneSafe);
      }
    });
    beatRef.current = beat;
    beat.setBPM(bpm);
    beat.setVolumes({ kick: kickVol, snare: snareVol, hat: hatVol });
    beat.setPattern("kick", kickPat);
    beat.setPattern("snare", snarePat);
    beat.setPattern("hat", hatPat);

    // Probabilidades según brillo/color actuales
    beat.setProbFns({
      kick: (i) => {
        const cols = lastColumnsRef.current || [];
        const avgL = cols.reduce((a,c)=>a+c.luma,0)/Math.max(1,cols.length);
        const low = 1 - (avgL/255);              // más oscuro => más bombo
        const accent = (i % 4 === 0) ? 0.25 : 0; // refuerza los tiempos
        return Math.min(1, 0.2 + 0.6*low + accent);
      },
      snare: (i) => {
        const cols = lastColumnsRef.current || [];
        const mid = cols.length ? Math.abs(cols[0].r - cols[0].b)/255 : 0.5;
        const backbeat = (i % 8 === 4) ? 0.5 : 0.0;
        return Math.min(1, 0.1 + 0.4*mid + backbeat);
      },
      hat: (i) => {
        const cols = lastColumnsRef.current || [];
        let sat=0;
        if (cols.length) {
          const { r,g,b } = cols[0];
          const maxc = Math.max(r,g,b), minc = Math.min(r,g,b);
          sat = maxc ? (maxc-minc)/maxc : 0;
        }
        const grid = (i % 2 === 0) ? 0.25 : 0.05; // semicorcheas base
        return Math.min(1, grid + 0.6*sat);
      }
    });

    if (beatOn) beat.start();

    // liberar autoplay
    const gesture = async () => {
      await audioRef.current?.resume();
      setAudioState(audioRef.current?.getState() || "unknown");
      document.removeEventListener("pointerdown", gesture);
      document.removeEventListener("keydown", gesture);
    };
    document.addEventListener("pointerdown", gesture);
    document.addEventListener("keydown", gesture);

    return () => { engine.stop(); beat.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hot reconfigs
  useEffect(() => { audioRef.current?.setOn(audioOn); }, [audioOn]);
  useEffect(() => { audioRef.current?.setMasterVolume(headphoneSafe ? Math.min(volume, 0.3) : volume); }, [volume, headphoneSafe]);
  useEffect(() => { audioRef.current?.setWaveform(waveform); }, [waveform]);
  useEffect(() => { audioRef.current?.setDrive(drive); }, [drive]);
  useEffect(() => { audioRef.current?.setFilter(filterType, filterCutoff, filterQ); }, [filterType, filterCutoff, filterQ]);

  // Beat configs
  useEffect(() => { beatRef.current?.setBPM(bpm); }, [bpm]);
  useEffect(() => { beatRef.current?.setVolumes({ kick: kickVol, snare: snareVol, hat: hatVol }); }, [kickVol, snareVol, hatVol]);
  useEffect(() => { beatRef.current?.setPattern("kick", kickPat); }, [kickPat]);
  useEffect(() => { beatRef.current?.setPattern("snare", snarePat); }, [snarePat]);
  useEffect(() => { beatRef.current?.setPattern("hat", hatPat); }, [hatPat]);
  useEffect(() => { if (beatOn) beatRef.current?.start(); else beatRef.current?.stop(); }, [beatOn]);

  // Needles
  useEffect(() => {
    audioRef.current?.setVoices(needleCount);
    const fracs = [...needleFracs];
    while (fracs.length < needleCount) fracs.push(0.5);
    if (fracs.length > needleCount) fracs.length = needleCount;
    setNeedleFracs(fracs);
    engineRef.current?.setNeedleFracs(fracs);
  }, [needleCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const setNeedleFrac = (i, frac) => {
    const fr = Math.max(0, Math.min(1, frac));
    const next = needleFracs.map((f, idx) => idx === i ? fr : f);
    setNeedleFracs(next);
    engineRef.current?.setNeedleFracs(next);
  };

  // Helpers para matriz de 16 pasos
  const toggleStep = (track, idx) => {
    const flip = (arr) => arr.map((v,i) => i===idx ? !v : v);
    if (track === "kick") setKickPat(prev => flip(prev));
    if (track === "snare") setSnarePat(prev => flip(prev));
    if (track === "hat") setHatPat(prev => flip(prev));
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>Spectrostatics</h1>
        <p>Image-identity mode/tempo + beat-probabilities + beat-synced pitch.</p>
      </header>

      <div className="uploader">
        <input type="file" accept="image/*" onChange={(e)=>handleFiles(e.target.files)} />
        <button onClick={()=>engineRef.current?.stop()}>Stop</button>
        <button onClick={enableAudio}>Enable audio</button>
        <small style={{marginLeft:8, opacity:.8}}>AudioContext: {audioState}</small>
      </div>

      <main className="layout">
        <div className="stage">
          <canvas ref={canvasRef} className="view"></canvas>
        </div>

        <aside className="sidebar">
          {/* AUDIO MASTER */}
          <section className="panel">
            <h3>Audio — Master</h3>
            <div className="row">
              <label><input type="checkbox" checked={audioOn} onChange={async (e)=>{ if (e.target.checked) await enableAudio(); else setAudioOn(false); }}/> Audio ON</label>
              <label><input type="checkbox" checked={headphoneSafe} onChange={(e)=>setHeadphoneSafe(e.target.checked)}/> Headphone Safe</label>
            </div>
            <div className="row">
              <label>Volume
                <input type="range" min="0" max="1" step="0.01" value={volume} onChange={(e)=>setVolume(Number(e.target.value))}/>
                <code>{(headphoneSafe ? Math.min(volume,0.3) : volume).toFixed(2)}</code>
              </label>
            </div>
            <div className="row">
              <label>Waveform
                <select value={waveform} onChange={(e)=>setWaveform(e.target.value)}>
                  <option value="sine">sine</option>
                  <option value="triangle">triangle</option>
                  <option value="sawtooth">sawtooth</option>
                  <option value="square">square</option>
                </select>
              </label>
            </div>
            <div className="row">
              <label>Drive
                <input type="range" min="0" max="1" step="0.01" value={drive} onChange={(e)=>setDrive(Number(e.target.value))}/>
                <code>{drive.toFixed(2)}</code>
              </label>
            </div>
          </section>

          {/* FILTER */}
          <section className="panel">
            <h3>Filter</h3>
            <div className="row">
              <label>Type
                <select value={filterType} onChange={(e)=>setFilterType(e.target.value)}>
                  <option value="lowpass">lowpass</option>
                  <option value="highpass">highpass</option>
                  <option value="bandpass">bandpass</option>
                </select>
              </label>
            </div>
            <div className="row">
              <label>Cutoff
                <input type="range" min="100" max="12000" step="10" value={filterCutoff} onChange={(e)=>setFilterCutoff(Number(e.target.value))}/>
                <code>{Math.round(filterCutoff)} Hz</code>
              </label>
            </div>
            <div className="row">
              <label>Q
                <input type="range" min="0.1" max="20" step="0.1" value={filterQ} onChange={(e)=>setFilterQ(Number(e.target.value))}/>
                <code>{filterQ.toFixed(1)}</code>
              </label>
            </div>
            <div className="row">
              <label>Mod
                <select value={modFilterBy} onChange={(e)=>setModFilterBy(e.target.value)}>
                  <option value="off">off</option>
                  <option value="luma">by luma</option>
                  <option value="color">by color</option>
                </select>
              </label>
            </div>
          </section>

          {/* PITCH */}
          <section className="panel">
            <h3>Pitch</h3>
            <div className="row">
              <label>Mode
                <select value={pitchMode} onChange={(e)=>setPitchMode(e.target.value)}>
                  <option value="quantized">quantized</option>
                  <option value="continuous">continuous</option>
                </select>
              </label>
              <label><input type="checkbox" checked={syncToBeat} onChange={(e)=>setSyncToBeat(e.target.checked)}/> Sync to beat</label>
            </div>

            {pitchMode === "quantized" ? (
              <>
                <div className="row">
                  <label>Base Note
                    <select value={baseMidi} onChange={(e)=>setBaseMidi(Number(e.target.value))}>
                      {NOTES.map(n => <option key={n.midi} value={n.midi}>{n.name}</option>)}
                    </select>
                  </label>
                </div>
                <div className="row">
                  <label>Octaves
                    <input type="range" min="1" max="5" step="1" value={octaves} onChange={(e)=>setOctaves(Number(e.target.value))}/>
                    <code>{octaves}</code>
                  </label>
                </div>
                <div className="row">
                  <label>Scale
                    <select value={scaleName} onChange={(e)=>setScaleName(e.target.value)}>
                      <option value="pentMinor">minor pentatonic</option>
                      <option value="pentMajor">major pentatonic</option>
                      <option value="major">major</option>
                      <option value="minor">minor</option>
                      <option value="whole">whole tone</option>
                      <option value="chromatic">chromatic</option>
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <>
                <div className="row">
                  <label>Base Freq
                    <input type="range" min="20" max="800" step="1" value={baseFreq} onChange={(e)=>setBaseFreq(Number(e.target.value))}/>
                    <code>{baseFreq} Hz</code>
                  </label>
                </div>
                <div className="row">
                  <label>Range
                    <input type="range" min="100" max="6000" step="10" value={freqRange} onChange={(e)=>setFreqRange(Number(e.target.value))}/>
                    <code>{freqRange} Hz</code>
                  </label>
                </div>
              </>
            )}
          </section>

          {/* BEATBOX */}
          <section className="panel">
            <h3>Beatbox</h3>
            <div className="row">
              <label>BPM
                <input type="range" min="40" max="200" step="1" value={bpm} onChange={(e)=>setBpm(Number(e.target.value))}/>
                <code>{bpm}</code>
              </label>
              <label><input type="checkbox" checked={beatOn} onChange={(e)=>setBeatOn(e.target.checked)}/> On</label>
            </div>

            <div className="row"><label>Kick Vol
              <input type="range" min="0" max="1" step="0.01" value={kickVol} onChange={(e)=>setKickVol(Number(e.target.value))}/>
              <code>{kickVol.toFixed(2)}</code>
            </label></div>
            <div className="row"><label>Snare Vol
              <input type="range" min="0" max="1" step="0.01" value={snareVol} onChange={(e)=>setSnareVol(Number(e.target.value))}/>
              <code>{snareVol.toFixed(2)}</code>
            </label></div>
            <div className="row"><label>Hi-hat Vol
              <input type="range" min="0" max="1" step="0.01" value={hatVol} onChange={(e)=>setHatVol(Number(e.target.value))}/>
              <code>{hatVol.toFixed(2)}</code>
            </label></div>

            <div style={{display:'grid', gridTemplateColumns:'auto repeat(16, 1fr)', gap:'6px', fontSize:12}}>
              <div>Kick</div>
              {kickPat.map((on,i)=>(
                <label key={'k'+i} style={{textAlign:'center'}}>
                  <input type="checkbox" checked={on} onChange={()=>setKickPat(prev => prev.map((v,ix)=> ix===i ? !v : v))} />
                </label>
              ))}
              <div>Snare</div>
              {snarePat.map((on,i)=>(
                <label key={'s'+i} style={{textAlign:'center'}}>
                  <input type="checkbox" checked={on} onChange={()=>setSnarePat(prev => prev.map((v,ix)=> ix===i ? !v : v))} />
                </label>
              ))}
              <div>Hi-hat</div>
              {hatPat.map((on,i)=>(
                <label key={'h'+i} style={{textAlign:'center'}}>
                  <input type="checkbox" checked={on} onChange={()=>setHatPat(prev => prev.map((v,ix)=> ix===i ? !v : v))} />
                </label>
              ))}
            </div>
          </section>

          {/* NEEDLES */}
          <section className="panel">
            <h3>Needles</h3>
            <div className="row">
              <label>Count
                <input type="range" min="1" max="3" step="1" value={needleCount}
                  onChange={(e)=>setNeedleCount(Number(e.target.value))}/>
                <code>{needleCount}</code>
              </label>
            </div>
            {Array.from({length: needleCount}).map((_, i) => (
              <div className="row" key={i}>
                <label>Needle {i+1}
                  <input type="range" min="0" max="1" step="0.001"
                    value={needleFracs[i] ?? 0.5}
                    onChange={(e)=>{
                      const fr = Math.max(0, Math.min(1, Number(e.target.value)));
                      const next = needleFracs.map((f, idx) => idx === i ? fr : f);
                      setNeedleFracs(next);
                      engineRef.current?.setNeedleFracs(next);
                    }}/>
                  <code>{Math.round((needleFracs[i] ?? 0.5)*100)}%</code>
                </label>
              </div>
            ))}
            <small>Arrastra en el canvas para mover la aguja más cercana.</small>
          </section>

          {/* VISUALES */}
          <Controls
            modules={modules}
            paramsByModule={paramsByModule}
            onParamChange={(mod, key, value) =>
              setParamsByModule(prev => ({ ...prev, [mod]: { ...prev[mod], [key]: value } }))
            }
            coreParams={coreParams}
            onCoreChange={(next)=>setCoreParams(next)}
          />
        </aside>
      </main>

      <footer className="footer">
        <small>Spectrostatics — v0.6 • Image-driven identity + probabilistic beats + sync-to-beat.</small>
      </footer>
    </div>
  );
}
