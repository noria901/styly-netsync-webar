// -----------------------------------------------------------------------------
// image-target: bind an entity to a named marker, optionally leaving it behind
// -----------------------------------------------------------------------------
// The engine emits xrimagefound / xrimageupdated / xrimagelost on the scene,
// each carrying {name, position, rotation, scale, scaledWidth, scaledHeight}
// for whichever target moved. detail.rotation is a quaternion, not Euler.
//
// persist: true leaves the content in place after the marker leaves frame. That
// works because world tracking is on by default (disableWorldTracking is false
// unless you set it), so SLAM keeps carrying the pose we froze. With world
// tracking off there is no spatial reference and the content would just follow
// the camera around, which is not what anyone wants.
//
// Two things make naive persistence look broken, and both are handled below.
//
// This component owns tracking state only. It reports what happened via
// targetfound / targetlost / persistexpired and leaves presentation to whoever
// is listening, so it has no dependency on the HUD.
//
// Those emits must bubble. A-Frame's emit(name, detail, bubbles) defaults to
// true; passing false delivers only to this entity, and a listener on <a-scene>
// never fires. That failure is silent — the component works, the HUD just never
// changes — so bridge/test/image-target.test.mjs asserts the scene sees them.

// How many recent samples to keep for picking a freeze pose.
const HISTORY = 20
// Below this, the marker is edge-on enough that its pose estimate is unreliable
// (cos 65 degrees). Used to bias sample selection, not to reject outright —
// a bad sample still beats no sample.
const MIN_FACING = 0.42
// Re-acquisition blend time. Snapping is jarring; longer feels laggy.
const REACQUIRE_MS = 350

AFRAME.registerComponent('image-target', {
  schema: {
    name: {type: 'string'},
    persist: {type: 'boolean', default: false},
    // Drop persisted content after this many seconds without re-acquisition.
    // SLAM drift accumulates, so a pose frozen ten minutes ago is fiction.
    // 0 keeps it indefinitely.
    persistTimeout: {type: 'number', default: 0},
  },

  init() {
    const {object3D} = this.el
    object3D.visible = false

    // Poses are written straight into object3D as if they were world-space,
    // because that is what the engine reports. That only holds if the entity
    // sits directly under the scene.
    if (this.el.parentEl !== this.el.sceneEl) {
      console.warn(
        `[image-target] "${this.data.name}" is nested inside ${this.el.parentEl?.tagName}. ` +
        'Marker poses are world-space; put this entity directly under <a-scene> ' +
        'or its parent transform will be applied twice.')
    }

    this.history = []
    this.frozen = null
    this.blend = null
    this.lostAt = 0

    this._camPos = new THREE.Vector3()
    this._normal = new THREE.Vector3()
    this._toCam = new THREE.Vector3()
    this._prev = null

    this.onFound = ({detail}) => {
      if (detail.name !== this.data.name) {
        return
      }
      const sample = {
        position: new THREE.Vector3().copy(detail.position),
        rotation: new THREE.Quaternion().copy(detail.rotation),
        scale: detail.scale,
        score: this._score(detail),
      }
      this._push(sample)

      const wasHidden = !object3D.visible
      const wasPersisting = this.frozen !== null

      if (wasPersisting) {
        // Re-acquired. The frozen pose has drifted relative to the live one, so
        // blend instead of snapping — the jump is very visible on a phone.
        this.blend = {
          from: {
            position: object3D.position.clone(),
            rotation: object3D.quaternion.clone(),
            scale: object3D.scale.x,
          },
          startedAt: performance.now(),
        }
        this.frozen = null
      }

      this.live = sample
      if (!this.blend) {
        this._apply(sample)
      }

      if (wasHidden) {
        object3D.visible = true
        this.el.emit('targetfound', {name: detail.name})
      }
    }

    this.onLost = ({detail}) => {
      if (detail.name !== this.data.name) {
        return
      }
      this.live = null
      this.blend = null

      if (this.data.persist) {
        // xrimagelost carries only the name — no final pose — and the last few
        // samples before a loss are the worst ones: the marker is going
        // edge-on, sliding out of frame, or motion-blurred. Freezing on
        // whichever frame happened to be last visibly tilts the content.
        // Freeze on the best recent sample instead.
        const best = this._best()
        if (best) {
          this.frozen = best
          this._apply(best)
        }
        this.lostAt = performance.now()
      } else {
        object3D.visible = false
      }

      this.el.emit('targetlost', {name: detail.name, persisting: !!this.frozen})
    }

    const scene = this.el.sceneEl
    scene.addEventListener('xrimagefound', this.onFound)
    scene.addEventListener('xrimageupdated', this.onFound)
    scene.addEventListener('xrimagelost', this.onLost)
  },

  tick() {
    const {object3D} = this.el

    if (this.blend && this.live) {
      const t = Math.min(1, (performance.now() - this.blend.startedAt) / REACQUIRE_MS)
      // Smoothstep: no velocity discontinuity at either end.
      const k = t * t * (3 - 2 * t)
      object3D.position.lerpVectors(this.blend.from.position, this.live.position, k)
      object3D.quaternion.slerpQuaternions(this.blend.from.rotation, this.live.rotation, k)
      object3D.scale.setScalar(
        this.blend.from.scale + (this.live.scale - this.blend.from.scale) * k)
      if (t >= 1) {
        this.blend = null
      }
      return
    }

    if (this.frozen && this.data.persistTimeout > 0) {
      if (performance.now() - this.lostAt > this.data.persistTimeout * 1000) {
        this.frozen = null
        object3D.visible = false
        this.el.emit('persistexpired', {name: this.data.name})
      }
    }
  },

  /**
   * How much to trust this sample. Two things degrade a marker pose:
   * viewing it edge-on, and moving while it is read.
   */
  _score(detail) {
    const cam = this.el.sceneEl.camera
    if (!cam) {
      return 0
    }
    cam.getWorldPosition(this._camPos)

    // Marker normal is its local +Z, rotated into world space.
    this._normal.set(0, 0, 1).applyQuaternion(detail.rotation)
    this._toCam.copy(this._camPos).sub(detail.position).normalize()
    const facing = Math.max(0, this._normal.dot(this._toCam))

    // Jitter against the previous sample, in metres. Large frame-to-frame
    // motion means either fast movement or an unstable estimate; both make a
    // poor thing to freeze on.
    let jitter = 0
    if (this._prev) {
      jitter = this._prev.distanceTo(detail.position)
    }
    this._prev = (this._prev ?? new THREE.Vector3()).copy(detail.position)

    const facingTerm = facing < MIN_FACING ? facing * 0.5 : facing
    return facingTerm - Math.min(1, jitter * 4)
  },

  _push(sample) {
    this.history.push(sample)
    if (this.history.length > HISTORY) {
      this.history.shift()
    }
  },

  _best() {
    let best = null
    for (const s of this.history) {
      if (!best || s.score > best.score) {
        best = s
      }
    }
    return best
  },

  _apply(sample) {
    const {object3D} = this.el
    object3D.position.copy(sample.position)
    object3D.quaternion.copy(sample.rotation)
    object3D.scale.setScalar(sample.scale)
  },

  remove() {
    const scene = this.el.sceneEl
    scene.removeEventListener('xrimagefound', this.onFound)
    scene.removeEventListener('xrimageupdated', this.onFound)
    scene.removeEventListener('xrimagelost', this.onLost)
  },
})
