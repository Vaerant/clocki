const { app, BrowserWindow, Tray, Menu, ipcMain, globalShortcut, nativeImage, screen, shell } = require('electron');
const { execFile } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const AW = 'http://localhost:5600/api/0';
const BUCKET = `aw-clockin_${os.hostname()}`;
const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
let cfg = { presets: ['Deep Work', 'Meetings', 'Code Review'], last: 'Deep Work' };
const legacyCfg = path.join(app.getPath('appData'), 'ClockIn', 'config.json'); // pre-rename location
try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(fs.existsSync(cfgFile()) ? cfgFile() : legacyCfg, 'utf8')) }; } catch {}
const save = () => fs.writeFileSync(cfgFile(), JSON.stringify(cfg, null, 2));

const key = (d) => d.toLocaleDateString('en-CA'); // local YYYY-MM-DD
const dayStartOf = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const weekStartOf = (d = new Date()) => { const x = dayStartOf(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }; // Monday
function byDay(events) { // split events at local midnight -> { 'YYYY-MM-DD': { preset: seconds } }
  const days = {};
  for (const e of events) {
    let t = Date.parse(e.timestamp); const end = t + e.duration * 1000, p = e.data?.preset ?? '?';
    while (t < end) {
      const next = dayStartOf(new Date(t)); next.setDate(next.getDate() + 1);
      const cut = Math.min(end, next.getTime()), k = key(new Date(t));
      (days[k] ??= {})[p] = (days[k][p] || 0) + (cut - t) / 1000;
      t = cut;
    }
  }
  return days;
}

let win, tray, hiddenAt = 0;
let want = null;          // { preset, since } while clocked in
let curId = null;         // AW event id of the running session
let online = false, totals = {}, weekTotal = 0, sinceEv = null, bucketOk = false, resumed = false;

// ---- ActivityWatch install detection + one-click installer ----
const SITE = 'https://activitywatch.net/downloads/';
let installed = null, install = { phase: 'idle', pct: 0, error: null }; // phase: idle | downloading | launched | error
const awDirs = () => [
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'ActivityWatch'),
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ActivityWatch'),
  path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'ActivityWatch'),
];
const regHas = (hive) => new Promise((res) => execFile('reg',
  ['query', `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall`, '/s', '/f', 'ActivityWatch', '/d'],
  { windowsHide: true }, (err, out) => res(!err && /ActivityWatch/i.test(out))));
async function detectInstalled() {
  if (process.platform !== 'win32') return true;
  if (awDirs().some((d) => fs.existsSync(path.join(d, 'aw-qt.exe')))) return true;
  return (await regHas('HKCU')) || (await regHas('HKLM'));
}
async function installAW() {
  if (install.phase === 'downloading') return;
  install = { phase: 'downloading', pct: 0, error: null }; push();
  try {
    const rel = await (await fetch('https://api.github.com/repos/ActivityWatch/activitywatch/releases/latest', { headers: { 'User-Agent': 'Clocki' } })).json();
    const asset = rel.assets?.find((a) => /windows.*setup\.exe$/i.test(a.name));
    if (!asset) throw new Error('Could not find the Windows installer in the latest release');
    const file = path.join(app.getPath('temp'), asset.name);
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const total = Number(res.headers.get('content-length')) || asset.size, out = fs.createWriteStream(file);
    let got = 0;
    for await (const chunk of res.body) {
      out.write(chunk); got += chunk.length;
      const pct = Math.min(99, Math.round((got / total) * 100));
      if (pct !== install.pct) { install.pct = pct; push(); }
    }
    await new Promise((r) => out.end(r));
    const err = await shell.openPath(file); // ShellExecute, so the installer can ask for UAC itself
    if (err) throw new Error(err);
    install = { phase: 'launched', pct: 100, error: null };
  } catch (e) {
    shell.openExternal(SITE);
    install = { phase: 'error', pct: 0, error: `${e.message || e}. Opened the download page instead.` };
  }
  push();
}

