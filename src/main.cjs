const { app, BrowserWindow, Menu, Tray, Notification, clipboard, globalShortcut, ipcMain, nativeImage, screen, shell, powerMonitor, dialog, protocol, net } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { runCommand } = require('./bot.cjs')
const { watchFullscreen } = require('./fullscreen.cjs')
const { readSettings, validSetting, audioTypes, mediaType, serveAudio, searchPlaces, forecast, validPlace } = require('./dashboard.cjs')

protocol.registerSchemesAsPrivileged([{ scheme: 'halo-audio', privileges: { standard: true, secure: true, stream: true } }])

let window
let tray
let alarm
let expanded = false
let quitting = false
let shortcut = false
let manuallyHidden = false
let fullscreen = false
let hideDelay
let stopFullscreen
let lastMouse
let lastMotion = performance.now()
let state = { notes: [], tasks: [], files: [], tracks: [], timer: null, settings: readSettings(), place: null }

const file = () => path.join(app.getPath('userData'), 'halo.json')

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'))
    const entries = list => Array.isArray(list) ? list.filter(entry =>
      typeof entry?.id === 'string' && typeof entry.text === 'string').slice(0, 100) : []
    const paths = list => Array.isArray(list) ? list.filter(entry => typeof entry?.id === 'string' &&
      typeof entry.path === 'string' && path.isAbsolute(entry.path)).slice(0, 100) : []
    const timer = saved.timer
    const validTimer = ['Focus', 'Minuteur'].includes(timer?.label) &&
      (Number.isFinite(timer.end) || (Number.isFinite(timer.remaining) && timer.remaining > 0))
    state = {
      notes: entries(saved.notes), tasks: entries(saved.tasks), timer: validTimer ? timer : null,
      files: paths(saved.files), tracks: paths(saved.tracks).filter(entry => mediaType(entry.path)),
      settings: readSettings(saved.settings), place: validPlace(saved.place) ? saved.place : null
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Données locales illisibles', error)
  }
}

function save(patch) {
  const next = { ...state, ...patch }
  const target = file()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target + '.tmp', JSON.stringify(next), { mode: 0o600 })
  fs.renameSync(target + '.tmp', target)
  state = next
}

function publish() {
  if (window && !window.isDestroyed()) window.webContents.send('halo:state', state)
}

function schedule() {
  clearTimeout(alarm)
  if (!state.timer?.end) return
  alarm = setTimeout(() => {
    if (state.timer.end > Date.now()) return schedule()
    const { label } = state.timer
    try {
      save({ timer: null })
    } catch (error) {
      console.error('Impossible de clôturer le minuteur', error)
      alarm = setTimeout(schedule, 10000)
      return
    }
    publish()
    if (state.settings.notifications && Notification.isSupported()) {
      new Notification({ title: 'Halo Desk', body: label + ' terminé.' }).show()
    }
    window?.webContents.send('halo:finished', label)
  }, Math.max(0, Math.min(2 ** 31 - 1, state.timer.end - Date.now())))
}

function layout() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  const w = Math.min(width, expanded ? 520 : 156)
  const h = Math.min(Math.max(1, height - 18), expanded ? 574 : 42)
  const edge = Math.max(0, Math.min(14, width - w))
  const offset = { left: edge, center: Math.round((width - w) / 2), right: width - w - edge }
  window.setBounds({ x: x + offset[state.settings.position], y: y + 9, width: w, height: h })
}

function toggleVisibility() {
  setManuallyHidden(!manuallyHidden)
}

function setManuallyHidden(value) {
  manuallyHidden = value
  if (value) window.hide()
  else if (!fullscreen) {
    layout()
    window.show()
  }
}

function updateFullscreen(value) {
  if (quitting || fullscreen === value) return
  fullscreen = value
  clearTimeout(hideDelay)
  window.webContents.send('halo:fullscreen', value)
  if (value && window.isVisible()) {
    hideDelay = setTimeout(() => window.hide(), state.settings.motion ? 220 : 0)
  } else if (!value && !manuallyHidden) {
    layout()
    window.showInactive()
  }
}

function mouseIdle() {
  if (!state.settings.sleep) return false
  if (process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland' &&
      app.commandLine.getSwitchValue('ozone-platform') !== 'x11') {
    return powerMonitor.getSystemIdleTime() >= 30
  }
  const point = screen.getCursorScreenPoint()
  if (!lastMouse || lastMouse.x !== point.x || lastMouse.y !== point.y) {
    lastMouse = point
    lastMotion = performance.now()
  }
  return performance.now() - lastMotion >= 30000
}

function syncFullscreen() {
  stopFullscreen?.()
  stopFullscreen = state.settings.fullscreen ? watchFullscreen(updateFullscreen, () => screen.getPrimaryDisplay().bounds) : undefined
  if (!state.settings.fullscreen) updateFullscreen(false)
}

