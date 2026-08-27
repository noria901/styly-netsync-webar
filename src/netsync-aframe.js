// -----------------------------------------------------------------------------
// A-Frame glue: marker -> shared origin -> NetSync
// -----------------------------------------------------------------------------
// Multiplayer is OPT-IN, not attempt-and-degrade. One build ships to static
// hosting; the venue's QR code carries the config:
//
//   https://you.github.io/webar/                        -> single-player
//   https://you.github.io/webar/?bridge=wss://venue.example.com/ws&room=venue-a
//                                                       -> multiplayer
//
// The distinction matters. "Try to connect, fall back on failure" means every
// visitor who opens the page outside the venue pays a dial timeout before
// seeing anything, and the code path that runs 99% of the time is the error
// path. With opt-in, the common case makes zero network calls and the AR works
// the instant the marker is found.
//
// The fallback still exists, for the case that actually warrants it: the venue
// QR is correct but the bridge is down. Then the experience quietly becomes
// single-player instead of hanging.

import {Colocalizer} from './colocalization.js'
import {NetSyncClient} from './netsync-client.js'

/** Multiplayer config from the query string, or null for single-player. */
export function readMultiplayerConfig(search = window.location.search) {
  const q = new URLSearchParams(search)
  const bridge = q.get('bridge')
  if (!bridge) {
    return null
  }
  // A page served over https can only open wss. ws:// is blocked as mixed
  // content before any I/O happens, so catch it here and say why.
  if (window.location.protocol === 'https:' && bridge.startsWith('ws://')) {
    console.warn(
      '[netsync] ignoring ws:// bridge on an https page (mixed content). ' +
      'Use wss:// with a real certificate.')
    return null
  }
  return {bridge, room: q.get('room') || 'default'}
}

AFRAME.registerComponent('netsync-colocalized', {
  schema: {
    anchor: {type: 'string', default: 'sample-target'},
    // Measure the printed marker. Guessing here is the single most common cause
    // of "the avatars are in roughly the right place but the scale is off".
    markerWidth: {type: 'number', default: 0.2},
  },

  init() {
    this.config = readMultiplayerConfig()
    this.mode = this.config ? 'connecting' : 'single'
    this.el.emit('netsyncmode', {mode: this.mode})

    if (!this.config) {
      // Nothing to co-localize against and nobody to tell. The image-target
      // component in app.js keeps working on its own.
      return
    }

    this.colo = new Colocalizer({knownWidth: this.data.markerWidth})
    this.net = new NetSyncClient({url: this.config.bridge, roomId: this.config.room})

    this._pos = new THREE.Vector3()
    this._quat = new THREE.Quaternion()
    this._outPos = new THREE.Vector3()
    this._outQuat = new THREE.Quaternion()
    this._avatars = new Map()

    const onImage = ({detail}) => {
      if (detail.name !== this.data.anchor || this.colo.locked) {
        return
      }
      if (this.colo.sample(detail)) {
        // Latched. From here on SLAM carries the origin and the marker can
        // leave frame — otherwise everyone stands around staring at paper.
        this.el.emit('colocalized', {scale: this.colo.scale})
        this.net.connect(mode => {
          this.mode = mode === 'offline' ? 'single' : mode
          this.el.emit('netsyncmode', {mode: this.mode})
          if (mode === 'offline') {
            this._clearAvatars()
          }
        })
      }
    }

    this.el.sceneEl.addEventListener('xrimagefound', onImage)
    this.el.sceneEl.addEventListener('xrimageupdated', onImage)
  },

  tick(time) {
    if (!this.net || this.net.isOffline || !this.colo?.locked) {
      return
    }

    const cam = this.el.sceneEl.camera
    cam.getWorldPosition(this._pos)
    cam.getWorldQuaternion(this._quat)

    this.colo.toShared(this._pos, this._quat, this._outPos, this._outQuat)
    this.net.sendHead(this._outPos, this._outQuat, time)

    this._syncAvatars()
  },

  _syncAvatars() {
    for (const [clientNo, state] of this.net.remotes) {
      let el = this._avatars.get(clientNo)
      if (!el) {
        el = document.createElement('a-entity')
        el.setAttribute('geometry', 'primitive: sphere; radius: 0.11')
        el.setAttribute('material', 'color: #7fe3c4; metalness: 0.1')
        this.el.sceneEl.appendChild(el)
        this._avatars.set(clientNo, el)
      }
      if (!state.head) {
        continue
      }
      this._outPos.fromArray(state.head.position)
      this._outQuat.fromArray(state.head.rotation)
      this.colo.toWorld(this._outPos, this._outQuat, this._outPos, this._outQuat)
      el.object3D.position.copy(this._outPos)
      el.object3D.quaternion.copy(this._outQuat)
    }

    for (const [clientNo, el] of this._avatars) {
      if (!this.net.remotes.has(clientNo)) {
        el.remove()
        this._avatars.delete(clientNo)
      }
    }
  },

  _clearAvatars() {
    for (const el of this._avatars.values()) {
      el.remove()
    }
    this._avatars.clear()
  },
})
