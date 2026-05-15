import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useLocation } from 'react-router-dom';
import { logout, isAdmin } from '../lib/store';

const NAV = [
  { to: '/dashboard',    label: 'Dashboard',    icon: GridIcon,   adminOnly: false },
  { to: '/build',        label: 'Build',        icon: HammerIcon, adminOnly: false },
  { to: '/create-user',  label: 'Create User',  icon: UserPlusIcon, adminOnly: true },
  { to: '/manage-users', label: 'Manage Users', icon: UsersIcon,    adminOnly: true }
];

export default function Sidebar({ open, onClose }) {
  const navigate = useNavigate();
  const loc = useLocation();
  const admin = isAdmin();
  const items = NAV.filter(n => admin || !n.adminOnly);
  const go = (to) => { onClose(); setTimeout(() => navigate(to), 50); };
  const doLogout = async () => { await logout(); navigate('/'); };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
          <motion.aside initial={{ x: 280 }} animate={{ x: 0 }} exit={{ x: 280 }} transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }} className="fixed top-0 right-0 bottom-0 w-[280px] z-50 bg-[rgba(6,7,14,0.98)] border-l border-[rgba(0,194,255,0.12)] backdrop-blur-3xl flex flex-col">
            <div className="h-[60px] px-4 flex items-center justify-between border-b border-[rgba(0,194,255,0.12)]">
              <span className="text-[11px] font-semibold tracking-[2px] uppercase text-white/40">Navigation</span>
              <button onClick={onClose} className="w-9 h-9 rounded-lg flex items-center justify-center text-white/40 hover:bg-white/[0.06] hover:text-white transition-colors" aria-label="Close">
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
              </button>
            </div>
            <nav className="px-3 py-4 flex-1 overflow-y-auto">
              {items.map(({ to, label, icon: Icon }) => {
                const active = loc.pathname === to;
                return (
                  <button key={to} onClick={() => go(to)} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-[14px] font-medium mb-1 border transition-all ${active ? 'bg-accent/[0.09] border-accent/[0.22] text-accent' : 'border-transparent text-white/40 hover:bg-accent/[0.06] hover:border-accent/[0.12] hover:text-white'}`}>
                    <Icon className="w-4 h-4 stroke-current fill-none flex-shrink-0" strokeWidth="2" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="px-3 py-4 border-t border-[rgba(0,194,255,0.12)]">
              <button onClick={doLogout} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl text-[14px] font-medium text-red-400/60 border border-transparent hover:bg-red-500/[0.06] hover:border-red-500/15 hover:text-red-400 transition-all">
                <LogoutIcon className="w-4 h-4 stroke-current fill-none flex-shrink-0" strokeWidth="2" />
                <span>Logout</span>
              </button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function GridIcon(p)     { return <svg viewBox="0 0 24 24" {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>; }
function HammerIcon(p)   { return <svg viewBox="0 0 24 24" {...p}><path d="M14.5 4l5.5 5.5-3 3-5.5-5.5 3-3z" strokeLinejoin="round"/><path d="M11.5 7L4 14.5v3.5h3.5L15 10.5" strokeLinejoin="round"/></svg>; }
function UserPlusIcon(p) { return <svg viewBox="0 0 24 24" {...p}><circle cx="9" cy="8" r="4"/><path d="M1 21c0-4.4 3.6-8 8-8" strokeLinecap="round"/><path d="M19 12v6M16 15h6" strokeLinecap="round"/></svg>; }
function UsersIcon(p)    { return <svg viewBox="0 0 24 24" {...p}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" strokeLinecap="round" strokeLinejoin="round"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
function LogoutIcon(p)   { return <svg viewBox="0 0 24 24" {...p}><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/></svg>; }
