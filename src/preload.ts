// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
    sendNotification: (message: string) => {
        ipcRenderer.send('send-notification', message);
    },
    store: {
        get(key: string) {
            return ipcRenderer.sendSync('electron-store-get', key);
        },
        set(key: string, value: any) {
            ipcRenderer.send('electron-store-set', key, value);
        }
    },
    readwise: {
        connectToReadwise() {
            return ipcRenderer.invoke('connect-to-readwise');
        },
        syncHighlights() {
            return ipcRenderer.invoke('sync-highlights');
        },
        openCustomFormatWindow() {
            ipcRenderer.invoke('open-custom-format-window');
        }
    },
})