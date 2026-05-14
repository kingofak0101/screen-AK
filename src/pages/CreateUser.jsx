import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Background from '../components/Background';
import Toast from '../components/Toast';
import { createUser, getUser, refreshMe } from '../lib/store';

export default function CreateUser() {
  const navigate = useNavigate();
  const [me, setMe] = useState(getUser());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [months, setMonths] = useState(1);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const credits = me?.credits || 0;
  const cost = months;
  const canSubmit = !loading && username.trim().length > 0 && password.length >= 4 && credits >= cost;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    try {
      await createUser({ username: username.trim(), password, months });
      const u = await refreshMe(); setMe(u);
      setToast({ show: true, msg: `User "${username}" created.`, type: 'success' });
      setUsername(''); setPassword('');
      setTimeout(() => setToast({ show: false, msg: '', type: 'success' }), 2000);
    } catch (e) {
      setToast({ show: true, msg: e.message || 'Create failed', type: 'error' });
      setTimeout(() => setToast({ show: false, msg: '', type: 'error' }), 2400);
    }
    setLoading(false);
  };

  const leftSlot = (
    <div className="flex items-center gap-3">
      <button onClick={() => navigate('/dashboard')} className="w-10 h-10 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/70 hover:bg-accent/10 hover:border-accent/30 hover:text-accent transition-colors" aria-label="Back">
        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div>
        <div className="text-[10px] font-semibold tracking-[1.8px] uppercase text-white/40 leading-none">Page</div>
        <div className="text-[14px] font-semibold leading-tight mt-0.5">Create User</div>
      </div>
    </div>
  );

  const rightSlot = (
    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent/[0.08] border border-accent/20">
      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-accent fill-none" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9 10l3-3 3 3M9 14l3 3 3-3" strokeLinecap="round"/></svg>
      <span className="text-[12px] font-semibold tracking-wider text-accent">{credits}</span>
      <span className="text-[10px] font-semibold tracking-[1.5px] uppercase text-accent/60">Credits</span>
    </div>
  );

  return (
    <div className="min-h-[100dvh] relative overflow-x-hidden">
      <Background />
      <TopBar leftSlot={leftSlot} rightSlot={rightSlot} />
      <main className="relative z-10 pt-[88px] pb-10 px-5 max-w-[520px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }} className="glass rounded-3xl p-7 sm:p-8">
          <div className="mb-6">
            <h2 className="font-display text-[22px] font-extrabold gold-text">New User</h2>
            <p className="text-[13px] text-white/40 mt-1">1 month subscription costs 1 credit</p>
          </div>
          <div className="h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent mb-7" />
          <form onSubmit={handleSubmit} autoComplete="off">
            <div className="mb-4">
              <label className="label-eyebrow">Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. john_doe" required className="input-field" />
            </div>
            <div className="mb-5">
              <label className="label-eyebrow">Password</label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 4 characters" required minLength={4} className="input-field pr-10" />
                <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-accent/40 hover:text-accent/85 transition-colors">{showPass ? '◎' : '◉'}</button>
              </div>
            </div>
            <div className="mb-6">
              <label className="label-eyebrow">Validity</label>
              <div className="grid grid-cols-3 gap-2.5">
                {[1, 3, 6].map((m) => (
                  <button key={m} type="button" onClick={() => setMonths(m)} className={`py-3 rounded-xl text-[13px] font-semibold tracking-wide border transition-all ${months === m ? 'bg-accent/[0.12] border-accent/40 text-accent' : 'bg-white/[0.035] border-white/[0.08] text-white/55 hover:border-white/20 hover:text-white'}`}>
                    {m} {m === 1 ? 'Month' : 'Months'}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between mb-6 px-4 py-3 rounded-xl bg-white/[0.025] border border-white/[0.06]">
              <div>
                <div className="text-[10px] font-semibold tracking-[1.5px] uppercase text-white/40">Cost</div>
                <div className="font-display text-[20px] font-extrabold text-accent leading-none mt-0.5">{cost} <span className="text-[12px] font-normal tracking-normal text-white/40">credit{cost > 1 ? 's' : ''}</span></div>
              </div>
              <div className="text-right">
                <div className="text-[10px] font-semibold tracking-[1.5px] uppercase text-white/40">After</div>
                <div className={`font-display text-[20px] font-extrabold leading-none mt-0.5 ${credits - cost < 0 ? 'text-red-400' : 'text-accent3'}`}>{credits - cost} <span className="text-[12px] font-normal tracking-normal text-white/40">left</span></div>
              </div>
            </div>
            <motion.button whileHover={canSubmit ? { y: -2 } : {}} whileTap={canSubmit ? { y: 0 } : {}} type="submit" disabled={!canSubmit} className="btn-primary w-full py-4 rounded-xl font-display font-bold text-[13px] tracking-[2.5px] uppercase text-white animate-shimmer disabled:opacity-50 disabled:cursor-not-allowed transition-shadow duration-200">
              {loading ? <span className="inline-block w-5 h-5 border-2 border-white/25 border-t-white rounded-full animate-spin" /> : credits < cost ? 'Insufficient Credits' : 'Create User'}
            </motion.button>
          </form>
        </motion.div>
      </main>
      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}
