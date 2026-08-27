// -----------------------------------------------------------------------------
// NetSync client (browser side)
// -----------------------------------------------------------------------------
// Browsers can't open raw ZeroMQ sockets, so this talks plain WebSocket JSON to
// the bridge in bridge/, which does the ZMQ half. Everything below is transport-
// agnostic on purpose: swap the WebSocket for a WebTransport session and nothing
// else here changes.
//
// Poses are sent in shared space (see colocalization.js) — never in engine world
// space, which is meaningless to anyone else.

// server.py: transform_broadcast_rate = 10 Hz by default. Sending faster than
// the server rebroadcasts just burns uplink and gets coalesced away.
// Also: client_timeout = 5s counts from the last TRANSFORM message, so a
// non-stealth client must keep sending pose or it is dropped from the room.
const SEND_HZ = 10

// A dial that hasn't completed in this long is treated as a failure. Browsers
// will otherwise wait out the OS TCP timeout.
const CONNECT_TIMEOUT_MS = 4000
const MAX_ATTEMPTS = 4
const BASE_BACKOFF_MS = 800

export class NetSyncClient {
  constructor({url, roomId, deviceId}) {
    this.url = url
    this.roomId = roomId
    // NetSync keys client state by device id server-side, so this must be
    // stable across reloads or you leak a ghost avatar on every refresh.
    this.deviceId = deviceId ?? persistentDeviceId()

    this.ws = null
    this.clientNo = null
    this.remotes = new Map()
    this.peerNames = new Map()
    this.globalVars = {}
    this._attempt = 0
    this._givenUp = false
    this._onStateChange = () => {}

    this._rpcHandlers = new Map()
    this._lastSend = 0
    this._sendInterval = 1000 / SEND_HZ
  }

  /**
   * @param {function} onStateChange  Called with 'connecting' | 'online' |
   *   'offline'. 'offline' is terminal for this session: the client has given
   *   up and the caller should run single-player from here on.
   */
  connect(onStateChange = () => {}) {
    this._onStateChange = onStateChange
    this._dial()
    return this
  }

  _dial() {
    this._onStateChange('connecting')

    let ws
    try {
      ws = new WebSocket(this.url)
    } catch (e) {
      // Thrown synchronously for a malformed URL, or for ws:// on an https
      // page — the mixed-content block happens before any network I/O.
      this._giveUp(`cannot open ${this.url}: ${e.message}`)
      return
    }
    this.ws = ws

    // A WebSocket to an unreachable host does not fail fast. Depending on the
    // platform it can sit in SYN retry for tens of seconds, which on a phone
    // means the user stares at a "connecting" HUD for the whole time. Bound it.
    const dialTimer = setTimeout(() => {
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    }, CONNECT_TIMEOUT_MS)

    ws.addEventListener('open', () => {
      clearTimeout(dialTimer)
      this._attempt = 0
      this._send({t: 'join', room: this.roomId, deviceId: this.deviceId})
      this._onStateChange('online')
    })

    ws.addEventListener('message', ev => {
      let msg
      try {
        msg = JSON.parse(ev.data)
      } catch (e) {
        console.warn('[netsync] bad frame', e)
        return
      }
      this._handle(msg)
    })

    // Browsers fire 'error' then 'close', and an unhandled error event is
    // merely noisy there. Node's ws throws on it, and error-reporting SDKs will
    // surface it as an exception. The retry lives in 'close'; this just stops
    // the failure from looking like a crash.
    ws.addEventListener('error', () => {})

    ws.addEventListener('close', () => {
      clearTimeout(dialTimer)
      this.clientNo = null
      this.remotes.clear()
      this.peerNames.clear()
      if (this._givenUp) {
        return
      }

      // Venue wifi drops, so retry — but with a bound. An unbounded retry loop
      // against a bridge that will never exist (the same build served from
      // GitHub Pages, opened away from the venue) burns battery and fills the
      // console forever.
      if (++this._attempt > MAX_ATTEMPTS) {
        this._giveUp(`no bridge at ${this.url} after ${MAX_ATTEMPTS} attempts`)
        return
      }
      const backoff = Math.min(BASE_BACKOFF_MS * 2 ** (this._attempt - 1), 8000)
      this._onStateChange('connecting')
      setTimeout(() => this._dial(), backoff)
    })
  }

  _giveUp(reason) {
    this._givenUp = true
    this.ws = null
    console.info(`[netsync] running single-player — ${reason}`)
    this._onStateChange('offline')
  }

  /** True once the client has stopped trying. Callers can branch on this. */
  get isOffline() {
    return this._givenUp === true
  }

  _handle(msg) {
    // Uplink messages are tagged `t`, downlink messages `type`. They are
    // different vocabularies on purpose: `t` is this file's own WebSocket
    // protocol with the bridge, `type` is what the bridge produces by decoding
    // NetSync frames. Do not unify them without changing both ends.
    switch (msg.type) {
    case 'deviceIdMapping':
      // The only place clientNo <-> deviceId is published. Without it a peer
      // can never be named, and we can't tell which entry in roomPose is us.
      for (const m of msg.mappings) {
        this.peerNames.set(m.clientNo, {deviceId: m.deviceId, isStealth: m.isStealth})
        if (m.deviceId === this.deviceId) {
          this.clientNo = m.clientNo
        }
      }
      break
    case 'globalVarSync':
      this.globalVars = msg.variables
      break
    case 'roomPose':
      // Every broadcast is a full room snapshot, not a delta. Clients that
      // stopped reporting simply stop appearing, so rebuild rather than merge.
      this.remotes.clear()
      for (const c of msg.clients) {
        if (c.head && c.clientNo !== this.clientNo) {
          this.remotes.set(c.clientNo, c)
        }
      }
      break
    case 'rpc': {
      if (msg.deviceId === this.deviceId) {
        return   // our own echo
      }
      const fn = this._rpcHandlers.get(msg.functionName)
      let args = []
      try {
        args = JSON.parse(msg.argumentsJson)
      } catch {
        // fall through with []
      }
      fn?.(msg.senderClientNo, args)
      break
    }
    }
  }

  /** Mirrors OnRPCReceived(senderClientNo, functionName, args) on the C# side. */
  on(fnName, handler) {
    this._rpcHandlers.set(fnName, handler)
    return this
  }

  /** Mirrors NetSyncManager.Instance.Rpc(functionName, args). */
  rpc(fnName, args) {
    this._send({t: 'rpc', fn: fnName, args: args.map(String)})
  }

  /**
   * Rate-limited head pose push. Call every frame; it drops what it doesn't
   * need. Sending at render rate is the fastest way to saturate a venue LAN.
   */
  sendHead(pos, quat, now = performance.now()) {
    if (now - this._lastSend < this._sendInterval) {
      return false
    }
    this._lastSend = now
    this._send({
      t: 'pose',
      head: {
        position: [round(pos.x), round(pos.y), round(pos.z)],
        rotation: [round(quat.x), round(quat.y), round(quat.z), round(quat.w)],
      },
    })
    return true
  }

  _send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }
}

// Head absolute position is quantised to 1 cm (int24) on the wire, so anything
// past 2 decimal places is discarded downstream. Sending mm keeps a little
// headroom for the bridge's own arithmetic without being silly about it.
const round = v => Math.round(v * 1000) / 1000

function persistentDeviceId() {
  const KEY = 'netsync.deviceId'
  let id = localStorage.getItem(KEY)
  if (!id) {
    id = `web-${crypto.randomUUID()}`
    localStorage.setItem(KEY, id)
  }
  return id
}
