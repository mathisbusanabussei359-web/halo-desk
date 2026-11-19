const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('halo', {
  get: () => ipcRenderer.invoke('halo:get'),
  expand: value => ipcRenderer.invoke('halo:expand', value),
  hide: () => ipcRenderer.invoke('halo:hide'),
  quit: () => ipcRenderer.invoke('halo:quit'),
  command: value => ipcRenderer.invoke('halo:command', value),
  remove: id => ipcRenderer.invoke('halo:remove', id),
  onState: callback => { ipcRenderer.on('halo:state', (_event, state) => callback(state)) },
  onFinished: callback => { ipcRenderer.on('halo:finished', (_event, label) => callback(label)) }
})
