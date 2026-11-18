const { app, BrowserWindow, screen, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// ---------- 配置 ----------
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');
const DEFAULT_CONFIG = {
  edge: 'right',          // right | left  (可配置)
  hotZone: 20,            // 触发热区宽度 px
  dragThreshold: 40,      // 从边缘向内拖动多少 px 才判定为“拉抽屉”
  drawerWidth: 380,       // 抽屉面板宽度
  drawerHeight: 640,      // 抽屉高度
  storeDir: path.join(os.homedir(), 'EdgeDrawerStore') // 收纳目录
};
function loadConfig() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }; }
  catch { return { ...DEFAULT_CONFIG }; }
}
function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
let config = loadConfig();
if (!fs.existsSync(config.storeDir)) fs.mkdirSync(config.storeDir, { recursive: true });

// ---------- 窗口 ----------
let win = null;
let currentDisplay = null;   // 抽屉所在的显示器
let opened = false;          // 抽屉是否已滑出

function createWindow() {
  currentDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  win = new BrowserWindow({
    width: config.drawerWidth,
    height: config.drawerHeight,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, 'index.html'));

  win.on('blur', () => {
    // 失焦不自动收起（拖动触发模式下由鼠标判定控制），保持可见
  });

  placeWindow(false); // 初始藏到边缘外
}

// 计算抽屉窗口位置：藏起时移出屏幕边缘外，展开时贴边滑入
function placeWindow(open) {
  if (!win || !currentDisplay) return;
  const wa = currentDisplay.workArea; // 扣除任务栏
  const w = config.drawerWidth, h = config.drawerHeight;
  const top = Math.round(wa.y + (wa.height - h) / 2);

  let x;
  if (config.edge === 'right') {
    x = open ? (wa.x + wa.width - w) : (wa.x + wa.width - 2); // 收起时只留 2px 在屏内
  } else {
    x = open ? wa.x : (wa.x - w + 2);
  }
  win.setBounds({ x: Math.round(x), y: top, width: w, height: h });
  opened = open;
}

function openDrawer() {
  if (opened) return;
  placeWindow(true);
  win.showInactive();
  win.webContents.send('drawer-state', 'open');
}
function closeDrawer() {
  if (!opened) return;
  placeWindow(false);
  win.webContents.send('drawer-state', 'close');
  setTimeout(() => { if (!opened && win) win.hide(); }, 350);
}

// ---------- 全局鼠标监听：仅“从边缘向内拖”才触发 ----------
let uio = null;
let dragging = false;
let dragStartX = null;
let dragStartedNearEdge = false;

function setupGlobalMouse() {
  try {
    uio = require('uiohook-napi');
    const { uIOhook } = uio;

    uIOhook.on('mousedown', (e) => {
      const pt = screen.getCursorScreenPoint();
      const disp = screen.getDisplayNearestPoint(pt);
      const wa = disp.workArea;
      // 判断按下点是否落在当前屏边缘热区内
      let nearEdge = false;
      if (config.edge === 'right') {
        nearEdge = pt.x >= wa.x + wa.width - config.hotZone;
      } else {
        nearEdge = pt.x <= wa.x + config.hotZone;
      }
      dragging = true;
      dragStartX = pt.x;
      dragStartedNearEdge = nearEdge;
      if (nearEdge) currentDisplay = disp;
    });

    uIOhook.on('mousemove', (e) => {
      if (!dragging || !dragStartedNearEdge) return;
      const pt = screen.getCursorScreenPoint();
      const wa = currentDisplay.workArea;
      let inward;
      if (config.edge === 'right') {
        inward = dragStartX - pt.x;                 // 右边缘：向左拖为正
      } else {
        inward = pt.x - dragStartX;                 // 左边缘：向右拖为正
      }
      if (inward >= config.dragThreshold) {
        openDrawer();
      }
    });

    uIOhook.on('mouseup', () => {
      dragging = false;
      dragStartedNearEdge = false;
      dragStartX = null;
    });

    uIOhook.start();
    console.log('[uiohook] global mouse started');
  } catch (err) {
    console.error('[uiohook] failed to start:', err.message);
  }
}

// ---------- 存储文件 ----------
function uniquePath(dir, name) {
  let target = path.join(dir, name);
  if (!fs.existsSync(target)) return target;
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let i = 1;
  while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i++;
  return path.join(dir, `${base} (${i})${ext}`);
}

function listFiles() {
  try {
    return fs.readdirSync(config.storeDir)
      .filter(n => !n.startsWith('.'))
      .map(n => {
        const full = path.join(config.storeDir, n);
        const st = fs.statSync(full);
        return { name: n, path: full, size: st.size, mtime: st.mtimeMs, isDir: st.isDirectory() };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch { return []; }
}

// ---------- IPC ----------
ipcMain.handle('get-config', () => ({ ...config, files: listFiles() }));

ipcMain.handle('save-config', (e, patch) => {
  config = { ...config, ...patch };
  saveConfig(config);
  if (!fs.existsSync(config.storeDir)) fs.mkdirSync(config.storeDir, { recursive: true });
  placeWindow(opened);
  return { ...config, files: listFiles() };
});

ipcMain.handle('copy-file', (e, srcPath) => {
  try {
    const name = path.basename(srcPath);
    const target = uniquePath(config.storeDir, name);
    fs.copyFileSync(srcPath, target);
    return { ok: true, files: listFiles() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('delete-file', (e, filePath) => {
  try {
    if (!filePath.startsWith(config.storeDir)) return { ok: false, error: 'out of store dir' };
    fs.rmSync(filePath, { force: true });
    return { ok: true, files: listFiles() };
  } catch (err) { return { ok: false, error: err.message }; }
});

ipcMain.handle('open-file', (e, filePath) => { shell.openPath(filePath); return true; });
ipcMain.handle('open-store-dir', () => { shell.openPath(config.storeDir); return true; });
ipcMain.handle('close-drawer', () => { closeDrawer(); return true; });

ipcMain.on('drag-enter', () => { if (!opened) openDrawer(); });

// ---------- 生命周期 ----------
app.whenReady().then(() => {
  createWindow();
  setupGlobalMouse();

  // 显示器变化时重新定位
  screen.on('display-added', () => placeWindow(opened));
  screen.on('display-removed', () => { currentDisplay = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); placeWindow(opened); });
  screen.on('display-metrics-changed', () => placeWindow(opened));

  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('window-all-closed', (e) => {
  // 常驻，不退出
  e.preventDefault && e.preventDefault();
});

app.on('will-quit', () => { try { uio && uio.uIOhook.stop(); } catch {} });
