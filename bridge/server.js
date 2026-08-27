// -----------------------------------------------------------------------------
// WebSocket <-> ZeroMQ bridge for STYLY NetSync (protocol v8)
// -----------------------------------------------------------------------------
// Topology, taken from server.py and mirrored from the reference Python client:
//
//   control   ROUTER  :5555   hello, RPC, network variables, ownership
//   transform ROUTER  :5557   pose uplink — a SEPARATE lane, low HWM
//   pub       PUB     :5556   room broadcasts
//   rest      HTTP    :8800   FastAPI, CORS *, started unconditionally
//   discovery UDP     :9999   broadcast — unreachable from a browser
//
// Per browser client this opens two DEALERs (control + transform) and shares one
// SUB. Two lanes, not one: pose sent on the control socket is parsed but lands
// in the control handler and never updates the client's transform state.
//
// Frame shapes:
//   uplink   DEALER.send([roomId, payload])  -> ROUTER sees [identity, room, payload]
//   downlink SUB.recv() -> [topic, payload], topic === roomId
//            DEALER.recv() -> [roomId, payload]
//
// Identity note: the ZMQ identity is NOT how the server knows who you are. Every
// client message carries deviceId in its payload, and that is the key for room
// membership and clientNo assignment. Identity is only the server's unicast
// return path, tracked separately per lane as control_identity /
// transform_identity. So the identity value itself is free — but each browser
// still needs its own pair of sockets to have a distinct return path.

import {WebSocketServer} from 'ws'
import * as zmq from 'zeromq'
import {encodeClientHello, encodeClientPose, encodeRpc, decode} from './codec.js'

const WS_PORT = Number(process.env.WS_PORT ?? 8787)
const HOST = process.env.NETSYNC_HOST ?? '127.0.0.1'
const CONTROL_PORT = Number(process.env.NETSYNC_CONTROL_PORT ?? 5555)
const TRANSFORM_PORT = Number(process.env.NETSYNC_TRANSFORM_PORT ?? 5557)
const PUB_PORT = Number(process.env.NETSYNC_PUB_PORT ?? 5556)

// server.py: client_timeout = 5s, measured from the last TRANSFORM message.
// Control traffic does not refresh it. A browser peer that stops sending pose
// is reaped in 5 seconds even if it is still chattering over RPC.
const STEALTH_HEARTBEAT_MS = 1000

const sessions = new Map()   // deviceId -> session

// --- shared downlink ---------------------------------------------------------
const sub = new zmq.Subscriber()
sub.receiveHighWaterMark = 2   // latest-wins, matching the reference client
sub.connect(`tcp://${HOST}:${PUB_PORT}`)

const subscribedRooms = new Set()

async function pumpDownlink() {
  for await (const [topic, payload] of sub) {
    // ZMQ SUB matches topic PREFIXES. Subscribing to "venue" also delivers
    // "venue-a" and "venue-b". The reference client re-checks byte equality in
    // software for exactly this reason; so do we.
    const room = topic.toString('utf8')

    let msg
    try {
      msg = decode(payload)
    } catch (e) {
      console.warn('[bridge] downlink decode failed:', e.message)
      continue
    }

    const json = JSON.stringify(msg)
    for (const s of sessions.values()) {
      if (s.room === room && s.ws.readyState === 1) {
        s.ws.send(json)
      }
    }
  }
}

// --- per-browser uplink ------------------------------------------------------
function openSession(ws, {room, deviceId, stealth = false}) {
  const control = new zmq.Dealer()
  control.sendHighWaterMark = 1024
  control.receiveHighWaterMark = 1024
  control.connect(`tcp://${HOST}:${CONTROL_PORT}`)

  const transform = new zmq.Dealer()
  transform.sendHighWaterMark = 2   // drop stale poses rather than queue them
  transform.connect(`tcp://${HOST}:${TRANSFORM_PORT}`)

  if (!subscribedRooms.has(room)) {
    sub.subscribe(room)
    subscribedRooms.add(room)
  }

  const session = {ws, control, transform, room, deviceId, stealth, poseSeq: 0, timer: null}
  sessions.set(deviceId, session)

  control.send([room, encodeClientHello(deviceId, stealth)])

  // Stealth clients (spectators with no avatar) keep membership alive with a
  // 1 Hz hello on the control lane instead of pose frames.
  if (stealth) {
    session.timer = setInterval(() => {
      control.send([room, encodeClientHello(deviceId, true)]).catch(() => {})
    }, STEALTH_HEARTBEAT_MS)
  }

  ;(async () => {
    for await (const [roomFrame, payload] of control) {
      if (roomFrame.toString('utf8') !== room) {
        continue
      }
      try {
        ws.send(JSON.stringify(decode(payload)))
      } catch (e) {
        console.warn('[bridge] control decode failed:', e.message)
      }
    }
  })()

  return session
}

const wss = new WebSocketServer({port: WS_PORT})

wss.on('connection', ws => {
  let session = null

  ws.on('message', raw => {
    let msg
    try {
      msg = JSON.parse(raw)
    } catch {
      return
    }

    if (msg.t === 'join') {
      if (!session) {
        session = openSession(ws, msg)
      }
      return
    }
    if (!session) {
      return
    }

    try {
      if (msg.t === 'pose') {
        session.poseSeq = (session.poseSeq + 1) & 0xffff
        session.transform.send([
          session.room,
          encodeClientPose({
            deviceId: session.deviceId,
            poseSeq: session.poseSeq,
            head: msg.head,
          }),
        ])
      } else if (msg.t === 'rpc') {
        session.control.send([
          session.room,
          encodeRpc({
            deviceId: session.deviceId,
            functionName: msg.fn,
            argumentsJson: JSON.stringify(msg.args ?? []),
          }),
        ])
      }
    } catch (e) {
      console.warn('[bridge] uplink failed:', msg.t, e.message)
    }
  })

  ws.on('close', () => {
    if (!session) {
      return
    }
    clearInterval(session.timer)
    session.control.close()
    session.transform.close()
    sessions.delete(session.deviceId)
    // The room subscription is left in place: another client may still be in it,
    // and an unsubscribe/resubscribe cycle drops frames.
  })
})

pumpDownlink()
console.log(
  `[bridge] ws://0.0.0.0:${WS_PORT} -> ${HOST} ` +
  `control:${CONTROL_PORT} transform:${TRANSFORM_PORT} pub:${PUB_PORT}`)
