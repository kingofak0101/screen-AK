import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar';
import Background from '../components/Background';
import Toast from '../components/Toast';
import { startBuild, buildStatus } from '../lib/store';

const MAX_NAME = 30;
const MAX_ICON_BYTES = 8 * 1024 * 1024;
const ICON_ACCEPT = 'image/png,image/jpeg,image/jpg,image/webp,image/gif,image/bmp,image/heic,image/heif,image/*';

export default function Build() {
  const navigate = useNavigate();
  const [appName, setAppName] = useState('OfferSprint');
  const [webviewUrl, setWebviewUrl] = useState('https://offersprint.in');
  const [iconFile, setIconFile] = useState(null);
  const [iconPreview, setIconPreview] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [building, setBuilding] = useState(false);
  const [status, setStatus] = useState(null);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const fileRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (iconPreview) URL.revokeObjectURL(iconPreview);
  }, []); // eslint-disable-line

  const flash = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2200);
  };

  const handleIcon = (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { flash('Please choose an image file', 'error'); return; }
    if (file.size > MAX_ICON_BYTES) { flash('Icon too large (max 8MB)', 'error'); return; }
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  };

  const clearIcon = () => {
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconFile(null); setIconPreview('');
    if (fileRef.current) fileRef.current.value = '';
  };

  const onBuild = async () => {
    const name = appName.trim();
    if (!name) { flash('App name is required', 'error'); return; }
    const url = webviewUrl.trim();
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
      flash('WebView URL must start with http:// or https://', 'error');
      return;
    }
    setBuilding(true);
    setStatus({ status: 'building', startedAt: Date.now() });
    try {
      const fd = new FormData();
      fd.append('appName', name);
      if (url) fd.append('webviewUrl', url);
      if (iconFile) fd.append('icon', iconFile);
      const res = await startBuild(fd);
      const id = res.buildId;
      pollRef.current = setInterval(async () => {
        try {
          const s = await buildStatus(id);
          setStatus(s);
          if (s.status === 'ready' || s.status === 'error') {
            clearInterval(pollRef.current);
            setBuilding(false);
          }
        } catch (e) {
          clearInterval(pollRef.current);
          setBuilding(false);
          setStatus({ status: 'error', error: e.message });
        }
      }, 600);
    } catch (e) {
      setBuilding(false);
      setStatus({ status: 'error', error: e.message });
      flash(e.message, 'error');
    }
  };

  const leftSlot = (
    <div className="flex items-center gap-3 min-w-0">
      <button onClick={() => navigate('/dashboard')} className="w-9 h-9 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center text-white/70 hover:bg-white/[0.07] hover:text-white transition-colors flex-shrink-0" aria-label="Back">
        <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className="min-w-0">
        <div className="text-[9.5px] font-semibold tracking-[1.6px] uppercase text-white/35 leading-none">Page</div>
        <div className="text-[13px] font-bold text-white/95 leading-tight mt-0.5 truncate">Build APK</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-[100dvh] relative overflow-x-hidden">
      <Background />
      <TopBar leftSlot={leftSlot} />

      <main className="relative z-10 pt-[80px] pb-12 px-4 sm:px-6 max-w-[560px] mx-auto">
        <motion.div initial={{ opacity: 0, y: 12, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="glass rounded-2xl p-6 sm:p-7">

          <div className="mb-6">
            <h2 className="font-display text-[22px] font-extrabold text-white leading-tight">Generate APK</h2>
            <p className="text-[12.5px] text-white/45 mt-1.5 leading-relaxed">Customise the app name and launcher icon. The build is bound to your account automatically.</p>
          </div>

          {/* Live preview tile */}
          <div className="mb-6 p-4 rounded-2xl bg-gradient-to-br from-white/[0.05] to-white/[0.015] border border-white/[0.08] flex items-center gap-4">
            <div className="relative w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 bg-white/[0.06] border border-white/10 flex items-center justify-center">
              {iconPreview ? (
                <img src={iconPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <svg viewBox="0 0 48 48" className="w-9 h-9"><rect x="4" y="4" width="40" height="40" rx="9" fill="#7C5CFF"/><path d="M16 14h6l5 14h-4l-1.2-3.6h-6L16.6 28H12.6zM18.4 21l-1 3h4l-1-3z M30 14h4v14h-4z" fill="#fff"/></svg>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold tracking-[1.6px] uppercase text-white/35 leading-none">Live Preview</div>
              <div className="text-[16px] font-bold text-white/95 truncate mt-1.5">{appName.trim() || 'OfferSprint'}</div>
              <div className="text-[10.5px] text-white/35 mt-0.5 truncate">{(() => { try { return webviewUrl ? new URL(webviewUrl).host : 'Launcher tile'; } catch { return 'Launcher tile'; } })()}</div>
            </div>
          </div>

          {/* App name */}
          <div className="mb-5">
            <label className="block text-[10px] font-bold tracking-[1.8px] uppercase text-white/45 mb-2">App Name</label>
            <div className="relative">
              <input
                type="text"
                value={appName}
                onChange={e => setAppName(e.target.value.slice(0, MAX_NAME))}
                placeholder="OfferSprint"
                maxLength={MAX_NAME}
                className="w-full px-3.5 py-3 rounded-xl bg-white/[0.025] border border-white/[0.08] text-[14px] text-white placeholder-white/25 focus:outline-none focus:border-accent/60 focus:bg-white/[0.04] transition-colors font-medium"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] tabular-nums text-white/30 pointer-events-none">{appName.length}/{MAX_NAME}</span>
            </div>
          </div>

          {/* WebView URL */}
          <div className="mb-5">
            <label className="block text-[10px] font-bold tracking-[1.8px] uppercase text-white/45 mb-2">WebView URL</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none">
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="1.7"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" strokeLinecap="round"/></svg>
              </span>
              <input
                type="url"
                value={webviewUrl}
                onChange={e => setWebviewUrl(e.target.value)}
                placeholder="https://example.com"
                inputMode="url"
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className="w-full pl-10 pr-3.5 py-3 rounded-xl bg-white/[0.025] border border-white/[0.08] text-[13px] text-white placeholder-white/25 focus:outline-none focus:border-accent/60 focus:bg-white/[0.04] transition-colors font-medium tracking-tight"
              />
            </div>
            <div className="text-[10.5px] text-white/35 mt-1.5 leading-relaxed">App opens this page on launch. Leave default for OfferSprint.</div>
          </div>

          {/* App icon */}
          <div className="mb-6">
            <label className="block text-[10px] font-bold tracking-[1.8px] uppercase text-white/45 mb-2">App Icon</label>
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleIcon(e.dataTransfer.files?.[0]); }}
              onClick={() => fileRef.current?.click()}
              className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-colors p-4 ${
                dragOver ? 'border-accent/70 bg-accent/[0.06]' : iconPreview ? 'border-white/10 bg-white/[0.025]' : 'border-white/[0.12] bg-white/[0.015] hover:border-white/25 hover:bg-white/[0.03]'
              }`}
            >
              <input ref={fileRef} type="file" accept={ICON_ACCEPT} onChange={e => handleIcon(e.target.files?.[0])} className="hidden" />
              {iconPreview ? (
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-white/[0.06] border border-white/10">
                    <img src={iconPreview} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] text-white/90 truncate font-medium">{iconFile?.name}</div>
                    <div className="text-[10.5px] text-white/40 mt-0.5">{(iconFile?.size / 1024).toFixed(1)} KB · click to replace</div>
                  </div>
                  <button onClick={e => { e.stopPropagation(); clearIcon(); }} className="text-[10px] font-bold tracking-wide uppercase px-2.5 py-1.5 rounded-lg bg-rose-500/10 text-rose-300 hover:bg-rose-500/20 transition-colors flex-shrink-0">Remove</button>
                </div>
              ) : (
                <div className="flex items-center gap-3 text-white/60">
                  <div className="w-14 h-14 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-current fill-none" strokeWidth="1.7"><path d="M12 16V4M12 4l-4 4M12 4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <div>
                    <div className="text-[12.5px] font-semibold text-white/85">Drop icon here, or tap to choose</div>
                    <div className="text-[10.5px] text-white/40 mt-0.5">PNG, JPG, WebP, GIF — any image up to 8 MB</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <motion.button whileHover={!building ? { y: -1 } : {}} whileTap={!building ? { y: 0 } : {}} onClick={onBuild} disabled={building || !appName.trim()} className="btn-primary w-full py-3.5 rounded-xl font-display font-bold text-[12px] tracking-[2.5px] uppercase text-white animate-shimmer disabled:opacity-50 disabled:cursor-not-allowed transition-shadow duration-200">
            {building ? (<span className="inline-flex items-center gap-2"><span className="inline-block w-3.5 h-3.5 border-2 border-white/25 border-t-white rounded-full animate-spin" /> Building</span>) : 'Build APK'}
          </motion.button>

          <AnimatePresence>
            {status && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 p-4 rounded-xl border bg-white/[0.025] border-white/[0.07]">
                {status.status === 'building' && (
                  <div className="flex items-center gap-2.5 text-[12px] text-white/70">
                    <span className="inline-block w-3 h-3 border-2 border-accent/25 border-t-accent rounded-full animate-spin" /> Compiling APK…
                  </div>
                )}
                {status.status === 'ready' && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-4 h-4 rounded-full bg-accent3/15 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 stroke-accent3 fill-none" strokeWidth="3"><path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      <span className="text-[11.5px] font-bold tracking-wide uppercase text-accent3">APK Ready</span>
                    </div>
                    <a href={status.downloadUrl} download className="block w-full text-center py-3 rounded-xl bg-accent3/10 border border-accent3/30 text-accent3 font-display font-bold text-[11px] tracking-[2px] uppercase hover:bg-accent3/15 transition-colors">Download APK</a>
                  </div>
                )}
                {status.status === 'error' && (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="w-4 h-4 rounded-full bg-red-500/15 flex items-center justify-center">
                        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 stroke-red-400 fill-none" strokeWidth="3"><path d="M6 6l12 12M6 18L18 6" strokeLinecap="round"/></svg>
                      </span>
                      <span className="text-[11.5px] font-bold tracking-wide uppercase text-red-400">Build Failed</span>
                    </div>
                    <div className="text-[11px] text-white/55 break-all font-mono mt-1.5">{status.error}</div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>
      <Toast show={toast.show} message={toast.msg} type={toast.type} />
    </div>
  );
}
