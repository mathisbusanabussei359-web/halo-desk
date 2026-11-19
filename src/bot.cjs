const { randomUUID, randomInt } = require('node:crypto')

const destinations = Object.freeze({
  agenda: 'https://calendar.google.com/',
  github: 'https://github.com/',
  traduction: 'https://www.deepl.com/translator'
})

const help = [
  'Temps · minuteur 5m, focus 25m, pause, reprendre, annuler, date',
  'Organisation · note Acheter du café, notes, tâche Envoyer le dossier, tâches, fait 1',
  'Outils · calc (12 + 3) * 4, copier mon texte, dé 20, pile ou face, ouvrir agenda'
].join('\n')

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
  const [, raw = '', argument = ''] = input.trim().match(/^(\S+)(?:\s+([\s\S]+))?$/) ?? []
  const tasks = state.tasks ?? []
  switch (raw.toLowerCase()) {
    case 'aide': return { message: help }
    case 'minuteur':
    case 'focus': {
      const match = (argument || (raw.toLowerCase() === 'focus' ? '25m' : '')).match(/^(\d+)\s*([smh]?)$/i)
      const seconds = match ? Number(match[1]) * ({ s: 1, m: 60, h: 3600, '': 60 })[match[2].toLowerCase()] : 0
      if (seconds < 1 || seconds > 86400) return { message: 'Indique une durée de 1 seconde à 24 heures. Exemple : minuteur 90s.' }
      const label = raw.toLowerCase() === 'focus' ? 'Focus' : 'Minuteur'
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
      const name = argument.toLowerCase()
      return Object.hasOwn(destinations, name) ? { message: 'Ouverture de ' + name + '…', url: destinations[name] } : { message: 'Raccourcis disponibles : agenda, github et traduction.' }
    }
    default: return { message: 'Commande inconnue. ' + help }
  }
}

module.exports = { runCommand, calculate }
