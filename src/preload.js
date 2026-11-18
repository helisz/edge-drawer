const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (patch) => ipcRenderer.invoke('save-config', patch),
  copyFile: (p) => ipcRenderer.invoke('copy-file', p),
  deleteFile: (p) => ipcRenderer.invoke('delete-file', p),
  openFile: (p) => ipcRenderer.invoke('open-file', p),
  openStoreDir: () => ipcRenderer.invoke('open-store-dir'),
  closeDrawer: () => ipcRenderer.invoke('close-drawer'),
  onState: (cb) => ipcRenderer.on('drawer-state', (e, s) => cb(s)),
  dragEnter: () => ipcRenderer.send('drag-enter')
});
