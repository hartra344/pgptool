const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('pgp', {
  listKeys: invoke('keys:list'),
  generateKey: invoke('keys:generate'),
  importText: invoke('keys:importText'),
  importFile: invoke('keys:importFile'),
  deleteKey: invoke('keys:delete'),
  exportKey: invoke('keys:export'),
  exportKeyFile: invoke('keys:exportFile'),
  lockSession: invoke('session:lock'),
  encrypt: invoke('pgp:encrypt'),
  decrypt: invoke('pgp:decrypt'),
});
