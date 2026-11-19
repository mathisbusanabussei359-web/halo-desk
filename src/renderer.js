const byId = id => document.getElementById(id)
const toggle = byId('toggle')
const panel = byId('panel')
const input = byId('input')
const messages = byId('messages')
const island = byId('island')
let state = { timer: null, notes: [], tasks: [] }
let busy = false
let finishedUntil = 0
let idle = false
let reaction = ''
let reactionTimeout
let typingTimeout

function renderMood() {
  const mode = reaction || (busy ? 'thinking' : idle ? 'sleep' : state.timer?.end ? 'focus' : 'ready')
  if (island.dataset.mood === mode) return
  island.dataset.mood = mode
  byId('mood').textContent = {
    ready: 'Prêt à t’aider', sleep: 'Petite sieste…', focus: 'En pleine concentration',
    typing: 'Je t’écoute…', thinking: 'Je réfléchis…', celebrate: 'Bien joué !',
    wave: 'Coucou !', reply: 'Et voilà !', error: 'Il y a eu un souci.'
  }[mode]
}

function react(mode, duration = 1500) {
  clearTimeout(reactionTimeout)
  reaction = mode
  renderMood()
  reactionTimeout = setTimeout(() => {
    reaction = ''
    renderMood()
  }, duration)
}

function log(message, type = 'reply') {
  const entry = document.createElement('p')
  entry.className = type
  entry.textContent = message
  messages.append(entry)
  while (messages.childElementCount > 80) messages.firstElementChild.remove()
  messages.scrollTop = messages.scrollHeight
}

function show(view) {
  for (const name of ['assistant', 'notes', 'tasks']) {
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
    react('wave')
  }
}

function renderClock() {
  const remaining = state.timer && Math.max(0, Math.ceil((state.timer.remaining ?? (state.timer.end - Date.now())) / 1000))
  byId('cancel').hidden = !state.timer
  const pause = byId('pause')
  pause.hidden = !state.timer
  pause.dataset.command = state.timer?.remaining ? 'reprendre' : 'pause'
  pause.textContent = state.timer?.remaining ? 'Reprendre' : 'Pause'
  byId('title').textContent = state.timer?.remaining ? 'En pause' : state.timer?.label ?? (Date.now() < finishedUntil ? 'Temps écoulé' : 'Halo Desk')
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
  const tasksChanged = JSON.stringify(state.tasks) !== JSON.stringify(next.tasks)
  state = next
  renderClock()
  renderMood()
  if (notesChanged) renderNotes()
  if (tasksChanged) renderTasks()
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

function renderTasks() {
  const container = byId('tasks')
  container.replaceChildren()
  if (!state.tasks.length) container.textContent = 'Aucune tâche. Essaie « tâche Envoyer le dossier ».'
  for (const [index, task] of state.tasks.entries()) {
    const row = document.createElement('div')
    const title = document.createElement('span')
    const complete = document.createElement('button')
    row.className = 'note'
    title.textContent = `${index + 1}. ${task.text}`
    complete.textContent = 'Terminer'
    complete.setAttribute('aria-label', 'Terminer : ' + task.text)
    complete.addEventListener('click', async () => {
      try {
        if (await window.halo.complete(task.id)) react('celebrate')
        byId('tasks-tab').focus()
      } catch {
        show('assistant')
        log('Impossible de terminer la tâche.')
        react('error')
      }
    })
    row.append(title, complete)
    container.append(row)
  }
}

async function command(value) {
  if (!value.trim() || busy) return
  busy = true
  react('thinking', 500)
  byId('send').disabled = true
  show('assistant')
  log(value, 'request')
  try {
    const result = await window.halo.command(value)
    log(result.message)
    if (result.view) show(result.view)
    react(result.reaction ?? 'reply')
  } catch {
    log('Impossible de terminer cette action.')
    react('error')
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
byId('tasks-tab').addEventListener('click', () => show('tasks'))
input.addEventListener('input', () => {
  clearTimeout(typingTimeout)
  typingTimeout = setTimeout(() => { if (input.value.trim() && !busy) react('typing', 900) }, 80)
})
island.addEventListener('pointermove', event => {
  const middle = island.getBoundingClientRect().width / 2
  island.dataset.look = event.clientX > middle ? 'right' : 'left'
})
island.addEventListener('pointerleave', () => { delete island.dataset.look })
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
renderTasks()
renderClock()
renderMood()
window.halo.onState(update)
window.halo.onFullscreen(value => { island.classList.toggle('fullscreen-hidden', value) })
window.halo.onFinished(label => {
  finishedUntil = Date.now() + 15000
  renderClock()
  log(label + ' terminé.')
  react('celebrate', 4000)
})
window.halo.get().then(result => {
  update(result.state)
  byId('shortcut').textContent = result.shortcut ? 'Ctrl/⌘ + Maj + Espace' : 'Raccourci indisponible'
})
setInterval(renderClock, 250)
setInterval(async () => {
  if (document.hidden) return
  try {
    const wasIdle = idle
    idle = await window.halo.idle()
    if (wasIdle && !idle && !reaction) react('wave')
    else renderMood()
  } catch {
    // Certains environnements de bureau ne fournissent pas l’inactivité système.
  }
}, 300)
