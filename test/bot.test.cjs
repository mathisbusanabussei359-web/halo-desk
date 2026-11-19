const { test } = require('node:test')
const assert = require('node:assert/strict')
const { runCommand, calculate } = require('../src/bot.cjs')
const empty = { notes: [], timer: null }

test('priorité, signes, parenthèses et virgules décimales', () => {
  assert.equal(calculate('-(2 + 3) * -4 + 0,5'), '20,5')
  assert.equal(calculate('1 + 3 * 2'), '7')
  assert.throws(() => calculate('2 / 0'), /Division/)
  assert.throws(() => calculate('2 ** 10'))
  assert.throws(() => calculate('process.exit()'))
  assert.throws(() => calculate('(3+4'))
})

test('durées et échéances', () => {
  assert.deepEqual(runCommand('minuteur 90s', empty, 10).patch.timer, { label: 'Minuteur', end: 90010 })
  assert.equal(runCommand('focus', empty, 10).patch.timer.end, 1500010)
  assert.equal(runCommand('minuteur 5', empty, 10).patch.timer.end, 300010)
  assert.equal(runCommand('minuteur 24h', empty, 10).patch.timer.end, 86400010)
  for (const value of ['minuteur 0', 'minuteur 25h', 'minuteur 1e2', 'minuteur 5x']) {
    assert.equal(runCommand(value, empty).patch, undefined)
  }
  const running = { ...empty, ...runCommand('focus', empty).patch }
  assert.match(runCommand('minuteur 5m', running).message, /remplacé/)
  assert.deepEqual(runCommand('annuler', running).patch, { timer: null })
})

test('notes, texte copié et destinations autorisées', () => {
  const result = runCommand('note Appeler Léa', empty)
  assert.equal(result.patch.notes[0].text, 'Appeler Léa')
  assert.equal(empty.notes.length, 0)
  assert.equal(runCommand('notes', result.patch).view, 'notes')
  assert.equal(runCommand('note ' + 'a'.repeat(501), empty).patch, undefined)
  assert.equal(runCommand('copier Bonjour !', empty).copy, 'Bonjour !')
  assert.equal(runCommand('ouvrir GitHub', empty).url, 'https://github.com/')
  assert.equal(runCommand('ouvrir file:///tmp/test', empty).url, undefined)
  assert.equal(runCommand('ouvrir __proto__', empty).url, undefined)
})

test('pause et reprise conservent le temps restant', () => {
  const state = { ...empty, timer: { end: 65000, label: 'Focus' } }
  const paused = runCommand('pause', state, 5000).patch
  assert.deepEqual(paused.timer, { remaining: 60000, label: 'Focus' })
  assert.equal(runCommand('pause', paused, 6000).patch, undefined)
  assert.deepEqual(runCommand('reprendre', paused, 90000).patch.timer, { end: 150000, label: 'Focus' })
  assert.equal(runCommand('pause', state, 65000).patch, undefined)
})

test('tâches numérotées et commandes de jeu', () => {
  const first = runCommand('tâche Envoyer le dossier', empty).patch
  const second = runCommand('tache Lire la réponse', first).patch
  assert.equal(runCommand('tâches', second).view, 'tasks')
  assert.equal(runCommand('fait 0', second).patch, undefined)
  assert.deepEqual(runCommand('fait 1', second).patch.tasks, [second.tasks[1]])
  assert.match(runCommand('dé 2', empty).message, /faces : [12]\./)
  assert.match(runCommand('pile ou face', empty).message, /^(Pile|Face) !$/)
})

test('plusieurs formulations lancent le même minuteur', () => {
  const expected = runCommand('minuteur 5m', empty, 100)
  for (const text of ['minuteur 5 minutes', 'Lance un minuteur de 5 minutes !',
    'Peux-tu démarrer un chrono pour 5 min ?', 'mets un minuteur de 5 minutes s’il te plaît']) {
    assert.deepEqual(runCommand(text, empty, 100), expected, text)
  }
  assert.equal(runCommand('lance un pomodoro de 1,5 heure', empty, 0).patch.timer.end, 5400000)
  assert.equal(runCommand('minuteur 90 secondes', empty, 0).patch.timer.end, 90000)
  assert.equal(runCommand('lance un minuteur de 25 heures', empty).patch, undefined)
})

test('les formulations naturelles préservent le contenu saisi', () => {
  const note = runCommand('Peux-tu prendre une note', empty)
  assert.equal(note.patch, undefined)
  assert.equal(runCommand('Prends une note : Écrire à Éloïse !', empty).patch.notes[0].text, 'Écrire à Éloïse !')
  assert.equal(runCommand('Ajoute une tâche : Lire le dossier.', empty).patch.tasks[0].text, 'Lire le dossier.')
  assert.equal(runCommand('Montre-moi mes notes ?', empty).view, 'notes')
  assert.equal(runCommand('Ouvre GitHub !', empty).url, 'https://github.com/')
  assert.equal(runCommand('Calcule 5 * 3', empty).message, 'Résultat : 15')
  const active = { ...empty, ...runCommand('minuteur 5m', empty, 0).patch }
  assert.equal(runCommand('Mets le minuteur en pause', active, 2000).patch.timer.remaining, 298000)
})
