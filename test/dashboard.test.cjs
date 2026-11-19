const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { readSettings, validSetting, serveAudio, searchPlaces, forecast } = require('../src/dashboard.cjs')

test('les anciens réglages reçoivent les valeurs par défaut', () => {
  assert.deepEqual(readSettings({ clock: false, position: 'middle', motion: 1, unknown: true }), {
    clock: false, motion: true, fullscreen: true, sleep: true, notifications: true, position: 'center'
  })
  assert.equal(validSetting('__proto__', true), false)
})

test('le lecteur accepte les plages de lecture des seuls morceaux enregistrés', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'halo-audio-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const track = { id: 'test', path: path.join(folder, 'song.wav') }
  await writeFile(track.path, Buffer.from('abcdefgh', 'ascii'))

  const request = range => new Request('halo-audio://track/test', { headers: range ? { range } : {} })
  const result = await serveAudio(request('bytes=2-4'), [track])
  assert.equal(result.status, 206)
  assert.equal(result.headers.get('Content-Range'), 'bytes 2-4/8')
  assert.equal(await result.text(), 'cde')
  assert.equal(await (await serveAudio(request('bytes=-2'), [track])).text(), 'gh')
  assert.equal((await serveAudio(request('bytes=8-'), [track])).status, 416)
  assert.equal((await serveAudio(request(), [])).status, 404)
})

test('la météo limite les requêtes à la recherche et aux prévisions Open-Meteo', async () => {
  const request = async url => {
    if (url.hostname === 'geocoding-api.open-meteo.com') {
      assert.equal(url.searchParams.get('name'), 'Paris & proche')
      return Response.json({ results: [{ name: 'Paris', admin1: 'Île-de-France', country: 'France', latitude: 48.85, longitude: 2.35 }] })
    }
    assert.equal(url.hostname, 'api.open-meteo.com')
    assert.equal(url.searchParams.get('forecast_days'), '3')
    assert.equal(url.searchParams.get('latitude'), '48.85')
    return Response.json({ current: { temperature_2m: 17 }, daily: {} })
  }
  const [place] = await searchPlaces('Paris & proche', request)
  assert.equal(place.label, 'Paris, Île-de-France, France')
  assert.equal((await forecast(place, request)).current.temperature_2m, 17)
})
