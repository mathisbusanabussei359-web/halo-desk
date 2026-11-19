const { createReadStream, promises: fs } = require('node:fs')
const { Readable } = require('node:stream')
const path = require('node:path')

const defaults = Object.freeze({
  clock: true, motion: true, fullscreen: true, sleep: true, notifications: true, position: 'center'
})
const audioTypes = Object.freeze({
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg',
  '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm'
})

function validSetting(key, value) {
  if (!Object.hasOwn(defaults, key)) return false
  return key === 'position' ? ['left', 'center', 'right'].includes(value) : typeof value === 'boolean'
}

function readSettings(saved) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) =>
    [key, validSetting(key, saved?.[key]) ? saved[key] : fallback]))
}

function mediaType(file) {
  return audioTypes[path.extname(file).toLowerCase()]
}

async function serveAudio(request, tracks) {
  const url = new URL(request.url)
  if (url.hostname !== 'track' || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 })
  const track = tracks.find(item => item.id === url.pathname.slice(1))
  const type = track && mediaType(track.path)
  if (!type) return new Response(null, { status: 404 })

  try {
    const stat = await fs.stat(track.path)
    if (!stat.isFile()) return new Response(null, { status: 404 })
    const range = request.headers.get('range')
    const match = range?.match(/^bytes=(\d*)-(\d*)$/)
    const start = match?.[1] ? Number(match[1]) : match ? Math.max(0, stat.size - Number(match[2])) : 0
    const end = match?.[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1
    if (range && (!match || (!match[1] && !match[2]) || start > end)) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } })
    }

    const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(Math.max(0, end - start + 1)) }
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`
    const stream = request.method === 'HEAD' || !stat.size ? null :
      Readable.toWeb(createReadStream(track.path, { start, end }))
    return new Response(stream, { status: range ? 206 : 200, headers })
  } catch {
    return new Response(null, { status: 404 })
  }
}

async function requestJson(fetcher, host, endpoint, params) {
  const url = new URL(endpoint, host)
  url.search = new URLSearchParams(params)
  const response = await fetcher(url, { signal: AbortSignal.timeout(8000), redirect: 'error' })
  if (!response.ok) throw new Error('Service météo indisponible.')
  return response.json()
}

async function searchPlaces(query, fetcher) {
  const result = await requestJson(fetcher, 'https://geocoding-api.open-meteo.com', '/v1/search',
    { name: query, count: '5', language: 'fr' })
  return (result.results ?? []).map(place => ({
    label: [place.name, place.admin1, place.country].filter(Boolean).filter((name, index, all) => all.indexOf(name) === index).join(', '),
    lat: place.latitude, lon: place.longitude
  })).filter(validPlace)
}

function validPlace(place) {
  return typeof place?.label === 'string' && place.label.length <= 240 &&
    Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 &&
    Number.isFinite(place.lon) && Math.abs(place.lon) <= 180
}

async function forecast(place, fetcher) {
  const result = await requestJson(fetcher, 'https://api.open-meteo.com', '/v1/forecast', {
    latitude: place.lat, longitude: place.lon, timezone: 'auto', forecast_days: '3',
    current: 'temperature_2m,apparent_temperature,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min'
  })
  return { current: result.current, daily: result.daily }
}

module.exports = { readSettings, validSetting, audioTypes, mediaType, serveAudio, searchPlaces, forecast, validPlace }
