const { app, BrowserWindow, Menu, Tray, Notification, clipboard, globalShortcut, ipcMain, nativeImage, screen, shell, powerMonitor } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { runCommand } = require('./bot.cjs')

let window
let tray
let alarm
let expanded = false
let quitting = false
let shortcut = false
let state = { notes: [], timer: null }

const file = () => path.join(app.getPath('userData'), 'halo.json')

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(file(), 'utf8'))
    const notes = Array.isArray(saved.notes) ? saved.notes.filter(note =>
      typeof note?.id === 'string' && typeof note.text === 'string').slice(0, 100) : []
    const timer = Number.isFinite(saved.timer?.end) && ['Focus', 'Minuteur'].includes(saved.timer?.label) ? saved.timer : null
    state = { notes, timer }
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
  if (!state.timer) return
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
    if (Notification.isSupported()) {
      new Notification({ title: 'Halo Desk', body: label + ' terminé.' }).show()
    }
    window?.webContents.send('halo:finished', label)
  }, Math.max(0, Math.min(2 ** 31 - 1, state.timer.end - Date.now())))
}

function layout() {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  const w = Math.min(width, expanded ? 414 : 304)
  const h = Math.min(Math.max(1, height - 18), expanded ? 498 : 58)
  window.setBounds({ x: x + Math.round((width - w) / 2), y: y + 9, width: w, height: h })
}

function toggleVisibility() {
  if (window.isVisible()) window.hide()
  else {
    layout()
    window.show()
  }
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
      window.hide()
    }
  })
  screen.on('display-metrics-changed', layout)
  screen.on('display-added', layout)
  screen.on('display-removed', layout)

  guard('halo:get', () => ({ state, shortcut }))
  guard('halo:expand', value => {
    expanded = value === true
    layout()
  })
  guard('halo:hide', () => window.hide())
  guard('halo:quit', () => app.quit())
  guard('halo:remove', id => {
    save({ notes: state.notes.filter(note => note.id !== id) })
    publish()
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
    return { message: result.message, view: result.view }
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
  })
  window.loadFile(path.join(__dirname, 'index.html'))
  powerMonitor.on('resume', schedule)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => window?.show())
  app.on('activate', () => window?.show())
  app.on('before-quit', () => { quitting = true })
  app.on('will-quit', () => globalShortcut.unregisterAll())
  app.whenReady().then(start).catch(error => {
    console.error(error)
    app.quit()
  })
}
