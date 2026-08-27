// Headless stand-in for the WebAR client. Runs the same wire messages the
// browser would send, so the bridge and server can be exercised without a
// camera or a real marker.
import WebSocket from 'ws'

const [, , name, mode] = process.argv
const URL = 'ws://127.0.0.1:8787'
const ROOM = process.env.ROOM ?? 'venue-a'

const ws = new WebSocket(URL)
const deviceId = `web-${name}`
let sent = 0
let received = 0
const seenPeers = new Set()
let sawSelf = false

ws.on('open', () => {
  console.log(`[${name}] connected, joining ${ROOM} (${mode})`)
  ws.send(JSON.stringify({t: 'join', room: ROOM, deviceId, stealth: mode === 'stealth'}))

  if (mode === 'stealth') {
    return
  }

  // Walk a circle so positions actually change frame to frame.
  let t = 0
  setInterval(() => {
    t += 0.1
    const r = name === 'a' ? 2.0 : 3.5
    ws.send(JSON.stringify({
      t: 'pose',
      head: {
        position: [r * Math.cos(t), 1.6, r * Math.sin(t)],
        rotation: [0, Math.sin(t / 2), 0, Math.cos(t / 2)],
      },
    }))
    sent++
  }, 100)   // 10 Hz, matching transform_broadcast_rate
})

ws.on('message', raw => {
  const msg = JSON.parse(raw)
  if (msg.type === 'roomPose') {
    received++
    for (const c of msg.clients) {
      seenPeers.add(c.clientNo)
    }
    if (received === 1 || received % 30 === 0) {
      const desc = msg.clients
        .map(c => `#${c.clientNo}${c.head ? `@[${c.head.position.map(v => v.toFixed(2)).join(',')}]` : '(no head)'}`)
        .join(' ')
      console.log(`[${name}] roomPose #${received}: ${msg.clients.length} clients — ${desc}`)
    }
  } else if (msg.type === 'rpc') {
    console.log(`[${name}] RPC from clientNo=${msg.senderClientNo} ${msg.functionName}(${msg.argumentsJson})`)
  } else if (msg.type === 'deviceIdMapping') {
    console.log(`[${name}] mapping: ${msg.mappings.map(m=>`#${m.clientNo}=${m.deviceId}${m.isStealth?'(stealth)':''}`).join(' ')}`)
  } else if (msg.type === 'globalVarSync') {
    console.log(`[${name}] globalVars: ${JSON.stringify(msg.variables)}`)
  } else if (msg.type === 'unhandled') {
    console.log(`[${name}] unhandled msgType=${msg.msgType}`)
  }
})

ws.on('error', e => console.error(`[${name}] ws error`, e.message))

if (name === 'a') {
  setTimeout(() => {
    console.log(`[${name}] sending RPC`)
    ws.send(JSON.stringify({t: 'rpc', fn: 'MarkerAligned', args: ['sample-target', '0.2']}))
  }, 4000)
}

setTimeout(() => {
  console.log(`[${name}] SUMMARY sent=${sent} roomPose=${received} peers=${[...seenPeers].join(',')}`)
  process.exit(0)
}, 9000)
