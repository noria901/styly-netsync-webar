// Exercises the three deployment paths without a browser or a camera.
//   1. no ?bridge=      -> single-player, zero network calls
//   2. ?bridge= + live  -> multiplayer
//   3. ?bridge= + dead  -> bounded retries, then single-player
import WebSocket from 'ws'
import {readMultiplayerConfig} from './shim-config.mjs'

// Minimal browser shims so the client module runs under Node.
globalThis.WebSocket = WebSocket
globalThis.performance = globalThis.performance ?? {now: () => Date.now()}
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) {
    return this._d.get(k) ?? null
  },
  setItem(k, v) {
    this._d.set(k, v)
  },
}


const {NetSyncClient} = await import('./netsync-client.mjs')

let netCalls = 0
const RealWS = WebSocket
globalThis.WebSocket = class extends RealWS {
  constructor(...a) {
    netCalls++
    super(...a)
  }
  static get CONNECTING() {
    return RealWS.CONNECTING
  }
  static get OPEN() {
    return RealWS.OPEN
  }
}

const scenario = process.argv[2]

if (scenario === 'single') {
  console.log('--- 1. no ?bridge= (the GitHub Pages default) ---')
  const cfg = readMultiplayerConfig('')
  console.log('  config:', cfg)
  console.log('  WebSocket constructions:', netCalls)
  console.log(netCalls === 0 && cfg === null
    ? '  PASS: single-player, nothing dialled'
    : '  FAIL')
  process.exit(0)
}

if (scenario === 'mixed') {
  console.log('--- 1b. ws:// bridge on an https page ---')
  globalThis.window = {location: {protocol: 'https:', search: ''}}
  const cfg = readMultiplayerConfig('?bridge=ws://192.168.1.10:8787&room=venue-a')
  console.log('  config:', cfg)
  console.log(cfg === null ? '  PASS: rejected before any I/O' : '  FAIL')
  process.exit(0)
}

const url = scenario === 'live' ? 'ws://127.0.0.1:8787' : 'ws://127.0.0.1:9' // 9 = discard, nothing listening
const label = scenario === 'live' ? '2. bridge up' : '3. bridge down'
console.log(`--- ${label} (${url}) ---`)

const t0 = Date.now()
const states = []
const net = new NetSyncClient({url, roomId: 'venue-a', deviceId: 'web-test'})

net.connect(state => {
  states.push(`${state}@${((Date.now() - t0) / 1000).toFixed(1)}s`)
  console.log(`  state -> ${state}  (t+${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  if (state === 'online') {
    let n = 0
    const iv = setInterval(() => {
      net.sendHead({x: 1, y: 1.6, z: 0}, {x: 0, y: 0, z: 0, w: 1}, performance.now())
      if (++n > 20) {
        clearInterval(iv)
      }
    }, 100)
  }
})

setTimeout(() => {
  console.log(`  states: ${states.join(' -> ')}`)
  console.log(`  WebSocket constructions: ${netCalls}`)
  console.log(`  isOffline: ${net.isOffline}`)
  console.log(`  remotes seen: ${net.remotes.size}`)
  console.log(`  peers named: ${[...net.peerNames].map(([n,v])=>`#${n}=${v.deviceId}`).join(" ")}`)
  console.log(`  own clientNo: ${net.clientNo}`)
  const ok = scenario === 'live'
    ? (!net.isOffline && net.clientNo !== null && net.remotes.size > 0)
    : (net.isOffline && netCalls <= 5)
  console.log(ok ? '  PASS' : '  FAIL')
  process.exit(0)
}, scenario === 'live' ? 6000 : 30000)
