const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('pgp', {
  listKeys: invoke('keys:list'),
  keyDetails: invoke('keys:details'),
  generateKey: invoke('keys:generate'),
  importText: invoke('keys:importText'),
  importFile: invoke('keys:importFile'),
  deleteKey: invoke('keys:delete'),
  exportKey: invoke('keys:export'),
  exportKeyFile: invoke('keys:exportFile'),
  exportAll: invoke('keys:exportAll'),
  lockSession: invoke('session:lock'),
  encrypt: invoke('pgp:encrypt'),
  decrypt: invoke('pgp:decrypt'),
  appInfo: invoke('app:info'),
  checkForUpdates: invoke('update:check'),
  installUpdate: invoke('update:install'),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
});
