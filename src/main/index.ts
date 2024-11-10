import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { updateAppleNotesAccounts } from '@/lib/utils'
import { getObsidianClientID, getUserAuthToken, ReadwiseSync } from '@/lib'
import { store } from '@/lib/store'

let mainWindow: BrowserWindow

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    maxHeight: 600,
    maxWidth: 800,
    minHeight: 600,
    minWidth: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true
    }
  })

  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }

  // check if the token is "" or not
  const tokenExsits = Boolean(store.get('token'))
  console.log('User is authenticated: ', tokenExsits)
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('login-status', tokenExsits)
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

ipcMain.on('login-status', (event: Electron.Event, loggedIn: boolean) => {
  event.preventDefault()
  mainWindow.webContents.send('login-status', loggedIn)
})

ipcMain.handle('electron-store-get', async (_, key) => {
  return store.get(key)
})

ipcMain.on('electron-store-set', async (_, key, value) => {
  store.set(key, value)
})

ipcMain.handle('sync-highlights', () => {
  const readwiseSync = new ReadwiseSync(mainWindow, store)
  return readwiseSync.syncHighlights()
})

ipcMain.handle('connect-to-readwise', async (event: Electron.Event) => {
  event.preventDefault()
  const uuid = getObsidianClientID()

  const loginWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  loginWindow.loadURL(`https://readwise.io/api_auth?token=${uuid}&service=obsidian`)

  const token = await getUserAuthToken(uuid)
  if (token) {
    await store.set('token', token)
    mainWindow.webContents.send('login-status', true)
    return 'Connected to Readwise'
  } else {
    console.error('Failed to connect to Readwise')
    mainWindow.webContents.send('login-status', false)
    return 'Failed to connect to Readwise'
  }
})

ipcMain.handle('open-custom-format-window', (event: Electron.Event) => {
  event.preventDefault()
  const loginWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  loginWindow.loadURL(`https://readwise.io/export/obsidian/preferences`)
})

ipcMain.handle('fetch-apple-notes-accounts', async () => {
  return await updateAppleNotesAccounts()
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
