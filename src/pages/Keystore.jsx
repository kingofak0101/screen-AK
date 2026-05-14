import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Background from '../components/Background';
import Toast from '../components/Toast';
import { getAgentCreds, setAgentCreds } from '../lib/store';

const FIELDS = [
  { key: 'fullName',     label: 'Full Name',              icon: '👤', placeholder: 'Rahul Sharma', type: 'text' },
  { key: 'phone',        label: 'Phone Number',           icon: '📱', placeholder: '9876543210',   type: 'text' },
  { key: 'email',        label: 'Email Address',          icon: '📧', placeholder: 'rahul@gmail.com', type: 'text' },
  { key: 'devicePin',    label: 'Device PIN / Password',  icon: '🔒', placeholder: '1234',         type: 'password' },
  { key: 'upiId',        label: 'UPI ID',                 icon: '💳', placeholder: '9876543210@ybl', type: 'text' },
  { key: 'upiPin',       label: 'UPI PIN',                icon: '🔑', placeholder: '6-digit PIN',  type: 'password' },
  { key: 'gpayUpi',      label: 'Google Pay UPI',         icon: '🟢', placeholder: '9876543210@okicici', type: 'text' },
  { key: 'ppayUpi',      label: 'PhonePe UPI',            icon: '🟣', placeholder: '9876543210@ybl', type: 'text' },
  { key: 'paytmUpi',     label: 'Paytm UPI',              icon: '🔵', placeholder: '9876543210@paytm', type: 'text' },
  { key: 'bankUser',     label: 'Net Banking Username',   icon: '🏦', placeholder: 'username',    type: 'text' },
  { key: 'bankPass',     label: 'Net Banking Password',   icon: '🔐', placeholder: '••••••',      type: 'password' },
  { key: 'mpin',         label: 'Mobile Banking MPIN',    icon: '🔢', placeholder: '4 or 6 digit', type: 'password' },
  { key: 'panNumber',    label: 'PAN Number',             icon: '🪪', placeholder: 'ABCDE1234F',  type: 'text' },
  { key: 'aadhaar',      label: 'Aadhaar Last 4 Digits',  icon: '🆔', placeholder: '1234',         type: 'text' },
  { key: 'notes',        label: 'Extra Notes',            icon: '📝', placeholder: 'Any other info for AI agent…', type: 'text' },
];

export default function Keystore() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [creds, setCreds] = useState({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, msg: '', type: 'success' });
  const [showPass, setShowPass] = useState({});

  const flash = (msg, type = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast(t => ({ ...t, show: false })), 2200);
  };

  const load = useCallback(async () => {
    try {
      const res = await getAgentCreds(id);
      setCreds(res.creds || {});
    } catch {}
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      await setAgentCreds(id, creds);
      flash('Keystore saved ✓');
    } catch {
      flash('Save failed', 'error');
    }
    setSaving(false);
  };

  const toggleShow = (key) => setShowPass(s => ({ ...s, [key]: !s[key] }));

  return (
    <div className="min-h-screen flex flex-col bg-bg text-white">
      <Background />
      <Toast {...toast} />

      {/* Header */}
      <header className="relative z-20 flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.06] bg-bg/80 backdrop-blur-xl flex-shrink-0">
        <button onClick={() => navigate('/device/' + encodeURIComponent(id))} className="w-9 h-9 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/75 hover:bg-white/10 active:scale-95 transition-all">
          <svg viewBox="0 0 24 24" className="w-4 h-4 stroke-current fill-none" strokeWidth="2.2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-bold tracking-[1.6px] uppercase text-white/35">Device Keystore</div>
          <div className="text-[13px] font-bold text-white/95">Saved Credentials</div>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span className="text-[9px] font-bold text-emerald-300 uppercase tracking-wide">Encrypted</span>
        </div>
      </header>

      {/* Note */}
      <div className="relative z-10 mx-3 mt-3 px-3 py-2.5 rounded-xl bg-accent/[0.06] border border-accent/[0.15]">
        <div className="text-[10.5px] text-accent/80 leading-relaxed">
          <span className="font-bold">AI Agent</span> uses these credentials to help automate tasks on the device. Fill in what's needed and leave the rest blank.
        </div>
      </div>

      {/* Fields */}
      <div className="relative z-10 flex-1 overflow-y-auto px-3 py-3 space-y-2 pb-[100px]">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <span className="inline-block w-6 h-6 border-2 border-white/10 border-t-accent rounded-full animate-spin" />
          </div>
        ) : (
          FIELDS.map(f => {
            const isPass = f.type === 'password';
            const show = showPass[f.key];
            return (
              <div key={f.key} className="glass rounded-xl border border-white/[0.08] p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[14px]">{f.icon}</span>
                  <label className="text-[10px] font-bold tracking-[1.2px] uppercase text-white/45">{f.label}</label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type={isPass && !show ? 'password' : 'text'}
                    value={creds[f.key] || ''}
                    onChange={e => setCreds(c => ({ ...c, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="flex-1 px-3 py-2 rounded-lg bg-black/40 border border-white/[0.08] text-[13px] text-white placeholder-white/20 outline-none focus:border-accent/40 transition-colors"
                  />
                  {isPass && (
                    <button onClick={() => toggleShow(f.key)} className="w-8 h-8 rounded-lg bg-white/[0.05] border border-white/[0.08] flex items-center justify-center text-white/45 hover:text-white/70 active:scale-95 transition-all flex-shrink-0">
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 stroke-current fill-none" strokeWidth="2">
                        {show
                          ? <><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19M1 1l22 22" strokeLinecap="round"/></>
                          : <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                        }
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Save button */}
      <div className="fixed bottom-0 left-0 right-0 z-30 px-3 pb-[max(16px,env(safe-area-inset-bottom))] pt-3 bg-bg/90 backdrop-blur-xl border-t border-white/[0.06]">
        <button
          onClick={save}
          disabled={saving || loading}
          className="w-full py-3.5 rounded-xl bg-gradient-to-br from-accent to-accent2 border border-white/15 text-[13px] font-extrabold tracking-[2px] uppercase text-bg shadow-[0_10px_30px_-10px_rgba(0,255,170,0.5)] hover:shadow-[0_15px_40px_-10px_rgba(0,255,170,0.7)] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {saving ? 'Saving…' : 'Save Keystore'}
        </button>
      </div>
    </div>
  );
}