async function aw(p, o = {}) {
  const r = await fetch(AW + p, { headers: { 'Content-Type': 'application/json' }, ...o });
  if (!r.ok && r.status !== 304) throw new Error(String(r.status));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// AW is the source of truth: totals, start time, deletions and renames made in AW flow back here.
async function tick() {
  try {
    if (!bucketOk) {
      await aw(`/buckets/${BUCKET}`, { method: 'POST', body: JSON.stringify({ client: 'clockin', type: 'clockin', hostname: os.hostname() }) });
      bucketOk = true;
    }
    const events = await aw(`/buckets/${BUCKET}/events?start=${encodeURIComponent(weekStartOf().toISOString())}&limit=-1`) || [];
    if (!resumed) { // app restarted mid-session: pick the session back up
      resumed = true;
      const l = events.reduce((a, e) => (!a || e.timestamp > a.timestamp ? e : a), null);
      if (l && !want && Date.now() - (Date.parse(l.timestamp) + l.duration * 1000) < 15000) want = { preset: l.data.preset, since: Date.parse(l.timestamp) }, curId = l.id;
    }
    if (want && curId && !events.some((e) => e.id === curId)) want = null, curId = null; // deleted in AW => clocked out
    const cur = want && events.find((e) => e.id === curId);
    sinceEv = cur ? Date.parse(cur.timestamp) : null;
    if (cur) want.preset = cur.data.preset; // renamed in AW
    // the running session is excluded here; the UI adds its live elapsed time
    const days = byDay(events.filter((e) => !(want && e.id === curId)));
    totals = days[key(new Date())] || {};
    weekTotal = Object.values(days).reduce((a, d) => a + Object.values(d).reduce((x, y) => x + y, 0), 0);
    online = true;
    if (want) {
      const hb = await aw(`/buckets/${BUCKET}/heartbeat?pulsetime=10`, { method: 'POST', body: JSON.stringify({ timestamp: new Date().toISOString(), duration: 0, data: { preset: want.preset } }) });
      curId = hb?.id ?? curId;
    }
  } catch { online = false; bucketOk = false; }
  installed = online || (await detectInstalled());
  if (!installed) { want = null; curId = null; } // not installed: nothing can be clocked
  else if (install.phase !== 'idle') install = { phase: 'idle', pct: 0, error: null };
  push();
}

const snap = () => ({ online, installed, install, running: !!want, preset: want?.preset ?? null, since: sinceEv ?? want?.since ?? null, totals, weekTotal, dayStart: dayStartOf().getTime(), weekStart: weekStartOf().getTime(), presets: cfg.presets, last: cfg.last });
const icons = {};
function icon(on) { // 16x16 pixel clock, doubled to 32px
  if (icons[on]) return icons[on];
  const N = 16, S = 2, buf = Buffer.alloc(N * S * N * S * 4), [r, g, b] = on ? [52, 211, 153] : [113, 113, 122];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    const on_ = (d >= 5.5 && d <= 7.6) || ((x === 7 || x === 8) && y >= 3 && y <= 8) || ((y === 7 || y === 8) && x >= 8 && x <= 11);
    if (!on_) continue;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const o = ((y * S + j) * N * S + x * S + i) * 4; buf[o] = b; buf[o + 1] = g; buf[o + 2] = r; buf[o + 3] = 255; }
  }
  return (icons[on] = nativeImage.createFromBitmap(buf, { width: N * S, height: N * S }));
}
function push() {
  const s = snap();
  win?.webContents.send('state', s);
  tray?.setImage(icon(s.running));
  const el = s.running && s.since ? Math.floor((Date.now() - s.since) / 1000) : 0;
  tray?.setToolTip(s.running ? `${s.preset} - ${Math.floor(el / 3600)}h ${Math.floor((el % 3600) / 60)}m` : 'Clocki - idle');
}

async function start(p) { if (installed === false) return; cfg.last = p; save(); want = { preset: p, since: Date.now() }; curId = null; push(); await tick(); }
function stop() { want = null; curId = null; push(); tick(); }
const toggleClock = () => (want ? stop() : start(cfg.last));

function place() {
  const b = tray.getBounds(), wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea, [w, h] = win.getSize();
  const x = b.width ? b.x + b.width / 2 - w / 2 : wa.x + wa.width - w - 8;
  win.setPosition(Math.round(Math.min(Math.max(x, wa.x + 8), wa.x + wa.width - w - 8)), Math.round(wa.y + wa.height - h - 8));
}
function show() { if (Date.now() - hiddenAt < 250) return; place(); win.show(); win.focus(); tick(); }
const toggleWin = () => (win.isVisible() ? win.hide() : show());

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', show);
app.on('window-all-closed', () => {});

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 360, height: 560, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#09090b', icon: path.join(__dirname, '../build/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  win.setMenu(null);
  app.isPackaged ? win.loadFile(path.join(__dirname, '../dist/index.html')) : win.loadURL('http://localhost:5173');
  win.on('blur', () => win.hide());
  win.on('hide', () => (hiddenAt = Date.now()));

  tray = new Tray(icon(false));
  tray.on('click', toggleWin);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open', click: show }, { label: 'Start / stop last preset', click: toggleClock }, { type: 'separator' }, { label: 'Quit', click: () => app.exit() },
  ]));

  ipcMain.handle('get', snap);
  ipcMain.handle('start', (_, p) => start(p));
  ipcMain.handle('stop', stop);
  ipcMain.handle('hide', () => win.hide());
  ipcMain.handle('add', (_, n) => { n = String(n).trim(); if (n && !cfg.presets.includes(n)) cfg.presets.push(n); cfg.last = n || cfg.last; save(); push(); });
  ipcMain.handle('remove', (_, n) => { cfg.presets = cfg.presets.filter((p) => p !== n); if (cfg.last === n) cfg.last = cfg.presets[0] ?? ''; save(); push(); });

  ipcMain.handle('install', installAW);
  ipcMain.handle('recheck', tick);
  ipcMain.handle('site', () => shell.openExternal(SITE));
  ipcMain.handle('reorder', (_, order) => {
    if (Array.isArray(order) && order.length === cfg.presets.length && order.every((p) => cfg.presets.includes(p))) { cfg.presets = order; save(); push(); }
  });
  ipcMain.handle('stats', async (_, { from, to }) => {
    try {
      const a = new Date(`${from}T00:00:00`), b = new Date(`${to}T00:00:00`); b.setDate(b.getDate() + 1);
      const ev = await aw(`/buckets/${BUCKET}/events?start=${encodeURIComponent(a.toISOString())}&end=${encodeURIComponent(b.toISOString())}&limit=-1`) || [];
      return byDay(ev);
    } catch { return null; }
  });

  globalShortcut.register('Control+Alt+T', toggleWin); // open / close popup
  globalShortcut.register('Control+Alt+Y', toggleClock); // start / stop without opening
  setInterval(tick, 4000);
  tick();
  win.once('ready-to-show', show);
});
