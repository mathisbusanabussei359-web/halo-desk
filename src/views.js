const feedback = byId('feedback')
let feedbackTimeout
const audio = byId('audio')
let currentTrack
let weatherStarted = false
let weatherBusy = false

function tell(message) {
  clearTimeout(feedbackTimeout)
  feedback.textContent = message
  feedback.hidden = false
  feedbackTimeout = setTimeout(() => { feedback.hidden = true }, 4500)
}

function labelFor(entry) {
  return entry.path.split(/[\\/]/).at(-1) || entry.path
}

function action(label, accessibleName, callback) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  if (accessibleName) button.setAttribute('aria-label', accessibleName)
  button.addEventListener('click', callback)
  return button
}

function renderPaths(isAudio) {
  const items = isAudio ? state.tracks : state.files
  const list = byId(isAudio ? 'track-list' : 'file-list')
  list.replaceChildren()
  if (!items.length) list.textContent = isAudio ? 'Ajoute des morceaux depuis ton ordinateur.' : 'Aucun fichier épinglé.'
  for (const entry of items) {
    const row = document.createElement('div')
    const name = document.createElement('span')
    const label = labelFor(entry)
    const buttons = document.createElement('div')
    buttons.className = 'quick'
    row.className = 'list-row'
    name.textContent = label
    name.title = entry.path
    const open = isAudio
      ? action('Lire', 'Lire ' + label, () => playTrack(entry))
      : action('Afficher', 'Afficher ' + label + ' dans son dossier', async () => {
        try { await window.halo.revealFile(entry.id) }
        catch { tell('Ce fichier a été déplacé ou supprimé.') }
      })
    const remove = action('Retirer', 'Retirer ' + label, async () => {
      try { await window.halo.removeFile(entry.id, isAudio) }
      catch { tell('Impossible de retirer cet élément.') }
    })
    buttons.append(open, remove)
    row.append(name, buttons)
    list.append(row)
  }
}

function playTrack(track) {
  currentTrack = track.id
  byId('track-name').textContent = labelFor(track)
  audio.parentElement.hidden = false
  audio.src = 'halo-audio://track/' + encodeURIComponent(track.id)
  audio.play().catch(error => {
    if (error.name !== 'AbortError') tell('Lecture impossible. Vérifie le fichier audio.')
  })
}

function stepTrack(direction, wrap = true) {
  const index = state.tracks.findIndex(entry => entry.id === currentTrack)
  const length = state.tracks.length
  if (!length || (!wrap && index + direction === length)) return
  playTrack(state.tracks[(index + direction + length) % length])
}

function updateViews(previous) {
  island.dataset.motion = state.settings.motion ? 'on' : 'off'
  island.dataset.position = state.settings.position
  for (const control of document.querySelectorAll('[data-setting]')) {
    const value = state.settings[control.dataset.setting]
    if (control.type === 'checkbox') control.checked = value
    else control.value = value
  }
  if (JSON.stringify(previous.files) !== JSON.stringify(state.files)) renderPaths(false)
  if (JSON.stringify(previous.tracks) !== JSON.stringify(state.tracks)) {
    renderPaths(true)
    if (currentTrack && !state.tracks.some(entry => entry.id === currentTrack)) {
      currentTrack = undefined
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      audio.parentElement.hidden = true
    }
  }
}

async function chooseFiles(isAudio) {
  const button = byId(isAudio ? 'add-tracks' : 'add-files')
  button.disabled = true
  try { await window.halo.addFiles(isAudio) }
  catch { tell('Impossible d’enregistrer la sélection.') }
  finally { button.disabled = false }
}

const dayFormat = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', timeZone: 'UTC' })

function describeWeather(code) {
  if (code === 0) return 'Ciel dégagé'
  if (code < 4) return 'Nuageux'
  if (code < 50) return 'Brouillard'
  if (code < 60) return 'Bruine'
  if (code < 70) return 'Pluie'
  if (code < 80) return 'Neige'
  if (code < 85) return 'Averses'
  if (code < 90) return 'Averses de neige'
  return 'Orages'
}

