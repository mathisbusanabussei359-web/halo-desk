const { randomUUID, randomInt } = require('node:crypto')

const destinations = Object.freeze({
  agenda: 'https://calendar.google.com/',
  github: 'https://github.com/',
  traduction: 'https://www.deepl.com/translator'
})

const help = [
  'Temps · lance un minuteur de 5 minutes, focus 25m, mets en pause, reprends le minuteur, annule le minuteur',
  'Organisation · note Acheter du café, notes, tâche Envoyer le dossier, tâches, fait 1',
  'Outils · calc (12 + 3) * 4, copier mon texte, dé 20, pile ou face, ouvrir agenda'
].join('\n')

function interpret(input) {
  const text = input.trim()
    .replace(/^(?:peux-tu|tu peux)\s+/i, '')
    .replace(/^s['’]il te plaît[, ]+/i, '')
  const sentence = text.replace(/[.!?]+$/, '').trim().replace(/\s+s['’]il te plaît$/i, '')
  if (/^(?:mets? (?:le minuteur )?en pause|suspends? le minuteur)$/i.test(sentence)) return ['pause', '']
  if (/^(?:reprends?|relance) le minuteur$/i.test(sentence)) return ['reprendre', '']
  if (/^(?:annule|arrête|arrete|stoppe) (?:le |mon )?(?:minuteur|chrono|focus)$/i.test(sentence)) return ['annuler', '']
  if (/^(?:affiche|montre)(?:-moi)? (?:mes|les) notes$/i.test(sentence)) return ['notes', '']
  if (/^(?:affiche|montre)(?:-moi)? (?:mes|les) t[âa]ches$/i.test(sentence)) return ['tâches', '']
  if (/^(?:quelle heure est-il|quelle est la date|on est quel jour)$/i.test(sentence)) return ['date', '']

  const timer = sentence.match(/^(?:(?:lance[rz]?|démarre[rz]?|demarre[rz]?|mets?|mettre|programme[rz]?|règle[rz]?)\s+(?:(?:moi\s+)?(?:un|le)\s+)?)?(minuteur|chrono|focus|pomodoro)(?:\s+(?:(?:de|pour|sur)\s+)?(.+))?$/i)
  if (timer) return [/(focus|pomodoro)/i.test(timer[1]) ? 'focus' : 'minuteur', timer[2] ?? '']

  const phrase = text.match(/^(?:ajoute (?:une )?t[âa]che|note que|prends une note|termine (?:la )?t[âa]che|calcule|ouvre|copie)(?:\s*:\s*|\s+)([\s\S]+)$/i)
  if (phrase) {
    const firstWord = phrase[0].match(/^\w+/)[0].toLowerCase()
    const command = { ajoute: 'tâche', note: 'note', prends: 'note', termine: 'fait', calcule: 'calc', ouvre: 'ouvrir', copie: 'copier' }
    return [command[firstWord], phrase[1]]
  }
  const [, raw = '', argument = ''] = text.match(/^(\S+)(?:\s+([\s\S]+))?$/) ?? []
  return [raw.toLowerCase(), argument]
}

function durationSeconds(text) {
  const match = text.match(/^(\d+(?:[.,]\d+)?)\s*(s(?:ec(?:ondes?)?)?|m(?:in(?:utes?)?)?|h(?:eures?)?)?$/i)
  if (!match) return 0
  const unit = match[2]?.[0].toLowerCase() ?? 'm'
  return Number(match[1].replace(',', '.')) * { s: 1, m: 60, h: 3600 }[unit]
}

function calculate(input) {
  const tokens = input.match(/\d+(?:[.,]\d+)?|[^\s]/g) ?? []
  if (tokens.length > 150) throw new Error('Calcul trop long.')
  let index = 0

  function factor() {
    const token = tokens[index++]
    if (token === '+') return factor()
    if (token === '-') return -factor()
    if (token === '(') {
      const value = expression()
      if (tokens[index++] !== ')') throw new Error('Parenthèse fermante attendue.')
      return value
    }
    if (!/^\d+(?:[.,]\d+)?$/.test(token ?? '')) throw new Error('Nombre attendu.')
    return Number(token.replace(',', '.'))
  }

  function product() {
    let value = factor()
    while (['*', '/'].includes(tokens[index])) {
      const operator = tokens[index++]
      const right = factor()
      if (operator === '/' && right === 0) throw new Error('Division par zéro.')
      value = operator === '*' ? value * right : value / right
    }
    return value
  }

  function expression() {
    let value = product()
    while (['+', '-'].includes(tokens[index])) {
      const operator = tokens[index++]
      const right = product()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  const value = expression()
  if (index !== tokens.length || !Number.isFinite(value)) throw new Error('Expression invalide.')
  return new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 14 }).format(value)
}

function runCommand(input, state, now = Date.now()) {
  const [raw, argument] = interpret(input)
  const tasks = state.tasks ?? []
  switch (raw.toLowerCase()) {
    case 'aide': return { message: help }
    case 'minuteur':
    case 'focus': {
      const seconds = durationSeconds(argument || (raw === 'focus' ? '25m' : ''))
      if (seconds < 1 || seconds > 86400) return { message: 'Indique une durée de 1 seconde à 24 heures. Exemple : minuteur 90s.' }
      const label = raw === 'focus' ? 'Focus' : 'Minuteur'
      return { message: state.timer ? 'Minuteur remplacé.' : label + ' lancé.', patch: { timer: { end: now + seconds * 1000, label } } }
    }
    case 'annuler':
      return state.timer ? { message: 'Minuteur annulé.', patch: { timer: null } } : { message: 'Aucun minuteur actif.' }
    case 'pause': {
      if (!state.timer?.end || state.timer.end <= now) return { message: 'Aucun minuteur en cours.' }
      const timer = { label: state.timer.label, remaining: state.timer.end - now }
      return { message: 'Minuteur en pause.', patch: { timer } }
    }
    case 'reprendre': {
      if (!state.timer?.remaining) return { message: 'Aucun minuteur en pause.' }
      const timer = { label: state.timer.label, end: now + state.timer.remaining }
      return { message: 'Minuteur repris.', patch: { timer } }
    }
    case 'tâche':
    case 'tache':
      if (!argument || argument.length > 160) return { message: 'Ajoute une tâche de 1 à 160 caractères.' }
      if (tasks.length >= 100) return { message: 'Limite de 100 tâches. Termine une tâche pour libérer une place.' }
      return { message: 'Tâche ajoutée.', patch: { tasks: [...tasks, { id: randomUUID(), text: argument }] }, view: 'tasks' }
    case 'tâches':
    case 'taches':
      return { message: tasks.length ? 'Voici tes tâches.' : 'Ta liste de tâches est vide.', view: 'tasks' }
    case 'fait': {
      const index = /^\d+$/.test(argument) ? Number(argument) - 1 : -1
      if (!tasks[index]) return { message: 'Indique le numéro d’une tâche. Exemple : fait 1.' }
      return { message: 'Tâche terminée : ' + tasks[index].text, patch: { tasks: tasks.filter((_, i) => i !== index) }, view: 'tasks', reaction: 'celebrate' }
    }
    case 'date':
      return { message: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' }).format(now) }
    case 'dé':
    case 'de': {
      const sides = /^\d+$/.test(argument) ? Number(argument) : argument ? 0 : 6
      if (sides < 2 || sides > 1000) return { message: 'Choisis de 2 à 1 000 faces. Exemple : dé 20.' }
      return { message: `Dé à ${sides} faces : ${randomInt(1, sides + 1)}.`, reaction: 'celebrate' }
    }
    case 'pile':
      return { message: randomInt(2) ? 'Pile !' : 'Face !', reaction: 'celebrate' }
    case 'note':
      if (!argument || argument.length > 500) return { message: 'Écris une note de 1 à 500 caractères après « note ».' }
      if (state.notes.length >= 100) return { message: 'Limite de 100 notes atteinte. Supprime une note pour libérer une place.' }
      return { message: 'Note enregistrée.', patch: { notes: [{ id: randomUUID(), text: argument }, ...state.notes] } }
    case 'notes': return { message: state.notes.length ? 'Voici tes notes.' : 'Tu n’as pas encore de note.', view: 'notes' }
    case 'calc':
      try { return { message: 'Résultat : ' + calculate(argument) } }
      catch (error) { return { message: error.message } }
    case 'copier': return argument ? { message: 'Texte copié.', copy: argument } : { message: 'Indique le texte à copier.' }
    case 'ouvrir': {
      const name = argument.toLowerCase().replace(/[.!?]+$/, '').trim()
      return Object.hasOwn(destinations, name) ? { message: 'Ouverture de ' + name + '…', url: destinations[name] } : { message: 'Raccourcis disponibles : agenda, github et traduction.' }
    }
    default: return { message: 'Commande inconnue. ' + help }
  }
}

module.exports = { runCommand, calculate }
