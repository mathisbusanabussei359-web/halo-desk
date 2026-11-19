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
