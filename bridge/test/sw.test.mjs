// Runs the generated dist/sw.js against a minimal Cache API / fetch stub, so
// install and offline serving are actually exercised rather than eyeballed.
import {readFileSync, existsSync, statSync} from 'fs'
import {join} from 'path'

const DIST = new URL('../../dist/', import.meta.url).pathname

if (!existsSync(join(DIST, 'sw.js'))) {
  console.error('dist/sw.js missing — run `npm run build` first')
  process.exit(1)
}

let pass = 0
let fail = 0
const check = (name, cond, extra = '') => {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${extra ? `  — ${extra}` : ''}`)
  }
}

// --- environment ------------------------------------------------------------
let online = true
const fetched = []

class FakeResponse {
  constructor(url, ok = true, status = 200) {
    this.url = url
    this.ok = ok
    this.status = status
  }
}

const stores = new Map()
class FakeCache {
  constructor() {
    this.map = new Map()
  }
  async put(url, res) {
    this.map.set(String(url), res)
  }
  async match(req) {
    return this.map.get(typeof req === 'string' ? req : req.url)
  }
}

const caches = {
  async open(name) {
    if (!stores.has(name)) {
      stores.set(name, new FakeCache())
    }
    return stores.get(name)
  },
  async keys() {
    return [...stores.keys()]
  },
  async delete(name) {
    return stores.delete(name)
  },
  async match(req) {
    for (const c of stores.values()) {
      const hit = await c.match(req)
      if (hit) {
        return hit
      }
    }
    return undefined
  },
}

const listeners = new Map()
const self_ = {
  addEventListener: (t, fn) => listeners.set(t, fn),
  skipWaiting: async () => {},
  clients: {claim: async () => {}},
}

const fetchStub = async (url) => {
  fetched.push(String(url))
  if (!online) {
    throw new Error('offline')
  }
  const path = join(DIST, String(url).replace(/^\.\//, '').replace(/^\/+/, ''))
  const target = String(url) === './' ? join(DIST, 'index.html') : path
  if (!existsSync(target) || statSync(target).isDirectory()) {
    return new FakeResponse(url, false, 404)
  }
  return new FakeResponse(url, true, 200)
}

const fire = async (type, event) => {
  const fn = listeners.get(type)
  if (!fn) {
    throw new Error(`no listener for ${type}`)
  }
  let waited = null
  let responded = null
  fn({
    ...event,
    waitUntil: p => {
      waited = p
    },
    respondWith: p => {
      responded = p
    },
  })
  if (waited) {
    await waited
  }
  return responded ? await responded.catch(e => ({error: e})) : null
}

// --- load the generated worker ----------------------------------------------
const src = readFileSync(join(DIST, 'sw.js'), 'utf8')
const run = new Function('self', 'caches', 'fetch', 'console', src)
run(self_, caches, fetchStub, console)

console.log('\n--- install ---')
{
  await fire('install', {})
  const names = await caches.keys()
  check('created exactly one cache', names.length === 1, names.join(','))
  check('cache name is content-versioned', /^webar-[0-9a-f]{12}$/.test(names[0]), names[0])

  const cache = stores.get(names[0])
  check('engine core cached', !!(await cache.match('external/xr/xr.js')))
  check('SLAM chunk cached', !!(await cache.match('external/xr/xr-slam.js')))
  check('xrextras cached (not a CDN URL)', !!(await cache.match('external/scripts/xrextras.js')))
  check('marker JSON cached', !!(await cache.match('image-targets/sample-target.json')))
  check('luminance image cached',
    !!(await cache.match('image-targets/sample-target_luminance.png')))
  check('app shell cached', !!(await cache.match('./')))
  check('no CDN origins in the precache list', !/cdn\./.test(src),
    'a cross-origin script would cache opaquely and break offline')
  check('authoring artifacts excluded', !/_original|_cropped|_thumbnail/.test(src))
}

console.log('\n--- offline serving ---')
{
  online = false
  fetched.length = 0

  for (const url of ['external/xr/xr-slam.js', 'image-targets/sample-target_luminance.png']) {
    const res = await fire('fetch', {request: {method: 'GET', url, mode: 'cors'}})
    check(`serves ${url} from cache`, res && res.ok && !res.error)
  }
  check('no network hit while offline', fetched.length === 0, fetched.join(','))

  const nav = await fire('fetch', {request: {method: 'GET', url: 'deep/link', mode: 'navigate'}})
  check('unknown navigation falls back to the shell', nav && nav.ok && !nav.error)

  const post = await fire('fetch', {request: {method: 'POST', url: './', mode: 'cors'}})
  check('POST is not intercepted', post === null)
}

console.log('\n--- update path ---')
{
  online = true
  stores.set('webar-oldversion0', new FakeCache())
  await fire('activate', {})
  const names = await caches.keys()
  check('stale cache dropped', !names.includes('webar-oldversion0'), names.join(','))
  check('current cache kept', names.length === 1, names.join(','))
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
