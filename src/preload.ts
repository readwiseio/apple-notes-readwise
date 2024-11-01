// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("api", {
  getStoreValue: (key: string) => {
    return ipcRenderer.invoke("electron-store-get", key);
  },
  setStoreValue: (key: string, value: any) => {
    ipcRenderer.send("electron-store-set", key, value);
  },
  readwise: {
    connectToReadwise() {
      return ipcRenderer.invoke("connect-to-readwise");
    },
    syncHighlights(baseFolder: string) {
      return ipcRenderer.invoke("sync-highlights", baseFolder);
    },
    openCustomFormatWindow() {
      ipcRenderer.invoke("open-custom-format-window");
    },
  },
  on: (channel: string, listener: (...args: any[]) => void) => {
    ipcRenderer.on(channel, listener);
  },
  removeAllListener: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
