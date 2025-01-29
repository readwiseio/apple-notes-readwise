import path from 'path'
import os from 'os'
import fs from 'fs'
import { app, BrowserWindow, ipcMain, Menu, shell, dialog } from 'electron'
import { updateElectronApp } from 'update-electron-app'
import { store } from '@/lib/store'
import { updateAppleNotesAccounts } from '@/lib/utils'
import { baseURL, NOTE_FOLDER_PATH } from '@shared/constants'
import { getAppleNoteClientID, getUserAuthToken, ReadwiseSync } from '@/lib/sync'

updateElectronApp()

let mainWindow: BrowserWindow
let syncInterval: NodeJS.Timeout | null = null

const createWindow = () => {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 800,
    height: 700,
    maxWidth: 800,
    maxHeight: 700,
    minWidth: 800,
    minHeight: 700,
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

  const isDev = !app.isPackaged

  const customMenuItems = [
    {
      label: 'User Guide',
      click: async () => {
        shell.openExternal('https://github.com/Scarvy/apple-notes-readwise/wiki/User-Guide')
      }
    },
    {
      label: 'Report an Issue',
      click: async () => {
        shell.openExternal('https://github.com/Scarvy/apple-notes-readwise/issues')
      }
    },
    {
      label: 'Check latest release',
      click: async () => {
        shell.openExternal('https://github.com/Scarvy/apple-notes-readwise/releases')
      }
    },
    {
      label: 'Permission Issues?',
      click: async () => {
        shell.openExternal(
          'https://scottsplace.notion.site/Apple-Notes-Readwise-Export-Fixing-permission-issues-14474debfabc805e8701f8534d1854a8?pvs=4'
        )
      }
    },
    {
      label: 'Contact Developer',
      click: async () => {
        shell.openExternal('mailto:scottcarvalho71@gmail.com')
      }
    }
  ]

  const defaultMenu = Menu.getApplicationMenu()

  if (defaultMenu) {
    // Clone existing menu items
    const menuTemplate = defaultMenu.items.map((item) => {
      if (item.label === 'Help') {
        // Update the 'Help' menu
        const updatedHelpMenu = {
          ...item,
          submenu: Menu.buildFromTemplate([
            ...(item.submenu ? item.submenu.items : []), // Preserve existing Help submenu items
            ...customMenuItems // Add custom Help submenu items
          ])
        }
        return updatedHelpMenu
      }
      return item // Return other menu items unchanged
    })

    // Set the updated menu
    const menu = Menu.buildFromTemplate(menuTemplate)
    Menu.setApplicationMenu(menu)
  } else {
    // Fallback: Create a new menu with only the custom Help menu
    const menu = Menu.buildFromTemplate([...customMenuItems])
    Menu.setApplicationMenu(menu)
  }

  // check if the user is authenticated
  const tokenExists = Boolean(store.get('token'))
  console.log('User is authenticated: ', tokenExists)

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.webContents.send('login-status', tokenExists)
    if (tokenExists) {
      // Configure scheduled sync
      const syncFrequency = store.get('frequency') || '0' // default to manual
      configureScheduledSync(syncFrequency)

      // if token exists check if the user has set to sync on startup
      const triggerOnLoad = Boolean(store.get('triggerOnLoad'))
      console.log('Trigger on load: ', triggerOnLoad)
      if (triggerOnLoad) {
        // if sync is already in progress, don't start another one
        if (Boolean(store.get('isSyncing'))) {
          (!mainWindow.isDestroyed()) &&
            mainWindow.webContents.send('toast:show', {
              variant: 'default',
              message: 'Sync already in progress...'
            })
            console.log('Sync already in progress')
          return
        }

        (!mainWindow.isDestroyed()) && (
          mainWindow.webContents.send('toast:show', {
            variant: 'default',
            message: 'Initiating sync...'
          })
        )
        const readwiseSync = new ReadwiseSync(mainWindow, store)
        readwiseSync.syncHighlights(undefined, true)
        console.log('Syncing highlights on load')
      }
    }
  })

  // Open external links in the default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Open the DevTools if the app is in development mode
  isDev && mainWindow.webContents.openDevTools()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
  if (store.get('isSyncing')) {
    console.log('Previous sync was interrupted. Clearing sync status...')
    store.set('isSyncing', false)
    store.set('currentSyncStatusID', 0)
  }

  createWindow()
})

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

