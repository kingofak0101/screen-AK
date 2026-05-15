import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { login } from '../lib/store';
import Background from '../components/Background';
import Toast from '../components/Toast';

export default function Login() {
  const navigate = useNavigate();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const res = await login(user.trim(), pass);
    if (res.ok) {
      setToast({ show: true, msg: 'Access granted. Welcome.', type: 'success' });
      setTimeout(() => navigate('/dashboard'), 600);
    } else {
      setLoading(false);
      const msg =
        res.reason === 'banned' ? 'Your account is banned.'
        : res.reason === 'expired' ? 'Your subscription has expired.'
        : 'Invalid credentials.';
      setToast({ show: true, msg, type: 'error' });
      setTimeout(() => setToast({ show: false, msg: '', type: 'error' }), 2400);
    }
  };

  return (
    <div className="min-h-[100dvh] relative flex items-center justify-center px-5 py-6 overflow-hidden">
      <Background />
      <motion.div initial={{ opacity: 0, y: 28, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} className="relative z-10 w-full max-w-[420px] glass rounded-3xl p-10 sm:p-11 shadow-[0_2px_4px_rgba(0,0,0,0.4),0_20px_60px_rgba(0,0,0,0.6),0_60px_120px_rgba(0,0,0,0.4)]">
        <div className="text-center mb-9">
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent/[0.08] border border-accent/20 mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-accent3 shadow-[0_0_8px_rgba(0,255,200,1)] animate-pulse-soft" />
            <span className="text-[11px] font-semibold tracking-[2px] uppercase text-accent">Secure</span>
          </motion.div>
          <h1 className="font-display text-[28px] sm:text-[30px] font-extrabold leading-tight tracking-tight gold-text">King of AK</h1>
          <p className="mt-2 text-[13px] text-white/40">Enter your credentials to continue</p>
        </div>
        <div className="h-px bg-gradient-to-r from-transparent via-accent/25 to-transparent mb-8" />
        <form onSubmit={handleSubmit} autoComplete="off">
          <div className="mb-4">
            <label className="label-eyebrow">Username</label>
            <div className="relative">
              <input type="text" value={user} onChange={(e) => setUser(e.target.value)} placeholder="Enter username" required className="input-field pr-10" />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-accent/40 text-sm pointer-events-none">⬡</span>
            </div>
          </div>
          <div className="mb-7">
            <label className="label-eyebrow">Password</label>
            <div className="relative">
              <input type={showPass ? 'text' : 'password'} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="••••••••••" required className="input-field pr-10" />
              <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-accent/40 hover:text-accent/85 transition-colors">{showPass ? '◎' : '◉'}</button>
            </div>
          </div>
          <motion.button whileHover={{ y: -2 }} whileTap={{ y: 0 }} type="submit" disabled={loading} className="btn-primary w-full py-4 rounded-xl font-display font-bold text-[13px] tracking-[2.5px] uppercase text-white animate-shimmer disabled:opacity-70 disabled:cursor-not-allowed relative overflow-hidden transition-shadow duration-200">
            {loading ? (<span className="inline-block w-5 h-5 border-2 border-white/25 border-t-white rounded-full animate-spin" />) : ('Sign In')}
          </motion.button>
        </form>
      </motion.div>
      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}
