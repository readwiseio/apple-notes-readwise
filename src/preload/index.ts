// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  getStoreValue: (key: string) => {
    return ipcRenderer.invoke('electron-store-get', key)
  },
  setStoreValue: (key: string, value: any) => {
    ipcRenderer.send('electron-store-set', key, value)
  },
  getUserAccounts: () => {
    return ipcRenderer.invoke('fetch-apple-notes-accounts')
  },
  readwise: {
    connectToReadwise() {
      return ipcRenderer.invoke('connect-to-readwise')
    },
    syncHighlights() {
      return ipcRenderer.invoke('sync-highlights')
    },
    updateSyncFrequency(frequency: string) {
      return ipcRenderer.invoke('update-sync-frequency', frequency)
    },
    openCustomFormatWindow() {
      ipcRenderer.invoke('open-custom-format-window')
    }
  },
  on: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.on(channel, listener)
  },
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel)
  }
})