ipcMain.handle('request-apple-notes-permission', async (_) => {
  const dataPath = path.join(os.homedir(), NOTE_FOLDER_PATH);

  if (!fs.existsSync(dataPath)) {
    console.error('MAIN: Apple Notes data path not found...');
    return false;
  }
  
  const hasPermission = store.get('hasAppleNotesFileSystemPermission');
  
  if (hasPermission) {
    console.log('MAIN: Already have permission for Apple Notes folder.');
    return true;
  } else {
    console.log('MAIN: Requesting permission for Apple Notes folder...');
  
    while (true) {
      // Uncomment and replace with the actual dialog when ready
      const { filePaths, canceled } = await dialog.showOpenDialog({
        defaultPath: dataPath,
        properties: ['openDirectory'],
        message:
          'Select the "group.com.apple.notes" folder to allow Readwise to read Apple Notes data.'
      });
  
      console.log('MAIN: Was folder selection canceled?', canceled ? 'Yes' : 'No');
      console.log('MAIN: Selected folder: ', filePaths);
  
      if (canceled) {
        console.log('MAIN: User canceled folder selection. Asking again...');
        mainWindow.webContents.send('toast:show', {
          variant: 'default',
          message: 'Permission is required to proceed. Please select the correct folder.'
        });
        continue; // Retry the loop
      }
  
      if (!filePaths.includes(dataPath)) {
        console.error('MAIN: Did not obtain permission for the correct folder :(');
        mainWindow.webContents.send('toast:show', {
          variant: 'destructive',
          message: 'Did not obtain permission for the correct folder. Please try again.'
        });
        continue; // Retry the loop
      }
  
      console.log('MAIN: Permission granted! 🎉');
      mainWindow.webContents.send('toast:show', {
        variant: 'default',
        message: 'Permission granted! 🎉'
      });
      store.set('hasAppleNotesFileSystemPermission', true);
      return true; // Exit the loop and return success
    }
  }
})

ipcMain.handle('sync-highlights', async (_event, auto?: boolean) => {
  // if sync is already in progress, don't start another one
  if (Boolean(store.get('isSyncing'))) {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toast:show', {
        variant: 'default',
        message: 'Sync already in progress...'
      })
    }
    console.log('Sync already in progress')
    return
  }

  const readwiseSync = new ReadwiseSync(mainWindow, store)
  await readwiseSync.syncHighlights(undefined, auto)

  if (!mainWindow.isDestroyed()) {
    mainWindow.webContents.send('syncing-complete')
  }

  if (store.get('firstSync')) {
    store.set('firstSync', false)
  }

})

ipcMain.handle('connect-to-readwise', async (event: Electron.Event) => {
  event.preventDefault()
  const uuid = getAppleNoteClientID()

  shell.openExternal(`${baseURL}/api_auth?token=${uuid}&service=apple-notes`)

  const token = await getUserAuthToken(uuid)
  if (token) {
    await store.set('token', token)
    mainWindow.webContents.send('login-status', true)
    console.log('Connected to Readwise')
    return 'Connected to Readwise'
  } else {
    console.error('Failed to connect to Readwise')
    mainWindow.webContents.send('login-status', false)
    console.log('Failed to connect to Readwise')
    return 'Failed to connect to Readwise'
  }
})

ipcMain.handle('disconnect-from-readwise', async (event: Electron.Event) => {
  event.preventDefault()
  store.set('token', '')
  store.set('booksToRefresh', [])
  store.set('failedBooks', [])
  store.set('isSyncing', false)
  store.set('booksIDsMap', {})
  store.set('lastSyncFailed', false)
  store.set('rw-AppleNotesClientId', '')
  mainWindow.webContents.send('login-status', false)
  console.log('Disconnected from Readwise')
  return 'success'
})

ipcMain.handle('open-custom-format-window', (event: Electron.Event) => {
  event.preventDefault()
  shell.openExternal(`${baseURL}/export/apple-notes/preferences`)
})

ipcMain.handle('fetch-apple-notes-accounts', async () => {
  return await updateAppleNotesAccounts()
})

ipcMain.handle('update-sync-frequency', async (_event, frequency: string) => {
  return await configureScheduledSync(frequency)
})

async function configureScheduledSync(frequency: string) {
  const minutes = parseInt(frequency)
  let milliseconds = minutes * 60 * 1000 // convert minutes to milliseconds
  console.log('Settings interval to ', milliseconds)
  
  if (!milliseconds) {
    // user set frequency to "Manual"
    return '0'
  }

  // Clear any existing interval
  if (syncInterval) {
    console.log('Clearing existing sync interval...')
    clearInterval(syncInterval);
  }

  syncInterval = setInterval(async () => {
    console.log('Syncing highlights...', new Date())
    const readwiseSync = new ReadwiseSync(mainWindow, store)
    await readwiseSync.syncHighlights(undefined, true)
  }, milliseconds)
  console.log('Scheduled sync interval set to ', frequency)

  return frequency
}

app.on('before-quit', () => {
  if (Boolean(store.get('isSyncing'))) {
    store.set('isSyncing', false)
    store.set('lastSyncFailed', true)
    store.set('currentSyncStatusID', 0)
  }
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
