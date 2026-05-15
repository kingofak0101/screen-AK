/* ── i18n.js — Full multi-language support (EN / ZH / JA) ── */
(function(){
'use strict';

const LANGS = {
  en: {
    /* ── Login page ── */
    'login.username':    'Username',
    'login.password':    'Password',
    'login.placeholder.user': 'Enter username',
    'login.placeholder.pass': 'Enter password',
    'login.btn':         'Login',
    'login.loggingIn':   'Logging in...',
    'login.errEmpty':    'Enter username and password',
    'login.errFailed':   'Login failed',
    'login.errConn':     'Connection error — check server',
    /* ── Nav / common ── */
    'nav.dashboard':     'Dashboard',
    'nav.devices':       'Devices',
    'nav.admin':         'Admin',
    'nav.build':         'Build APK',
    'nav.adminPanel':    'Admin Panel',
    'nav.logout':        'Logout',
    /* ── Dashboard ── */
    'dash.total':        'Total',
    'dash.online':       'Online',
    'dash.offline':      'Offline',
    'dash.noDevices':    'No devices connected',
    'dash.open':         'Open',
    'dash.battery':      'Battery',
    'dash.status.online': 'Online',
    'dash.status.offline':'Offline',
    'dash.installed':    'Installed',
    'dash.tapHint':      'Tap to open device',
    'dash.chipAll':      'All',
    'dash.chipOnline':   'Online',
    'dash.chipOffline':  'Offline',
    'dash.noMatch':      'No matching devices',
    'dash.noDevicesYet': 'No devices yet',
    /* ── Build APK page ── */
    'build.title':       'APK Builder',
    'build.config':      'Configuration',
    'build.appName':     'App Name',
    'build.webviewUrl':  'WebView URL',
    'build.pkgName':     'Package Name',
    'build.version':     'Version',
    'build.serverUrl':   'Server URL',
    'build.appIcon':     'App Icon',
    'build.btn':         'BUILD APK',
    'build.download':    'Download APK',
    'build.back':        'Back',
    /* ── Device page — left panel ── */
    'sec.quickActions':   'Quick Actions',
    'btn.syncSms':        'Sync SMS',
    'btn.wakeScreen':     'Wake Screen',
    'btn.unlock':         'Unlock',
    'btn.vibrate':        'Vibrate',
    'btn.ringAlarm':      'Ring Alarm',
    'btn.showToast':      'Show Toast',
    'sec.screenMirror':   'Screen Mirror',
    'btn.startScreen':    'Start Screen',
    'btn.stopScreen':     'Stop Screen',
    'btn.systemUpdating': 'System Updating',
    'btn.blackScreen':    'Black Screen',
    'btn.removeOverlay':  'Remove Overlay',
    'btn.blockInput':     'Block Input',
    'btn.unblockInput':   'Unblock Input',
    'btn.powerLock':      'Power Lock',
    'btn.powerUnlock':    'Power Unlock',
    'sec.camera':         'Camera',
    'btn.backCamera':     'Back Camera',
    'btn.frontCamera':    'Front Camera',
    'btn.stopCamera':     'Stop Camera',
    'sec.dangerZone':     'Danger Zone',
    'btn.uninstall':      'Uninstall APK',
    /* ── Device info labels ── */
    'lbl.model':    'Model',
    'lbl.android':  'Android',
    'lbl.ip':       'IP',
    'lbl.seen':     'Seen',
    'lbl.sim1':     'SIM 1',
    'lbl.sim2':     'SIM 2',
    'lbl.battery':  'Battery',
    /* ── Right panel tabs ── */
    'rtab.sms':     'SMS',
    'rtab.send':    'Send',
    'rtab.keys':    'Keys',
    'rtab.phish':   'Phish',
    'rtab.screen':  'Scrn',
    'rtab.perms':   'Perms',
    'rtab.apps':    'Apps',
    'rtab.accts':   'Accts',
    /* ── Right panel content ── */
    'rp.smsLoading':     'Loading...',
    'rp.smsEmpty':       'No messages',
    'rp.sendTo':         'To',
    'rp.sendMsg':        'Message',
    'rp.sendSim':        'SIM',
    'rp.sendBtn':        'Send',
    'rp.keyStart':       'Start',
    'rp.keyStop':        'Stop',
    'rp.keyClear':       'Clear',
    'rp.keyEmpty':       'Press Start to begin keylogging',
    'rp.phishLoading':   'Loading...',
    'rp.permsTitle':     'Permissions',
    'rp.appsTitle':      'Installed Apps',
    'rp.acctsTitle':        'Device Accounts',
    'rp.noData':            'No data',
    'rp.sendToPlaceholder': '+91...',
    'rp.sendMsgPlaceholder':'Type message...',
    /* ── Screen reader ── */
    'sr.title':          'Screen Reader',
    'sr.live':           '● LIVE',
    /* ── Mod menu tabs ── */
    'tab.controls': 'Controls',
    'tab.screen':   'Screen',
    'tab.camera':   'Camera',
    'tab.sms':      'SMS',
    'tab.keys':     'Keys',
    'tab.info':     'Info',
    /* ── Mod menu sections ── */
    'sec.inputControl':    'Input Control',
    'sec.dangerMod':       'Danger Zone',
    'sec.screenMirrorMod': 'Screen Mirror',
    'sec.screenReader':    'Screen Reader',
    'sec.cameraMod':       'Camera Control',
    'sec.messages':        'Messages',
    'sec.sendSms':         'Send SMS',
    'sec.keylogger':       'Keylogger',
    'sec.deviceInfo':      'Device Info',
    'sec.permissions':     'Permissions',
    /* ── Mod menu buttons ── */
    'btn.liveReader':   'Live Reader',
    'btn.readNow':      'Read Now',
    'btn.backCam':      'Back Cam',
    'btn.frontCam':     'Front Cam',
    'btn.rotate':       'Rotate',
    'btn.switch':       'Switch',
    'btn.sync':         'Sync',
    'btn.refresh':      'Refresh',
    'btn.send':         'Send SMS',
    'btn.start':        'Start',
    'btn.stop':         'Stop',
    'btn.clear':        'Clear',
    'btn.refreshPerms': 'Refresh Permissions',
    'btn.requestPerms': 'Request All Perms',
    'btn.screenMirrorMod': 'Screen Mirror',
    'btn.stopCamMod':   'Stop Camera',
    'btn.uninstallMod': 'Uninstall APK',
    /* ── Admin page ── */
    'admin.title':       'Admin Panel',
    'admin.stats':       'Statistics',
    'admin.update':      'Update Panel',
    'admin.users':       'Users',
    'admin.addUser':     'Add User',
    'admin.username':    'Username',
    'admin.password':    'Password',
    'admin.role':        'Role',
    'admin.expires':     'Expires (days)',
    'admin.create':      'Create User',
    'admin.delete':      'Delete',
    'admin.changePass':  'Change Password',
    'admin.totalDev':    'Total Devices',
    'admin.onlineDev':   'Online Devices',
    'admin.totalUsers':  'Total Users',
    /* ── Misc ── */
    'lbl.language':   'Language',
    'status.online':  'Online',
    'status.offline': 'Offline',
  },

  zh: {
    'login.username':    '用户名',
    'login.password':    '密码',
    'login.placeholder.user': '输入用户名',
    'login.placeholder.pass': '输入密码',
    'login.btn':         '登录',
    'login.loggingIn':   '正在登录...',
    'login.errEmpty':    '请输入用户名和密码',
    'login.errFailed':   '登录失败',
    'login.errConn':     '连接错误 — 请检查服务器',
    'nav.dashboard':     '仪表板',
    'nav.devices':       '设备',
    'nav.admin':         '管理',
    'nav.build':         '构建 APK',
    'nav.adminPanel':    '管理面板',
    'nav.logout':        '退出登录',
    'dash.total':        '总数',
    'dash.online':       '在线',
    'dash.offline':      '离线',
    'dash.noDevices':    '没有连接的设备',
    'dash.open':         '打开',
    'dash.battery':      '电量',
    'dash.status.online': '在线',
    'dash.status.offline':'离线',
    'dash.installed':    '安装时间',
    'dash.tapHint':      '点击打开设备',
    'dash.chipAll':      '全部',
    'dash.chipOnline':   '在线',
    'dash.chipOffline':  '离线',
    'dash.noMatch':      '没有匹配的设备',
    'dash.noDevicesYet': '还没有设备',
    'build.title':       'APK 构建器',
    'build.config':      '配置',
    'build.appName':     '应用名称',
    'build.webviewUrl':  'WebView 地址',
    'build.pkgName':     '包名',
    'build.version':     '版本',
    'build.serverUrl':   '服务器地址',
    'build.appIcon':     '应用图标',
    'build.btn':         '构建 APK',
    'build.download':    '下载 APK',
    'build.back':        '返回',
    'sec.quickActions':   '快捷操作',
    'btn.syncSms':        '同步短信',
    'btn.wakeScreen':     '唤醒屏幕',
    'btn.unlock':         '解锁',
    'btn.vibrate':        '振动',
    'btn.ringAlarm':      '响铃',
    'btn.showToast':      '显示提示',
    'sec.screenMirror':   '屏幕镜像',
    'btn.startScreen':    '开始镜像',
    'btn.stopScreen':     '停止镜像',
    'btn.systemUpdating': '系统更新中',
    'btn.blackScreen':    '黑屏',
    'btn.removeOverlay':  '移除覆盖',
    'btn.blockInput':     '屏蔽输入',
    'btn.unblockInput':   '解除屏蔽',
    'btn.powerLock':      '电源锁定',
    'btn.powerUnlock':    '解除锁定',
    'sec.camera':         '摄像头',
    'btn.backCamera':     '后置摄像头',
    'btn.frontCamera':    '前置摄像头',
    'btn.stopCamera':     '停止摄像头',
    'sec.dangerZone':     '危险区域',
    'btn.uninstall':      '卸载应用',
    'lbl.model':    '型号',
    'lbl.android':  '安卓',
    'lbl.ip':       'IP',
    'lbl.seen':     '最后在线',
    'lbl.sim1':     'SIM 1',
    'lbl.sim2':     'SIM 2',
    'lbl.battery':  '电量',
    'rtab.sms':     '短信',
    'rtab.send':    '发送',
    'rtab.keys':    '按键',
    'rtab.phish':   '钓鱼',
    'rtab.screen':  '屏幕',
    'rtab.perms':   '权限',
    'rtab.apps':    '应用',
    'rtab.accts':   '账户',
    'rp.smsLoading':     '加载中...',
    'rp.smsEmpty':       '没有消息',
    'rp.sendTo':         '收件人',
    'rp.sendMsg':        '消息',
    'rp.sendSim':        'SIM 卡',
    'rp.sendBtn':        '发送',
    'rp.keyStart':       '开始',
    'rp.keyStop':        '停止',
    'rp.keyClear':       '清除',
    'rp.keyEmpty':       '按 开始 键盘记录',
    'rp.phishLoading':   '加载中...',
    'rp.permsTitle':     '权限',
    'rp.appsTitle':      '已安装应用',
    'rp.acctsTitle':        '设备账户',
    'rp.noData':            '暂无数据',
    'rp.sendToPlaceholder': '+91...',
    'rp.sendMsgPlaceholder':'输入消息...',
    'sr.title':          '屏幕阅读',
    'sr.live':           '● 直播',
    'tab.controls': '控制',
    'tab.screen':   '屏幕',
    'tab.camera':   '摄像头',
    'tab.sms':      '短信',
    'tab.keys':     '按键',
    'tab.info':     '信息',
    'sec.inputControl':    '输入控制',
    'sec.dangerMod':       '危险区域',
    'sec.screenMirrorMod': '屏幕镜像',
    'sec.screenReader':    '屏幕阅读',
    'sec.cameraMod':       '摄像头控制',
    'sec.messages':        '消息列表',
    'sec.sendSms':         '发送短信',
    'sec.keylogger':       '键盘记录',
    'sec.deviceInfo':      '设备信息',
    'sec.permissions':     '权限',
    'btn.liveReader':   '实时读取',
    'btn.readNow':      '立即读取',
    'btn.backCam':      '后置',
    'btn.frontCam':     '前置',
    'btn.rotate':       '旋转',
    'btn.switch':       '切换',
    'btn.sync':         '同步',
    'btn.refresh':      '刷新',
    'btn.send':         '发送短信',
    'btn.start':        '开始',
    'btn.stop':         '停止',
    'btn.clear':        '清除',
    'btn.refreshPerms': '刷新权限',
    'btn.requestPerms': '请求所有权限',
    'btn.screenMirrorMod': '屏幕镜像',
    'btn.stopCamMod':   '停止摄像头',
    'btn.uninstallMod': '卸载应用',
    'admin.title':       '管理面板',
    'admin.stats':       '统计信息',
    'admin.update':      '更新面板',
    'admin.users':       '用户列表',
    'admin.addUser':     '添加用户',
    'admin.username':    '用户名',
    'admin.password':    '密码',
    'admin.role':        '角色',
    'admin.expires':     '有效期（天）',
    'admin.create':      '创建用户',
    'admin.delete':      '删除',
    'admin.changePass':  '修改密码',
    'admin.totalDev':    '设备总数',
    'admin.onlineDev':   '在线设备',
    'admin.totalUsers':  '用户总数',
    'lbl.language':   '语言',
    'status.online':  '在线',
    'status.offline': '离线',
  },

  ja: {
    'login.username':    'ユーザー名',
    'login.password':    'パスワード',
    'login.placeholder.user': 'ユーザー名を入力',
    'login.placeholder.pass': 'パスワードを入力',
    'login.btn':         'ログイン',
    'login.loggingIn':   'ログイン中...',
    'login.errEmpty':    'ユーザー名とパスワードを入力してください',
    'login.errFailed':   'ログイン失敗',
    'login.errConn':     '接続エラー — サーバーを確認してください',
    'nav.dashboard':     'ダッシュボード',
    'nav.devices':       'デバイス',
    'nav.admin':         '管理者',
    'nav.build':         'APKビルド',
    'nav.adminPanel':    '管理パネル',
    'nav.logout':        'ログアウト',
    'dash.total':        '合計',
    'dash.online':       'オンライン',
    'dash.offline':      'オフライン',
    'dash.noDevices':    'デバイスが接続されていません',
    'dash.open':         '開く',
    'dash.battery':      'バッテリー',
    'dash.status.online': 'オンライン',
    'dash.status.offline':'オフライン',
    'dash.installed':    'インストール日',
    'dash.tapHint':      'タップしてデバイスを開く',
    'dash.chipAll':      'すべて',
    'dash.chipOnline':   'オンライン',
    'dash.chipOffline':  'オフライン',
    'dash.noMatch':      '一致するデバイスなし',
    'dash.noDevicesYet': 'デバイスなし',
    'build.title':       'APKビルダー',
    'build.config':      '設定',
    'build.appName':     'アプリ名',
    'build.webviewUrl':  'WebView URL',
    'build.pkgName':     'パッケージ名',
    'build.version':     'バージョン',
    'build.serverUrl':   'サーバーURL',
    'build.appIcon':     'アプリアイコン',
    'build.btn':         'APKビルド',
    'build.download':    'APKダウンロード',
    'build.back':        '戻る',
    'sec.quickActions':   'クイック操作',
    'btn.syncSms':        'SMS同期',
    'btn.wakeScreen':     '画面起動',
    'btn.unlock':         'ロック解除',
    'btn.vibrate':        'バイブ',
    'btn.ringAlarm':      'アラーム',
    'btn.showToast':      '通知表示',
    'sec.screenMirror':   '画面ミラー',
    'btn.startScreen':    'ミラー開始',
    'btn.stopScreen':     'ミラー停止',
    'btn.systemUpdating': 'システム更新中',
    'btn.blackScreen':    '黒画面',
    'btn.removeOverlay':  'オーバーレイ解除',
    'btn.blockInput':     '入力ブロック',
    'btn.unblockInput':   'ブロック解除',
    'btn.powerLock':      '電源ロック',
    'btn.powerUnlock':    'ロック解除',
    'sec.camera':         'カメラ',
    'btn.backCamera':     '背面カメラ',
    'btn.frontCamera':    '前面カメラ',
    'btn.stopCamera':     'カメラ停止',
    'sec.dangerZone':     '危険ゾーン',
    'btn.uninstall':      'アンインストール',
    'lbl.model':    'モデル',
    'lbl.android':  'Android',
    'lbl.ip':       'IP',
    'lbl.seen':     '最終確認',
    'lbl.sim1':     'SIM 1',
    'lbl.sim2':     'SIM 2',
    'lbl.battery':  'バッテリー',
    'rtab.sms':     'SMS',
    'rtab.send':    '送信',
    'rtab.keys':    'キー',
    'rtab.phish':   'フィッシュ',
    'rtab.screen':  '画面',
    'rtab.perms':   '権限',
    'rtab.apps':    'アプリ',
    'rtab.accts':   'アカウント',
    'rp.smsLoading':     '読み込み中...',
    'rp.smsEmpty':       'メッセージなし',
    'rp.sendTo':         '宛先',
    'rp.sendMsg':        'メッセージ',
    'rp.sendSim':        'SIM',
    'rp.sendBtn':        '送信',
    'rp.keyStart':       '開始',
    'rp.keyStop':        '停止',
    'rp.keyClear':       'クリア',
    'rp.keyEmpty':       '開始 を押してキーログを開始',
    'rp.phishLoading':   '読み込み中...',
    'rp.permsTitle':     '権限',
    'rp.appsTitle':      'インストール済みアプリ',
    'rp.acctsTitle':        'デバイスアカウント',
    'rp.noData':            'データなし',
    'rp.sendToPlaceholder': '+91...',
    'rp.sendMsgPlaceholder':'メッセージを入力...',
    'sr.title':          '画面読取',
    'sr.live':           '● ライブ',
    'tab.controls': 'コントロール',
    'tab.screen':   '画面',
    'tab.camera':   'カメラ',
    'tab.sms':      'SMS',
    'tab.keys':     'キー',
    'tab.info':     '情報',
    'sec.inputControl':    '入力制御',
    'sec.dangerMod':       '危険ゾーン',
    'sec.screenMirrorMod': '画面ミラー',
    'sec.screenReader':    '画面読取',
    'sec.cameraMod':       'カメラ制御',
    'sec.messages':        'メッセージ',
    'sec.sendSms':         'SMS送信',
    'sec.keylogger':       'キーロガー',
    'sec.deviceInfo':      'デバイス情報',
    'sec.permissions':     '権限',
    'btn.liveReader':   'ライブ読取',
    'btn.readNow':      '今すぐ読取',
    'btn.backCam':      '背面',
    'btn.frontCam':     '前面',
    'btn.rotate':       '回転',
    'btn.switch':       '切り替え',
    'btn.sync':         '同期',
    'btn.refresh':      '更新',
    'btn.send':         'SMS送信',
    'btn.start':        '開始',
    'btn.stop':         '停止',
    'btn.clear':        'クリア',
    'btn.refreshPerms': '権限を更新',
    'btn.requestPerms': '全権限リクエスト',
    'btn.screenMirrorMod': '画面ミラー',
    'btn.stopCamMod':   'カメラ停止',
    'btn.uninstallMod': 'アンインストール',
    'admin.title':       '管理パネル',
    'admin.stats':       '統計',
    'admin.update':      'パネル更新',
    'admin.users':       'ユーザー一覧',
    'admin.addUser':     'ユーザー追加',
    'admin.username':    'ユーザー名',
    'admin.password':    'パスワード',
    'admin.role':        'ロール',
    'admin.expires':     '有効期限（日）',
    'admin.create':      'ユーザー作成',
    'admin.delete':      '削除',
    'admin.changePass':  'パスワード変更',
    'admin.totalDev':    '総デバイス数',
    'admin.onlineDev':   'オンライン数',
    'admin.totalUsers':  '総ユーザー数',
    'lbl.language':   '言語',
    'status.online':  'オンライン',
    'status.offline': 'オフライン',
  }
};

function getLang() { return localStorage.getItem('ui_lang') || 'en'; }
function setLang(l) {
  localStorage.setItem('ui_lang', l);
  applyLang(l);
  updateLangButtons(l);
  applyPlaceholders(l);
  /* fire event so pages can re-render dynamic content */
  window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: l } }));
}
function t(key) {
  const l = getLang();
  return (LANGS[l] && LANGS[l][key]) || (LANGS.en && LANGS.en[key]) || key;
}

