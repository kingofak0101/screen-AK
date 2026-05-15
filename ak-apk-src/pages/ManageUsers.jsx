import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Background from '../components/Background';
import Toast from '../components/Toast';
import { listUsers, deleteUserApi, setUserBannedApi } from '../lib/store';

function pad(n) { return String(n).padStart(2, '0'); }
function statusOf(u) {
  if (u.banned) return 'banned';
  return new Date(u.expiry) - Date.now() <= 0 ? 'expired' : 'active';
}
function timeLeft(expiry) {
  const diff = new Date(expiry) - Date.now();
  if (diff <= 0) return 'Expired';
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  if (d > 0) return `${d}d ${pad(h)}h`;
  const m = Math.floor((diff % 3600000) / 60000);
  return `${pad(h)}h ${pad(m)}m`;
}

export default function ManageUsers() {
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [confirm, setConfirm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });

  const refresh = async () => { try { setUsers(await listUsers()); setLoading(false); } catch (e) { setToast({ show: true, msg: e.message, type: 'error' }); setLoading(false); } };

  useEffect(() => { refresh(); const id = setInterval(refresh, 15000); return () => clearInterval(id); }, []);

  const showToast = (msg, type = 'success') => { setToast({ show: true, msg, type }); setTimeout(() => setToast(t => ({ ...t, show: false })), 2400); };

  const apply = async () => {
    if (!confirm) return;
    const { action, username } = confirm;
    try {
      if (action === 'delete') { await deleteUserApi(username); showToast(`${username} deleted.`); }
      else if (action === 'ban') { await setUserBannedApi(username, true); showToast(`${username} banned.`); }
      else if (action === 'unban') { await setUserBannedApi(username, false); showToast(`${username} unbanned.`); }
    } catch (e) { showToast(e.message, 'error'); }
    setConfirm(null);
    refresh();
  };

  const filtered = users.filter(u => query ? u.username.toLowerCase().includes(query.toLowerCase()) : true).filter(u => filter === 'all' ? true : statusOf(u) === filter);
  const counts = { all: users.length, active: users.filter(u => statusOf(u) === 'active').length, banned: users.filter(u => statusOf(u) === 'banned').length, expired: users.filter(u => statusOf(u) === 'expired').length };

  const leftSlot = (
    <div className="flex items-center gap-3">
      <button onClick={() => navigate('/dashboard')} className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/70 hover:bg-accent/10 hover:border-accent/30 hover:text-accent transition-colors" aria-label="Back">
        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div>
        <div className="text-[10px] font-semibold tracking-[1.8px] uppercase text-white/40 leading-none">Page</div>
        <div className="text-[14px] font-semibold leading-tight mt-0.5">Manage Users</div>
      </div>
    </div>
  );

  const tabs = [{ k: 'all', label: 'All' }, { k: 'active', label: 'Active' }, { k: 'banned', label: 'Banned' }, { k: 'expired', label: 'Expired' }];

  return (
    <div className="min-h-[100dvh] relative overflow-x-hidden">
      <Background />
      <TopBar leftSlot={leftSlot} />
      <main className="relative z-10 pt-[88px] pb-10 px-5 max-w-[860px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-5">
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search users…" className="input-field" />
        </motion.div>
        <div className="flex gap-2 mb-5 overflow-x-auto pb-1 -mx-1 px-1">
          {tabs.map(t => (
            <button key={t.k} onClick={() => setFilter(t.k)} className={`px-4 py-2 rounded-xl text-[12px] font-semibold whitespace-nowrap border transition-all ${filter === t.k ? 'bg-accent/[0.1] border-accent/30 text-accent' : 'bg-white/[0.03] border-white/[0.08] text-white/55 hover:border-white/20'}`}>
              {t.label} <span className="opacity-60">({counts[t.k]})</span>
            </button>
          ))}
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><span className="inline-block w-7 h-7 border-2 border-accent/25 border-t-accent rounded-full animate-spin" /></div>
        ) : filtered.length === 0 ? (
          <div className="glass rounded-3xl p-10 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center mb-4"><svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white/30 fill-none" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" strokeLinecap="round"/></svg></div>
            <div className="font-display text-[16px] font-bold mb-1">No users</div>
            <p className="text-[12px] text-white/40">Try changing the search or filter.</p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {filtered.map(u => {
              const st = statusOf(u);
              return (
                <motion.div key={u.username} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-4 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${st === 'active' ? 'bg-accent3 shadow-[0_0_8px_rgba(0,255,200,0.7)]' : st === 'banned' ? 'bg-red-400' : 'bg-orange-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-semibold text-[14px] truncate">{u.username}</span>
                      {u.isAdmin && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 uppercase tracking-wider">Admin</span>}
                    </div>
                    <div className="text-[11px] text-white/40 flex gap-3">
                      <span>{timeLeft(u.expiry)}</span>
                      <span>·</span>
                      <span>{u.credits} cr</span>
                    </div>
                  </div>
                  {!u.isAdmin && (
                    <div className="flex gap-1.5 flex-shrink-0">
                      <button onClick={() => setConfirm({ action: u.banned ? 'unban' : 'ban', username: u.username })} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${u.banned ? 'bg-accent3/10 border-accent3/30 text-accent3 hover:bg-accent3/15' : 'bg-orange-500/10 border-orange-500/30 text-orange-300 hover:bg-orange-500/15'}`}>
                        {u.banned ? 'Unban' : 'Ban'}
                      </button>
                      <button onClick={() => setConfirm({ action: 'delete', username: u.username })} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/15 transition-colors">Delete</button>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      <AnimatePresence>
        {confirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center px-5" onClick={() => setConfirm(null)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="glass rounded-3xl p-7 max-w-[360px] w-full" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-display text-[18px] font-bold mb-2 capitalize">{confirm.action} user?</h3>
              <p className="text-[13px] text-white/55 mb-5"><b>{confirm.username}</b> will be {confirm.action === 'delete' ? 'permanently deleted' : confirm.action + 'ned'}.</p>
              <div className="flex gap-2.5">
                <button onClick={() => setConfirm(null)} className="flex-1 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-[13px] text-white/70 hover:bg-white/[0.07] transition-colors">Cancel</button>
                <button onClick={apply} className={`flex-1 py-3 rounded-xl text-[13px] transition-colors ${confirm.action === 'delete' ? 'bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/15' : 'bg-accent/10 border border-accent/30 text-accent hover:bg-accent/15'}`}>Confirm</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}