async function showForecast(place) {
  if (weatherBusy) return
  weatherBusy = true
  byId('weather-status').textContent = 'Chargement de la météo…'
  const form = byId('weather-form')
  form.querySelector('button').disabled = true
  byId('refresh-weather').disabled = true
  try {
    const { current, daily } = await window.halo.weather(place)
    byId('weather-place').textContent = place.label
    byId('temperature').textContent = Math.round(current.temperature_2m) + ' °C'
    byId('conditions').textContent = describeWeather(current.weather_code) + ' · Ressenti ' + Math.round(current.apparent_temperature) + ' °C'
    byId('weather-days').replaceChildren(...daily.time.map((date, index) => {
      const row = document.createElement('div')
      row.className = 'list-row'
      const day = document.createElement('span')
      const temperature = document.createElement('span')
      day.textContent = dayFormat.format(new Date(date + 'T00:00:00Z')) + ' · ' + describeWeather(daily.weather_code[index])
      temperature.textContent = Math.round(daily.temperature_2m_min[index]) + '° / ' + Math.round(daily.temperature_2m_max[index]) + '°'
      row.append(day, temperature)
      return row
    }))
    byId('places').replaceChildren()
    byId('forecast').hidden = false
    byId('weather-status').textContent = ''
  } catch {
    byId('weather-status').textContent = 'Météo indisponible. Réessaie dans un instant.'
  } finally {
    weatherBusy = false
    form.querySelector('button').disabled = false
    byId('refresh-weather').disabled = false
  }
}

function openWeather() {
  if (weatherStarted || !state.place) return
  weatherStarted = true
  showForecast(state.place)
}

byId('weather-form').addEventListener('submit', async event => {
  event.preventDefault()
  const query = byId('city-input').value.trim()
  if (weatherBusy || query.length < 2) return
  weatherBusy = true
  const button = event.currentTarget.querySelector('button')
  button.disabled = true
  const status = byId('weather-status')
  status.textContent = 'Recherche…'
  byId('places').replaceChildren()
  try {
    const places = await window.halo.places(query)
    status.textContent = places.length ? 'Choisis une ville.' : 'Aucune ville trouvée.'
    for (const place of places) byId('places').append(action(place.label, null, () => {
      weatherStarted = true
      showForecast(place)
    }))
  } catch {
    status.textContent = 'Recherche indisponible. Vérifie ta connexion.'
  } finally {
    weatherBusy = false
    button.disabled = false
  }
})

byId('refresh-weather').addEventListener('click', () => { if (state.place) showForecast(state.place) })
byId('add-files').addEventListener('click', () => chooseFiles(false))
byId('add-tracks').addEventListener('click', () => chooseFiles(true))
byId('previous-track').addEventListener('click', () => stepTrack(-1))
byId('next-track').addEventListener('click', () => stepTrack(1))
audio.addEventListener('ended', () => stepTrack(1, false))
audio.addEventListener('error', () => { if (currentTrack) tell('Ce morceau ne peut pas être lu.') })

for (const control of document.querySelectorAll('[data-setting]')) {
  control.addEventListener('change', async () => {
    try {
      await window.halo.setting(control.dataset.setting, control.type === 'checkbox' ? control.checked : control.value)
    } catch {
      updateViews(state)
      tell('Impossible d’enregistrer le réglage.')
    }
  })
}

for (const [kind, prefix, collection] of [['task', 'tâche', 'tasks'], ['note', 'note', 'notes']]) {
  byId(kind + '-form').addEventListener('submit', async event => {
    event.preventDefault()
    const field = byId(kind + '-input')
    const submit = event.currentTarget.querySelector('button')
    if (submit.disabled || !field.value.trim()) return
    if (state[collection].length >= 100) {
      tell('Limite de 100 éléments atteinte.')
      return
    }
    submit.disabled = true
    try {
      const result = await window.halo.command(prefix + ' ' + field.value)
      tell(result.message)
      if (['Tâche ajoutée.', 'Note enregistrée.'].includes(result.message)) field.value = ''
    } catch {
      tell('Impossible d’enregistrer cet élément.')
    } finally {
      submit.disabled = false
    }
  })
}

renderPaths(false)
renderPaths(true)
