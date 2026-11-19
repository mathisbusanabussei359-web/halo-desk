const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('halo', {
  get: () => ipcRenderer.invoke('halo:get'),
  idle: () => ipcRenderer.invoke('halo:idle'),
  expand: value => ipcRenderer.invoke('halo:expand', value),
  hide: () => ipcRenderer.invoke('halo:hide'),
  quit: () => ipcRenderer.invoke('halo:quit'),
  command: value => ipcRenderer.invoke('halo:command', value),
  remove: id => ipcRenderer.invoke('halo:remove', id),
  complete: id => ipcRenderer.invoke('halo:complete', id),
  onState: callback => { ipcRenderer.on('halo:state', (_event, state) => callback(state)) },
  onFullscreen: callback => { ipcRenderer.on('halo:fullscreen', (_event, value) => callback(value)) },
  onFinished: callback => { ipcRenderer.on('halo:finished', (_event, label) => callback(label)) }
})
