import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import Background from '../components/Background';
import Toast from '../components/Toast';
import {
  getDevice,
  getInbox,
  markInboxRead,
  deleteInboxMessage,
  clearInbox,
} from '../lib/store';

const FILTERS = [
  { id: 'all',    label: 'All'    },
  { id: 'unread', label: 'Unread' },
];

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === yest.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return time;
  if (isYest) return 'Yesterday ' + time;
  return d.toLocaleDateString([], { day: '2-digit', month: 'short' }) + ' ' + time;
}

export default function Inbox() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [messages, setMessages] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [openId, setOpenId] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const aliveRef = useRef(true);

  const flash = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 900);
  };

  const fetchDetail = useCallback(async () => {
    try { const d = await getDevice(id); if (aliveRef.current) setDevice(d); }
    catch (e) { if (e.status === 401) navigate('/'); else if (e.status === 404) navigate('/dashboard'); }
  }, [id, navigate]);

  const fetchInbox = useCallback(async () => {
    try {
      const r = await getInbox(id);
      if (!aliveRef.current) return;
      // newest first
      const list = (r.messages || []).slice().sort((a, b) => b.ts - a.ts);
      setMessages(list);
      setUnread(r.unread || 0);
      setLoading(false);
    } catch (e) {
      if (e.status === 401) navigate('/');
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    aliveRef.current = true;
    fetchDetail();
    fetchInbox();
    const t1 = setInterval(fetchDetail, 5000);
    const t2 = setInterval(fetchInbox, 2500);
    return () => { aliveRef.current = false; clearInterval(t1); clearInterval(t2); };
  }, [fetchDetail, fetchInbox]);

  const open = async (m) => {
    setOpenId(prev => prev === m.id ? null : m.id);
    if (!m.read) {
      try {
        await markInboxRead(id, [m.id]);
        setMessages(prev => prev.map(x => x.id === m.id ? { ...x, read: true } : x));
        setUnread(u => Math.max(0, u - 1));
      } catch {}
    }
  };

  const removeOne = async (m, ev) => {
    ev?.stopPropagation?.();
    try {
      await deleteInboxMessage(id, m.id);
      setMessages(prev => prev.filter(x => x.id !== m.id));
      if (!m.read) setUnread(u => Math.max(0, u - 1));
      flash('Deleted');
    } catch { flash('Delete failed', 'error'); }
  };

  const markAll = async () => {
    try {
      const r = await markInboxRead(id, null);
      setMessages(prev => prev.map(x => ({ ...x, read: true })));
      setUnread(0);
      flash(r.updated ? `${r.updated} marked read` : 'Already read');
    } catch { flash('Failed', 'error'); }
  };

  const wipe = async () => {
    setConfirmClear(false);
    try {
      await clearInbox(id);
      setMessages([]); setUnread(0);
      flash('Inbox cleared');
    } catch { flash('Clear failed', 'error'); }
  };

  const visible = filter === 'unread' ? messages.filter(m => !m.read) : messages;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-bg">
      <Background />

      {/* Header */}
      <header className="relative z-30 flex items-center justify-between gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-bg/80 backdrop-blur-xl">
        <button
          onClick={() => navigate('/device/' + encodeURIComponent(id))}
          className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 hover:bg-white/10 active:scale-95 transition-all flex-shrink-0"
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="flex-1 min-w-0 text-center">
          <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35 leading-none">Inbox</div>
          <div className="text-[12.5px] font-bold text-white/95 leading-tight mt-0.5 truncate">{device?.brand || '—'} {device?.model || ''}</div>
        </div>
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[9.5px] font-bold tracking-wide uppercase flex-shrink-0 ${unread > 0 ? 'bg-amber-500/10 border-amber-500/30 text-amber-300' : 'bg-white/[0.04] border-white/[0.08] text-white/45'}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${unread > 0 ? 'bg-amber-400 animate-pulse-soft' : 'bg-white/30'}`} />
          {unread > 0 ? `${unread} new` : `${messages.length} total`}
        </div>
      </header>

      {/* Toolbar */}
      <div className="relative z-10 flex items-center gap-1.5 px-3 py-2 border-b border-white/[0.04] bg-bg/40">
        <div className="flex items-center gap-1 flex-shrink-0">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-2.5 py-1.5 rounded-lg border text-[10px] font-bold tracking-[1.2px] uppercase transition-all active:scale-95 ${filter === f.id ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-white/55 hover:bg-white/[0.08] hover:text-white/85'}`}
            >
              {f.label}{f.id === 'unread' && unread > 0 ? ` · ${unread}` : ''}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={markAll}
          disabled={!unread}
          className="px-2.5 py-1.5 rounded-lg border text-[10px] font-bold tracking-[1.2px] uppercase transition-all active:scale-95 bg-white/[0.04] border-white/[0.08] text-white/65 hover:bg-white/[0.08] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Mark Read
        </button>
        <button
          onClick={() => setConfirmClear(true)}
          disabled={!messages.length}
          className="px-2.5 py-1.5 rounded-lg border text-[10px] font-bold tracking-[1.2px] uppercase transition-all active:scale-95 bg-white/[0.04] border-rose-400/20 text-rose-200/80 hover:bg-rose-400/10 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Clear
        </button>
      </div>

      {/* List */}
      <main className="relative z-10 flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <span className="inline-block w-7 h-7 border-2 border-white/10 border-t-accent rounded-full animate-spin" />
          </div>
        ) : visible.length === 0 ? (
          <EmptyState filter={filter} hasAny={messages.length > 0} />
        ) : (
          <ul className="divide-y divide-white/[0.04]">
            <AnimatePresence initial={false}>
              {visible.map(m => (
                <motion.li
                  key={m.id}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 30 }}
                  transition={{ duration: 0.18 }}
                >
                  <button
                    onClick={() => open(m)}
                    className={`w-full text-left px-3 py-3 flex items-start gap-3 hover:bg-white/[0.03] active:bg-white/[0.05] transition-colors ${!m.read ? 'bg-emerald-400/[0.025]' : ''}`}
                  >
                    <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-emerald-400/20 to-cyan-400/10 border border-white/[0.08] flex items-center justify-center text-[11px] font-extrabold text-white/85 flex-shrink-0 uppercase">
                      {(m.from || '?').replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?'}
                      {!m.read && (
                        <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-bg" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className={`text-[12.5px] truncate ${!m.read ? 'font-extrabold text-white' : 'font-bold text-white/85'}`}>{m.from || 'Unknown'}</div>
                        <div className="ml-auto text-[10px] text-white/40 font-medium tracking-wide flex-shrink-0">{fmtTime(m.ts)}</div>
                      </div>
                      <div className={`text-[12px] mt-0.5 ${openId === m.id ? 'text-white/85 whitespace-pre-wrap break-words' : 'text-white/55 line-clamp-2'}`}>
                        {m.body || <span className="italic text-white/30">(empty message)</span>}
                      </div>
                      {openId === m.id && (
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={(e) => removeOne(m, e)}
                            className="px-2 py-1 rounded-md bg-rose-500/10 border border-rose-400/30 text-[9.5px] font-bold tracking-[1.2px] uppercase text-rose-200 hover:bg-rose-500/20 active:scale-95 transition-all"
                          >
                            Delete
                          </button>
                          <span className="text-[9.5px] text-white/30 tracking-wide">id: {m.id}</span>
                        </div>
                      )}
                    </div>
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </main>

      {/* Confirm clear modal */}
      <AnimatePresence>
        {confirmClear && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setConfirmClear(false)}
            className="fixed inset-0 z-[60] bg-black/65 backdrop-blur-[3px] flex items-center justify-center p-4"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.94, y: 8 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[340px] glass rounded-2xl border border-white/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35 leading-none">Clear Inbox</div>
                <div className="text-[13px] font-bold text-white/95 mt-0.5">Delete all {messages.length} messages?</div>
              </div>
              <div className="p-4 flex items-center gap-2">
                <button onClick={() => setConfirmClear(false)} className="flex-1 py-2.5 rounded-lg bg-white/[0.04] border border-white/[0.08] text-[11px] font-bold tracking-[1.2px] uppercase text-white/65 hover:bg-white/[0.08] active:scale-95 transition-all">Cancel</button>
                <button onClick={wipe} className="flex-1 py-2.5 rounded-lg bg-gradient-to-br from-rose-500 to-rose-600 border border-rose-400/40 text-[11px] font-extrabold tracking-[1.4px] uppercase text-white shadow-[0_8px_24px_-8px_rgba(244,63,94,0.6)] hover:from-rose-400 hover:to-rose-500 active:scale-95 transition-all">Clear All</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}

function EmptyState({ filter, hasAny }) {
  return (
    <div className="h-full flex flex-col items-center justify-center px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/35 mb-4">
        <svg viewBox="0 0 24 24" className="w-7 h-7 stroke-current fill-none" strokeWidth="1.6">
          <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round"/>
          <rect x="3" y="5" width="18" height="14" rx="2"/>
        </svg>
      </div>
      <div className="text-[14px] font-bold text-white/85">
        {filter === 'unread' && hasAny ? 'No unread messages' : 'Inbox is empty'}
      </div>
      <div className="text-[11.5px] text-white/45 mt-1.5 max-w-[280px] leading-relaxed">
        {filter === 'unread' && hasAny
          ? 'All caught up. Switch to “All” to see read messages.'
          : 'Incoming SMS from the device will appear here. Updates every few seconds.'}
      </div>
    </div>
  );
}
