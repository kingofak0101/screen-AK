import { useEffect, useRef, useState } from 'react';
import { sendCommand } from '../lib/store';

const TIMEOUT_STEPS = [
  { ms: 15000,   label: '15s' },
  { ms: 30000,   label: '30s' },
  { ms: 60000,   label: '1m'  },
  { ms: 120000,  label: '2m'  },
  { ms: 300000,  label: '5m'  },
  { ms: 600000,  label: '10m' },
  { ms: 1800000, label: '30m' },
];

function nearestTimeoutIdx(ms) {
  if (ms == null) return -1;
  let best = 0, bestDiff = Infinity;
  for (let i = 0; i < TIMEOUT_STEPS.length; i++) {
    const d = Math.abs(TIMEOUT_STEPS[i].ms - ms);
    if (d < bestDiff) { bestDiff = d; best = i; }
  }
  return best;
}

export function VolumeSlider({ id, device, disabled }) {
  const trackRef = useRef(null);
  const [drag, setDrag] = useState(null);   // % during drag (overrides device value)
  const [pending, setPending] = useState(null);
  const lastSentRef = useRef({ pct: -1, t: 0 });
  const value = drag != null ? drag : (pending != null ? pending : (device?.volumePct ?? 0));

  // Clear pending once device echoes the new value
  useEffect(() => {
    if (pending == null) return;
    if (device?.volumePct != null && Math.abs(device.volumePct - pending) < 5) setPending(null);
  }, [device?.volumePct, pending]);

  const sendThrottled = (pct) => {
    const now = Date.now();
    if (Math.abs(pct - lastSentRef.current.pct) < 5 && now - lastSentRef.current.t < 200) return;
    lastSentRef.current = { pct, t: now };
    sendCommand(id, 'set_volume', { pct }).catch(() => {});
  };

  const pctFromEvent = (e) => {
    const r = trackRef.current.getBoundingClientRect();
    const y = (e.touches?.[0]?.clientY ?? e.clientY) - r.top;
    const inv = 1 - Math.max(0, Math.min(1, y / r.height));
    return Math.round(inv * 100);
  };

  const onDown = (e) => {
    if (disabled) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const p = pctFromEvent(e);
    setDrag(p);
    sendThrottled(p);
  };
  const onMove = (e) => {
    if (disabled || drag == null) return;
    e.preventDefault();
    const p = pctFromEvent(e);
    setDrag(p);
    sendThrottled(p);
  };
  const onUp = (e) => {
    if (disabled || drag == null) return;
    e.preventDefault();
    const p = pctFromEvent(e);
    setDrag(null);
    setPending(p);
    sendCommand(id, 'set_volume', { pct: p }).catch(() => {});
    lastSentRef.current = { pct: p, t: Date.now() };
  };

  const muted = value === 0;
  const high  = value >= 70;

  return (
    <div className="h-full w-full flex flex-col items-center gap-1.5 select-none">
      <div className="text-[8px] font-bold tracking-[1px] uppercase text-white/55">Vol</div>
      <div className="text-[10px] font-extrabold tabular-nums text-white/90">{value}%</div>
      <div
        ref={trackRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
        className={"relative flex-1 w-5 rounded-full overflow-hidden border " + (disabled ? "border-white/[0.04] bg-white/[0.02] cursor-not-allowed" : "border-white/[0.08] bg-white/[0.04] cursor-pointer")}
        style={{ touchAction: 'none' }}
      >
        <div
          className={"absolute bottom-0 left-0 right-0 transition-[height] duration-75 " + (muted ? "bg-white/15" : high ? "bg-gradient-to-t from-rose-400 via-amber-300 to-emerald-300" : "bg-gradient-to-t from-accent2 to-accent")}
          style={{ height: value + '%' }}
        />
        {/* Tick marks */}
        {[25, 50, 75].map(t => (
          <div key={t} className="absolute left-0 right-0 h-px bg-white/10 pointer-events-none" style={{ bottom: t + '%' }} />
        ))}
        {/* Knob */}
        <div className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow-[0_2px_6px_rgba(0,0,0,0.4)] border border-white/40 pointer-events-none" style={{ bottom: 'calc(' + value + '% - 6px)' }} />
      </div>
      <div className="flex flex-col gap-1 w-full items-center">
        <button disabled={disabled} onClick={() => sendCommand(id, 'volume_step', { dir: +1 }).catch(()=>{})}
          className="w-5 h-5 rounded-md bg-white/[0.06] border border-white/[0.08] text-white/85 text-[11px] font-bold leading-none flex items-center justify-center hover:bg-white/10 active:scale-90 transition-all disabled:opacity-30">+</button>
        <button disabled={disabled} onClick={() => sendCommand(id, 'volume_step', { dir: -1 }).catch(()=>{})}
          className="w-5 h-5 rounded-md bg-white/[0.06] border border-white/[0.08] text-white/85 text-[11px] font-bold leading-none flex items-center justify-center hover:bg-white/10 active:scale-90 transition-all disabled:opacity-30">−</button>
      </div>
    </div>
  );
}

export function TimeoutSlider({ id, device, disabled }) {
  const [pending, setPending] = useState(null);
  const activeMs = pending != null ? pending : (device?.screenTimeoutMs ?? null);
  const activeIdx = nearestTimeoutIdx(activeMs);

  useEffect(() => {
    if (pending == null) return;
    if (device?.screenTimeoutMs != null && Math.abs(device.screenTimeoutMs - pending) < 1000) setPending(null);
  }, [device?.screenTimeoutMs, pending]);

  const set = (ms) => {
    if (disabled) return;
    setPending(ms);
    sendCommand(id, 'set_screen_timeout', { ms }).catch(() => {});
  };

  const writeOK = device?.perm_write_settings === true;

  return (
    <div className="h-full w-full flex flex-col items-center gap-1.5 select-none">
      <div className="text-[8px] font-bold tracking-[1px] uppercase text-white/55">Idle</div>
      <div className="text-[10px] font-extrabold tabular-nums text-white/90">{activeIdx >= 0 ? TIMEOUT_STEPS[activeIdx].label : '—'}</div>
      <div className="flex-1 w-full flex flex-col justify-between gap-0.5 py-0.5">
        {TIMEOUT_STEPS.slice().reverse().map((s, ri) => {
          const i = TIMEOUT_STEPS.length - 1 - ri;
          const active = i === activeIdx;
          return (
            <button
              key={s.ms}
              disabled={disabled || !writeOK}
              onClick={() => set(s.ms)}
              className={"w-full text-[8.5px] font-bold tabular-nums leading-none py-1 rounded-md border transition-all " +
                (active
                  ? "bg-accent text-bg border-accent shadow-[0_0_12px_-2px_rgba(0,255,170,0.6)]"
                  : "bg-white/[0.04] text-white/75 border-white/[0.08] hover:bg-white/[0.09] hover:text-white") +
                ((disabled || !writeOK) ? " opacity-40 cursor-not-allowed" : " active:scale-95")}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      {!writeOK && (
        <div className="text-[7.5px] text-amber-300/80 text-center leading-tight px-0.5">Need<br/>WRITE</div>
      )}
    </div>
  );
}
