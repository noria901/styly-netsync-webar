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
// image-target lives in its own file — it grew past the point where it belongs
// next to the bootstrap code.
const register = () => {
  import('./image-target.js')

  // Binds an entity to one named image target.
  //
  // The engine emits xrimagefound / xrimageupdated / xrimagelost on the scene,
  // each carrying {name, position, rotation, scale} for whichever target moved.
  // detail.rotation is a quaternion, not Euler angles.
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
// The components report state; the HUD is wired up here so they don't have to
// know it exists.
document.addEventListener('DOMContentLoaded', () => {
  const scene = document.querySelector('a-scene')
  if (!scene) {
    return
  }

  scene.addEventListener('netsyncmode', ({detail}) => {
    const hud = document.getElementById('hud')
    if (hud) {
      hud.dataset.mode = detail.mode
    }
  })

  scene.addEventListener('targetfound', ({detail}) => {
    setHud('tracking', `${detail.name} を認識中`)
  })

  scene.addEventListener('targetlost', ({detail}) => {
    setHud(
      detail.persisting ? 'persisting' : 'searching',
      detail.persisting ? `${detail.name} を空間に固定中` : 'マーカーを探しています')
  })

  scene.addEventListener('persistexpired', () => {
    setHud('searching', 'マーカーを探しています')
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

// -----------------------------------------------------------------------------
// 5. Offline
// -----------------------------------------------------------------------------
// Registered after load so the ~8 MB precache competes with nothing during
// startup. Not registered on a dev server: a stale cache-first worker there is
// pure confusion.
if ('serviceWorker' in navigator && !import.meta.env.DEV) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', {scope: './'})
      .then(reg => console.info('[offline] ready, scope', reg.scope))
      .catch(err => console.warn('[offline] registration failed', err))
  })
}
