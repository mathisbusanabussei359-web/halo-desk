const byId = id => document.getElementById(id)
const toggle = byId('toggle')
const panel = byId('panel')
const input = byId('input')
const messages = byId('messages')
let state = { timer: null, notes: [] }
let busy = false
let finishedUntil = 0

function log(message, type = 'reply') {
  const entry = document.createElement('p')
  entry.className = type
  entry.textContent = message
  messages.append(entry)
  while (messages.childElementCount > 80) messages.firstElementChild.remove()
  messages.scrollTop = messages.scrollHeight
}

function show(view) {
  for (const name of ['assistant', 'notes']) {
    byId(name).hidden = name !== view
    byId(name + '-tab').setAttribute('aria-pressed', String(name === view))
  }
  if (view === 'assistant') messages.scrollTop = messages.scrollHeight
}

async function expand(value) {
  if (!value) {
    panel.hidden = true
    toggle.focus()
  }
  toggle.setAttribute('aria-expanded', String(value))
  await window.halo.expand(value)
  if (value && toggle.getAttribute('aria-expanded') === 'true') {
    panel.hidden = false
    input.focus()
  }
}

function renderClock() {
  const remaining = state.timer && Math.max(0, Math.ceil((state.timer.end - Date.now()) / 1000))
  byId('island').classList.toggle('running', Boolean(state.timer))
  byId('cancel').hidden = !state.timer
  byId('title').textContent = state.timer?.label ?? (Date.now() < finishedUntil ? 'Temps écoulé' : 'Halo Desk')
  if (remaining === null) {
    byId('clock').textContent = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date())
    return
  }
  const hours = Math.floor(remaining / 3600)
  const minutes = Math.floor(remaining / 60) % 60
  const seconds = remaining % 60
  const parts = hours ? [hours, minutes, seconds] : [minutes, seconds]
  byId('clock').textContent = parts.map(part => String(part).padStart(2, '0')).join(':')
}

function update(next) {
  const notesChanged = JSON.stringify(state.notes) !== JSON.stringify(next.notes)
  state = next
  renderClock()
  if (notesChanged) renderNotes()
}

function renderNotes() {
  const container = byId('notes')
  container.replaceChildren()
  if (!state.notes.length) container.textContent = 'Aucune note enregistrée.'
  for (const note of state.notes) {
    const row = document.createElement('div')
    const content = document.createElement('span')
    const remove = document.createElement('button')
    row.className = 'note'
    content.textContent = note.text
    remove.textContent = 'Supprimer'
    remove.setAttribute('aria-label', 'Supprimer la note : ' + note.text)
    remove.addEventListener('click', async () => {
      try {
        await window.halo.remove(note.id)
        byId('notes-tab').focus()
      } catch {
        show('assistant')
        log('Impossible de supprimer la note.')
      }
    })
    row.append(content, remove)
    container.append(row)
  }
}

async function command(value) {
  if (!value.trim() || busy) return
  busy = true
  byId('send').disabled = true
  show('assistant')
  log(value, 'request')
  try {
    const result = await window.halo.command(value)
    log(result.message)
    if (result.view) show(result.view)
  } catch {
    log('Impossible de terminer cette action.')
  } finally {
    busy = false
    byId('send').disabled = false
  }
}

toggle.addEventListener('click', () => expand(panel.hidden))
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !panel.hidden) expand(false)
})
byId('assistant-tab').addEventListener('click', () => show('assistant'))
byId('notes-tab').addEventListener('click', () => show('notes'))
byId('command').addEventListener('submit', event => {
  event.preventDefault()
  if (busy || !input.value.trim()) return
  const value = input.value
  input.value = ''
  input.focus()
  command(value)
})
for (const button of document.querySelectorAll('[data-command]')) {
  button.addEventListener('click', () => command(button.dataset.command))
}
byId('hide').addEventListener('click', () => window.halo.hide())
byId('quit').addEventListener('click', () => window.halo.quit())

renderNotes()
renderClock()
window.halo.onState(update)
window.halo.onFinished(label => {
  finishedUntil = Date.now() + 15000
  renderClock()
  log(label + ' terminé.')
})
window.halo.get().then(result => {
  update(result.state)
  byId('shortcut').textContent = result.shortcut ? 'Ctrl/⌘ + Maj + Espace' : 'Raccourci indisponible'
})
setInterval(renderClock, 250)
