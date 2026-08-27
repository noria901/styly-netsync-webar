// -----------------------------------------------------------------------------
// 1. Load every image target under ../image-targets/
// -----------------------------------------------------------------------------
// The CLI writes one JSON per target. Globbing means you drop a new file in and
// it just works — no edit here. Vite inlines these at build time.
const modules = import.meta.glob('../image-targets/*.json', {eager: true})
const imageTargetData = Object.values(modules).map(m => m.default ?? m)

if (imageTargetData.length === 0) {
  console.warn(
    '[image-targets] No targets found. Run `npm run target` to generate one ' +
    'into image-targets/, then reload.')
}

// -----------------------------------------------------------------------------
// 2. Hand them to the engine before it starts
// -----------------------------------------------------------------------------
// XrController.configure has to run before XR8.run(), which the `xrweb` A-Frame
// component calls for us. The xrloaded event is the only reliable hook, since
// xr.js is loaded async and may or may not be ready when this module executes.
const onxrloaded = () => {
  XR8.XrController.configure({imageTargetData})
}
window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)

// -----------------------------------------------------------------------------
// 3. Components
// -----------------------------------------------------------------------------
const register = () => {
  // Binds an entity to one named image target.
  //
  // The engine emits xrimagefound / xrimageupdated / xrimagelost on the scene,
  // each carrying {name, position, rotation, scale} for whichever target moved.
  // detail.rotation is a quaternion, not Euler angles.
  AFRAME.registerComponent('image-target', {
    schema: {
      name: {type: 'string'},
      // Keep the content on screen after the marker leaves the frame. Only
      // useful with world tracking on — the content then stays anchored in
      // space rather than following the camera.
      persist: {type: 'boolean', default: false},
    },

    init() {
      const {object3D} = this.el
      object3D.visible = false

      this.onFound = ({detail}) => {
        if (detail.name !== this.data.name) {
          return
        }
        object3D.position.copy(detail.position)
        object3D.quaternion.copy(detail.rotation)
        object3D.scale.setScalar(detail.scale)
        if (!object3D.visible) {
          object3D.visible = true
          this.el.emit('targetfound', {name: detail.name}, false)
          setHud('tracking', `${detail.name} を認識中`)
        }
      }

      this.onLost = ({detail}) => {
        if (detail.name !== this.data.name) {
          return
        }
        if (!this.data.persist) {
          object3D.visible = false
        }
        this.el.emit('targetlost', {name: detail.name}, false)
        setHud('searching', 'マーカーを探しています')
      }

      const scene = this.el.sceneEl
      scene.addEventListener('xrimagefound', this.onFound)
      scene.addEventListener('xrimageupdated', this.onFound)
      scene.addEventListener('xrimagelost', this.onLost)
    },

    remove() {
      const scene = this.el.sceneEl
      scene.removeEventListener('xrimagefound', this.onFound)
      scene.removeEventListener('xrimageupdated', this.onFound)
      scene.removeEventListener('xrimagelost', this.onLost)
    },
  })

  // Constant-rate rotation, frame-rate independent.
  AFRAME.registerComponent('spin', {
    schema: {
      axis: {type: 'string', default: 'y'},
      degreesPerSecond: {type: 'number', default: 45},
    },
    tick(time, timeDelta) {
      const radians = THREE.MathUtils.degToRad(
        this.data.degreesPerSecond * (timeDelta / 1000))
      this.el.object3D.rotation[this.data.axis] += radians
    },
  })

  // X red, Y green, Z blue — shows how the marker frame is oriented.
  AFRAME.registerComponent('axis-helper', {
    schema: {size: {type: 'number', default: 1}},
    init() {
      this.helper = new THREE.AxesHelper(this.data.size)
      this.el.object3D.add(this.helper)
    },
    remove() {
      this.el.object3D.remove(this.helper)
      this.helper.dispose?.()
    },
  })
}

window.AFRAME ? register() : window.addEventListener('aframeloaded', register)

// -----------------------------------------------------------------------------
// 4. HUD
// -----------------------------------------------------------------------------
// Multiplayer state is advertised by netsync-colocalized; reflect it so the
// user can tell "alone by design" from "alone because the bridge is down".
document.addEventListener('DOMContentLoaded', () => {
  const scene = document.querySelector('a-scene')
  scene?.addEventListener('netsyncmode', ({detail}) => {
    const hud = document.getElementById('hud')
    if (hud) {
      hud.dataset.mode = detail.mode
    }
  })
})

function setHud(state, text) {
  const hud = document.getElementById('hud')
  if (!hud) {
    return
  }
  hud.dataset.state = state
  document.getElementById('hud-text').textContent = text
}
