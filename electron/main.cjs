// Desktop shell: the game is a browser build, so Electron serves it over the same
// zero-dependency static server instead of file:// (ES module imports need an origin).
// `npm run electron` needs electron itself, which is deliberately NOT a dependency of this
// repo — the browser build and `node server.cjs` are the supported paths.
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { startServer } = require('../server.cjs');

// 窗口/停靠图标用生成器产出的那一张（assets/build 由 assets/gen/gen_art.py 画，
// package.json 的 build.*.icon 指向同源的 .icns/.ico）。macOS 上只有打包后的 bundle
// 会自动带 .icns，`electron .` 直跑必须显式 setIcon，否则是 Electron 的默认图标。
const ICON = path.join(__dirname, '..', 'assets', 'build', 'icon-256.png');

async function createWindow() {
  const server = await startServer({ port: 0 });
  const { port } = server.address();
  const win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 820,
    minHeight: 620,
    backgroundColor: '#14161a',
    title: '保加利亚梯 Bulgarian Staircase',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  await win.loadURL(`http://127.0.0.1:${port}/index.html`);
  win.on('closed', () => server.close());
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(ICON);
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
