const { contextBridge, ipcRenderer } = require('electron');
const call = (c) => (a) => ipcRenderer.invoke(c, a);
contextBridge.exposeInMainWorld('clock', {
  get: call('get'), install: call('install'), recheck: call('recheck'), site: call('site'), reorder: call('reorder'), stats: call('stats'), start: call('start'), stop: call('stop'), add: call('add'), remove: call('remove'), hide: call('hide'),
  onState: (cb) => { const f = (_, s) => cb(s); ipcRenderer.on('state', f); return () => ipcRenderer.off('state', f); },
});
