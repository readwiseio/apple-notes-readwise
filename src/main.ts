import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import path from 'path';
import { store, getObsidianClientID, getUserAuthToken, syncHighlights } from './api';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
    },
  });

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
  }

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

ipcMain.on('electron-store-get', async (_, key) => {
  return store.get(key);
})

ipcMain.on('electron-store-set', async (_, key, value) => {
  store.set(key, value);
})

ipcMain.on('send-notification', (_, message) => {
  new Notification({ title: 'Notification', body: message }).show();
})

ipcMain.handle('sync-highlights', (event => {
    return syncHighlights();
}))

ipcMain.handle('connect-to-readwise', (event => {
  const uuid = getObsidianClientID();

  const loginWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  })

  loginWindow.loadURL(`https://readwise.io/api_auth?token=${uuid}&service=obsidian`);

  const success = getUserAuthToken(uuid);
  if (success) {
    return 'Readwise connected';
  }
}))

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.