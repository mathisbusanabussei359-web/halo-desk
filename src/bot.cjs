const { randomUUID } = require('node:crypto')

const destinations = Object.freeze({
  agenda: 'https://calendar.google.com/',
  github: 'https://github.com/',
  traduction: 'https://www.deepl.com/translator'
})

const help = 'Essaie « minuteur 5m », « focus 25m », « annuler », « note Acheter du café », « notes », « calc (12 + 3) * 4 », « copier mon texte » ou « ouvrir agenda ».'

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
