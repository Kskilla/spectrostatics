// src/ui/Controls.jsx
// Render dinámico de controles a partir de la definición del módulo.

import React from "react";

export default function Controls({ modules, paramsByModule, onParamChange, coreParams, onCoreChange }) {
  return (
    <div className="controls">
      <section className="panel">
        <h3>Core (timeline)</h3>
        <div className="row">
          <label>Scroll speed (px/s)
            <input type="range" min="0" max="200" step="1"
              value={coreParams.scrollSpeed}
              onChange={(e)=>onCoreChange({ ...coreParams, scrollSpeed: Number(e.target.value) })}/>
            <code>{coreParams.scrollSpeed}</code>
          </label>
        </div>
      </section>

      {modules.map((m) => (
        <section key={m.name} className="panel">
          <h3>{m.name}</h3>
          {(m.controls || []).map((ctl) => {
            const val = paramsByModule[m.name]?.[ctl.param];
            if (ctl.type === "slider") {
              return (
                <div className="row" key={ctl.param}>
                  <label>{ctl.label || ctl.param}
                    <input
                      type="range"
                      min={ctl.min} max={ctl.max} step={ctl.step ?? 1}
                      value={val}
                      onChange={(e)=>onParamChange(m.name, ctl.param, Number(e.target.value))}
                    />
                    <code>{val}</code>
                  </label>
                </div>
              );
            }
            if (ctl.type === "checkbox") {
              return (
                <div className="row" key={ctl.param}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!val}
                      onChange={(e)=>onParamChange(m.name, ctl.param, e.target.checked)}
                    /> {ctl.label || ctl.param}
                  </label>
                </div>
              );
            }
            return null;
          })}
        </section>
      ))}
    </div>
  );
}
