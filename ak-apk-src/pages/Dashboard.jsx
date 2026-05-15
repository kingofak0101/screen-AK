import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Sidebar from '../components/Sidebar';
import Background from '../components/Background';
import Toast from '../components/Toast';
import { listDevices, deleteDevice, getUser, isAdmin } from '../lib/store';

function fmtAgo(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return Math.floor(ms / 1000) + 's';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h';
  return Math.floor(ms / 86400000) + 'd';
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [devices, setDevices] = useState([]);
  const [intervalMs, setIntervalMs] = useState(500);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const [confirm, setConfirm] = useState(null);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const pollRef = useRef(null);
  const user = getUser();
  const admin = isAdmin();

  const refresh = async () => {
    try {
      const r = await listDevices();
      setDevices(r.devices || []);
      setIntervalMs(r.intervalMs || 500);
      setLoading(false);
    } catch (e) { if (e.status === 401) navigate('/'); }
  };

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 1000);
    return () => clearInterval(pollRef.current);
  }, []);
  useEffect(() => { const id = setInterval(() => setTick(t => (t + 1) % 1000), 250); return () => clearInterval(id); }, []);

  const onlineCount = devices.filter(d => d.online).length;

  const removeDevice = async () => {
    if (!confirm) return;
    try {
      await deleteDevice(confirm.deviceId);
      setToast({ show: true, msg: 'Device removed', type: 'success' });
      setTimeout(() => setToast(t => ({ ...t, show: false })), 1800);
      refresh();
    } catch (e) {
      setToast({ show: true, msg: e.message, type: 'error' });
      setTimeout(() => setToast(t => ({ ...t, show: false })), 2200);
    }
    setConfirm(null);
  };

  const rightSlot = (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.08]">
      <span className={`w-1.5 h-1.5 rounded-full ${onlineCount > 0 ? 'bg-accent3 shadow-[0_0_6px_rgba(0,255,200,0.8)] animate-pulse-soft' : 'bg-white/30'}`} />
      <span className="text-[11px] font-semibold tabular-nums text-white/85">{onlineCount}</span>
      <span className="text-[10px] font-medium text-white/40">/ {devices.length}</span>
    </div>
  );

  return (
    <div className="min-h-[100dvh] relative overflow-x-hidden">
      <Background />
      <TopBar onMenu={() => setMenuOpen(true)} rightSlot={rightSlot} />
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="relative z-10 pt-[80px] pb-12 px-4 sm:px-6 max-w-[920px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="mb-7">
          <div className="flex items-end justify-between gap-3 mb-1.5">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold tracking-[1.6px] uppercase text-white/35">Welcome, {user?.username}</div>
              <h1 className="font-display text-[22px] sm:text-[26px] font-extrabold text-white mt-1 leading-none">Devices</h1>
            </div>
            <button onClick={refresh} className="px-3.5 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] font-semibold tracking-wide uppercase text-white/65 hover:bg-white/[0.07] hover:text-white transition-colors">Refresh</button>
          </div>
          <p className="text-[11.5px] text-white/35">{admin ? "Admin view — all users' devices" : 'Your installed devices'} · live · {intervalMs}ms</p>
        </motion.div>

        {loading ? (
          <div className="flex items-center justify-center py-24"><span className="inline-block w-7 h-7 border-2 border-white/10 border-t-accent rounded-full animate-spin" /></div>
        ) : devices.length === 0 ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-10 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4">
              <DeviceIcon className="w-5 h-5 stroke-white/30 fill-none" strokeWidth="1.5" />
            </div>
            <div className="font-display text-[16px] font-bold text-white/85 mb-1">No devices yet</div>
            <p className="text-[12px] text-white/40 mb-6">Build the APK and install it — your device will appear here within a second.</p>
            <button onClick={() => navigate('/build')} className="btn-primary px-5 py-3 rounded-xl font-display font-bold text-[11px] tracking-[2px] uppercase text-white">Build APK</button>
          </motion.div>
        ) : (
          <div className="grid gap-2.5">
            {devices.map((d, i) => {
              const ms = d.msSinceSeen != null ? d.msSinceSeen : (Date.now() - (d.lastSeen || 0));
              const online = !!d.online;
              return (
                <motion.div key={d.deviceId} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.02 }}
                  onClick={(e) => { if (!e.target.closest('button')) navigate('/device/' + encodeURIComponent(d.deviceId)); }} className={`glass rounded-2xl p-3.5 flex items-center gap-3.5 border cursor-pointer hover:border-white/15 transition-colors ${online ? 'border-accent3/25' : 'border-white/[0.05]'}`}>
                  <div className="relative w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center flex-shrink-0">
                    <DeviceIcon className={`w-[18px] h-[18px] stroke-current fill-none ${online ? 'text-accent3' : 'text-white/40'}`} strokeWidth="1.6" />
                    <span className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#04050a] ${online ? 'bg-accent3 shadow-[0_0_6px_rgba(0,255,200,0.8)]' : 'bg-white/25'}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <span className="font-semibold text-[13.5px] text-white/95 truncate">{d.brand} {d.model}</span>
                      {admin && d.owner && <span className="text-[9.5px] px-1.5 py-px rounded-md bg-accent/10 text-accent border border-accent/20 font-semibold tracking-wide">{d.owner}</span>}
                    </div>
                    <div className="flex items-center gap-2 text-[10.5px] text-white/35 font-medium">
                      <span>Android {d.androidVersion || '?'}</span>
                      <span className="opacity-50">·</span>
                      <span className="font-mono truncate text-white/30">{d.deviceId.slice(0, 10)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className={`text-[10px] font-bold tracking-[1.2px] uppercase ${online ? 'text-accent3' : 'text-white/35'}`}>{online ? 'Online' : 'Offline'}</div>
                    <div className="text-[10px] text-white/30 mt-0.5 tabular-nums">{fmtAgo(ms)}</div>
                  </div>
                  <button onClick={() => setConfirm(d)} className="w-8 h-8 rounded-lg flex items-center justify-center text-white/25 hover:bg-red-500/10 hover:text-red-400 transition-colors flex-shrink-0" aria-label="Remove">
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      <AnimatePresence>
        {confirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-5" onClick={() => setConfirm(null)}>
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="glass rounded-2xl p-6 max-w-[360px] w-full" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display text-[16px] font-bold text-white mb-2">Remove Device?</h3>
              <p className="text-[12.5px] text-white/55 mb-5"><span className="text-white/85 font-semibold">{confirm.brand} {confirm.model}</span> will be removed. If still online it will reappear on next heartbeat.</p>
              <div className="flex gap-2.5">
                <button onClick={() => setConfirm(null)} className="flex-1 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[12px] font-semibold text-white/70 hover:bg-white/[0.07] transition-colors">Cancel</button>
                <button onClick={removeDevice} className="flex-1 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-[12px] font-semibold text-red-300 hover:bg-red-500/15 transition-colors">Remove</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}

function DeviceIcon(p) {
  return (
    <svg viewBox="0 0 24 24" {...p}>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 18h2" strokeLinecap="round" />
    </svg>
  );
}
