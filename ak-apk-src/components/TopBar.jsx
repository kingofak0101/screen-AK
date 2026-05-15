import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

export default function TopBar({ onMenu, leftSlot, rightSlot, brandClickable = true }) {
  const navigate = useNavigate();
  return (
    <motion.header
      initial={{ y: -60, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="fixed top-0 inset-x-0 z-40 h-[56px] bg-[rgba(4,5,10,0.92)] border-b border-white/[0.06] backdrop-blur-2xl flex items-center justify-between px-4 sm:px-5"
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {leftSlot ? leftSlot : (
          <button
            onClick={() => brandClickable && navigate('/dashboard')}
            className="flex items-center gap-2 group"
          >
            <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent2 flex items-center justify-center font-display font-extrabold text-[12px] text-[#04050a] flex-shrink-0">AK</span>
            <span className="font-display font-bold text-[13px] tracking-[1.5px] uppercase text-white/85 truncate">King of AK</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {rightSlot}
        {onMenu && <Hamburger onClick={onMenu} />}
      </div>
    </motion.header>
  );
}

function Hamburger({ onClick }) {
  return (
    <button onClick={onClick} className="w-10 h-10 rounded-xl flex items-center justify-center text-white/70 hover:bg-white/[0.06] hover:text-white transition-colors" aria-label="Menu">
      <svg viewBox="0 0 24 24" className="w-[18px] h-[18px] stroke-current fill-none" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round"/></svg>
    </button>
  );
}