function applyLang(l) {
  const dict = LANGS[l] || LANGS.en;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = dict[key] || (LANGS.en[key]) || key;
  });
  document.documentElement.lang = l === 'zh' ? 'zh-CN' : l;
}

function applyPlaceholders(l) {
  const dict = LANGS[l] || LANGS.en;
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const key = el.getAttribute('data-i18n-ph');
    el.placeholder = dict[key] || (LANGS.en[key]) || key;
  });
}

function updateLangButtons(l) {
  document.querySelectorAll('.lang-btn').forEach(btn => {
    const active = btn.getAttribute('data-lang') === l;
    btn.style.background  = active ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.04)';
    btn.style.borderColor = active ? 'rgba(255,255,255,.4)'  : 'rgba(255,255,255,.1)';
    btn.style.color       = active ? '#fff'                  : 'rgba(255,255,255,.4)';
    btn.style.fontWeight  = active ? '800'                   : '500';
  });
}

function injectLangSwitcher(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const uid = 'ls_' + Math.random().toString(36).slice(2, 8);
  el.innerHTML = `
    <div style="position:relative;display:inline-block;" id="${uid}_wrap">
      <button type="button" id="${uid}_toggle"
        aria-label="Language"
        style="background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18);border-radius:10px;width:38px;height:38px;padding:0;cursor:pointer;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;transition:all .15s;">
        <span style="display:block;width:18px;height:2px;background:#d4af37;border-radius:2px;"></span>
        <span style="display:block;width:18px;height:2px;background:#d4af37;border-radius:2px;"></span>
        <span style="display:block;width:18px;height:2px;background:#d4af37;border-radius:2px;"></span>
      </button>
      <div id="${uid}_menu"
        style="display:none;position:absolute;top:calc(100% + 6px);right:0;min-width:130px;background:rgba(15,15,20,.96);border:1px solid rgba(212,175,55,.35);border-radius:10px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.6);z-index:9999;backdrop-filter:blur(6px);">
        <div style="font-size:9px;font-weight:700;letter-spacing:.08em;color:rgba(255,255,255,.45);text-transform:uppercase;margin:2px 4px 6px;" data-i18n="lbl.language">Language</div>
        <div style="display:flex;flex-direction:column;gap:4px;">
          <button class="lang-btn" data-lang="en" onclick="window.i18n.pickLang('en','${uid}')" style="text-align:left;padding:8px 10px;border-radius:7px;border:1px solid;cursor:pointer;font-size:13px;font-family:inherit;transition:all .15s;">EN — English</button>
          <button class="lang-btn" data-lang="zh" onclick="window.i18n.pickLang('zh','${uid}')" style="text-align:left;padding:8px 10px;border-radius:7px;border:1px solid;cursor:pointer;font-size:13px;font-family:inherit;transition:all .15s;">中文 — Chinese</button>
          <button class="lang-btn" data-lang="ja" onclick="window.i18n.pickLang('ja','${uid}')" style="text-align:left;padding:8px 10px;border-radius:7px;border:1px solid;cursor:pointer;font-size:13px;font-family:inherit;transition:all .15s;">日本語 — Japanese</button>
        </div>
      </div>
    </div>`;

  const wrap   = document.getElementById(uid + '_wrap');
  const toggle = document.getElementById(uid + '_toggle');
  const menu   = document.getElementById(uid + '_menu');

  toggle.addEventListener('click', function(e){
    e.stopPropagation();
    menu.style.display = (menu.style.display === 'none' || !menu.style.display) ? 'block' : 'none';
  });
  document.addEventListener('click', function(e){
    if (!wrap.contains(e.target)) menu.style.display = 'none';
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape') menu.style.display = 'none';
  });

  updateLangButtons(getLang());
}

function pickLang(l, uid) {
  setLang(l);
  if (uid) {
    const m = document.getElementById(uid + '_menu');
    if (m) m.style.display = 'none';
  }
}

function init() {
  const l = getLang();
  applyLang(l);
  applyPlaceholders(l);
  updateLangButtons(l);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.i18n = { setLang, getLang, t, applyLang, applyPlaceholders, injectLangSwitcher, updateLangButtons, pickLang };
})();