async function addPaths(kind) {
  const tracks = kind === 'tracks'
  const options = { title: tracks ? 'Ajouter de la musique' : 'Épingler des fichiers', properties: ['openFile', 'multiSelections'] }
  if (tracks) options.filters = [{ name: 'Audio', extensions: Object.keys(audioTypes).map(ext => ext.slice(1)) }]
  const { filePaths } = await dialog.showOpenDialog(window, options)
  const current = state[kind]
  const selected = [...new Set(filePaths)].filter(file =>
    path.isAbsolute(file) && (!tracks || mediaType(file)) && !current.some(item => item.path === file))
  if (!selected.length || current.length >= 100) return 0
  const added = selected.slice(0, 100 - current.length).map(file => ({ id: randomUUID(), path: file }))
  save({ [kind]: [...current, ...added] })
  publish()
  return added.length
}

function guard(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== event.sender.mainFrame) throw new Error('Accès refusé.')
    return callback(...args)
  })
}

function start() {
  app.setAppUserModelId('io.halodesk.desktop')
  loadState()
  protocol.handle('halo-audio', request => serveAudio(request, state.tracks))
  window = new BrowserWindow({
    title: 'Halo Desk',
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('close', event => {
    if (!quitting) {
      event.preventDefault()
      setManuallyHidden(true)
    }
  })
  screen.on('display-metrics-changed', layout)
  screen.on('display-added', layout)
  screen.on('display-removed', layout)

  guard('halo:get', () => ({ state, shortcut }))
  guard('halo:idle', mouseIdle)
  guard('halo:expand', value => {
    expanded = value === true
    layout()
  })
  guard('halo:hide', () => setManuallyHidden(true))
  guard('halo:setting', (key, value) => {
    if (!validSetting(key, value)) throw new Error('Réglage invalide.')
    if (state.settings[key] === value) return
    save({ settings: { ...state.settings, [key]: value } })
    if (key === 'position') layout()
    if (key === 'fullscreen') syncFullscreen()
    if (key === 'sleep') lastMotion = performance.now()
    publish()
  })
  guard('halo:add-files', audio => addPaths(audio === true ? 'tracks' : 'files'))
  guard('halo:remove-file', (id, audio) => {
    const key = audio === true ? 'tracks' : 'files'
    save({ [key]: state[key].filter(entry => entry.id !== id) })
    publish()
  })
  guard('halo:reveal-file', async id => {
    const entry = state.files.find(file => file.id === id)
    if (!entry) throw new Error('Fichier introuvable.')
    await fs.promises.access(entry.path)
    shell.showItemInFolder(entry.path)
  })
  guard('halo:places', query => {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) return []
    return searchPlaces(query.trim(), net.fetch)
  })
  guard('halo:weather', async place => {
    if (!validPlace(place)) throw new Error('Ville invalide.')
    const result = await forecast(place, net.fetch)
    const selected = { label: place.label, lat: place.lat, lon: place.lon }
    if (JSON.stringify(state.place) !== JSON.stringify(selected)) {
      save({ place: selected })
      publish()
    }
    return result
  })
  guard('halo:quit', () => app.quit())
  guard('halo:remove', id => {
    save({ notes: state.notes.filter(note => note.id !== id) })
    publish()
  })
  guard('halo:complete', id => {
    const tasks = state.tasks.filter(task => task.id !== id)
    if (tasks.length === state.tasks.length) return false
    save({ tasks })
    publish()
    return true
  })
  guard('halo:command', async value => {
    if (typeof value !== 'string' || value.length > 1200) return { message: 'Commande trop longue.' }
    const result = runCommand(value, state)
    if (result.patch) {
      save(result.patch)
      if (Object.hasOwn(result.patch, 'timer')) schedule()
      publish()
    }
    if (result.copy) clipboard.writeText(result.copy)
    if (result.url) await shell.openExternal(result.url)
    return { message: result.message, view: result.view, reaction: result.reaction }
  })

  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png')).resize({ width: 20, height: 20 })
  tray = new Tray(icon)
  tray.setToolTip('Halo Desk')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Afficher / masquer', click: toggleVisibility },
    { label: 'Quitter Halo Desk', click: () => app.quit() }
  ]))
  if (process.platform !== 'linux') tray.on('click', toggleVisibility)
  shortcut = globalShortcut.register('CommandOrControl+Shift+Space', toggleVisibility)
  if (process.platform === 'darwin') app.dock.hide()

  window.once('ready-to-show', () => {
    layout()
    window.showInactive()
    schedule()
    syncFullscreen()
  })
  window.loadFile(path.join(__dirname, 'index.html'))
  powerMonitor.on('resume', schedule)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => { if (window) setManuallyHidden(false) })
  app.on('activate', () => { if (window) setManuallyHidden(false) })
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => {
    stopFullscreen?.()
    clearTimeout(hideDelay)
    globalShortcut.unregisterAll()
  })
  app.whenReady().then(start).catch(error => {
    console.error(error)
    app.quit()
  })
}
