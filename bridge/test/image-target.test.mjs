// Behavioural tests for the image-target component, run headless.
import {FakeEl, FakeScene, attach, THREE} from './aframe-stub.mjs'

await import('../../src/image-target.js')

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

const q = (x = 0, y = 0, z = 0) =>
  new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))

/** Build a scene with the component attached directly under it. */
function setup(attrs = {}) {
  const scene = new FakeScene()
  const el = new FakeEl('A-ENTITY', scene)
  // Camera at origin looking down -Z; marker sits in front of it.
  scene.camera.position.set(0, 0, 0)
  scene.camera.updateMatrixWorld(true)
  const comp = attach('image-target', el, {name: 'm1', ...attrs})

  const seen = {onScene: [], onEl: []}
  for (const t of ['targetfound', 'targetlost', 'persistexpired']) {
    scene.addEventListener(t, e => seen.onScene.push({type: t, detail: e.detail}))
    el.addEventListener(t, e => seen.onEl.push({type: t, detail: e.detail}))
  }
  return {scene, el, comp, seen}
}

const found = (scene, over = {}) => scene.emit('xrimagefound', {
  name: 'm1',
  position: new THREE.Vector3(0, 0, -1.2),
  rotation: q(),
  scale: 0.2,
  ...over,
}, false)

const updated = (scene, over = {}) => scene.emit('xrimageupdated', {
  name: 'm1',
  position: new THREE.Vector3(0, 0, -1.2),
  rotation: q(),
  scale: 0.2,
  ...over,
}, false)

console.log('\n--- events reach a scene-level listener ---')
{
  const {scene, el, seen} = setup({persist: true})
  found(scene)
  check('targetfound reaches the scene', seen.onScene.some(e => e.type === 'targetfound'),
    `only saw on element: ${JSON.stringify(seen.onEl.map(e => e.type))}`)

  scene.emit('xrimagelost', {name: 'm1'}, false)
  check('targetlost reaches the scene', seen.onScene.some(e => e.type === 'targetlost'))
  const lost = seen.onScene.find(e => e.type === 'targetlost')
  check('targetlost reports persisting: true', lost?.detail.persisting === true,
    `detail = ${JSON.stringify(lost?.detail)}`)
  check('entity stays visible while persisting', el.object3D.visible === true)
}

console.log('\n--- persist: false hides on loss ---')
{
  const {scene, el, seen} = setup({persist: false})
  found(scene)
  scene.emit('xrimagelost', {name: 'm1'}, false)
  check('entity hidden', el.object3D.visible === false)
  const lost = seen.onScene.find(e => e.type === 'targetlost')
  check('targetlost reports persisting: false', lost?.detail.persisting === false)
}

console.log('\n--- freeze picks the best sample, not the last ---')
{
  const {scene, el} = setup({persist: true})
  // Ten good face-on frames, then ten degrading ones going edge-on.
  for (let i = 0; i < 10; i++) {
    found(scene)
  }
  for (let i = 1; i <= 10; i++) {
    const t = i / 10
    updated(scene, {
      position: new THREE.Vector3(t * 0.5, 0, -1.2),
      rotation: q(0, t * (75 * Math.PI / 180), 0),
    })
  }
  scene.emit('xrimagelost', {name: 'm1'}, false)
  const frozenX = el.object3D.position.x
  const angle = THREE.MathUtils.radToDeg(
    2 * Math.acos(Math.min(1, Math.abs(el.object3D.quaternion.dot(q())))))
  check('froze near the face-on pose, not the edge-on one', frozenX < 0.05 && angle < 5,
    `x=${frozenX.toFixed(3)} angle=${angle.toFixed(1)}deg`)
}

console.log('\n--- other markers are ignored ---')
{
  const {scene, el, seen} = setup({persist: true})
  scene.emit('xrimagefound', {
    name: 'someone-else',
    position: new THREE.Vector3(5, 5, 5),
    rotation: q(),
    scale: 1,
  }, false)
  check('no event for a different name', seen.onScene.length === 0)
  check('entity untouched', el.object3D.visible === false)
}

console.log('\n--- re-acquisition blends instead of snapping ---')
{
  const {scene, el, comp} = setup({persist: true})
  found(scene)
  scene.emit('xrimagelost', {name: 'm1'}, false)
  const before = el.object3D.position.clone()
  // Marker comes back 40 cm away — as if SLAM had drifted.
  found(scene, {position: new THREE.Vector3(0.4, 0, -1.2)})
  check('does not snap on the found frame', el.object3D.position.distanceTo(before) < 0.01,
    `moved ${el.object3D.position.distanceTo(before).toFixed(3)}m immediately`)
  comp.tick()
  const mid = el.object3D.position.x
  check('blend is in progress', mid >= 0 && mid < 0.4, `x=${mid.toFixed(3)}`)
}

console.log('\n--- persistTimeout expires the frozen pose ---')
{
  const {scene, el, comp, seen} = setup({persist: true, persistTimeout: 0.05})
  found(scene)
  scene.emit('xrimagelost', {name: 'm1'}, false)
  check('still visible right after loss', el.object3D.visible === true)
  await new Promise(r => setTimeout(r, 80))
  comp.tick()
  check('hidden after timeout', el.object3D.visible === false)
  check('persistexpired reaches the scene',
    seen.onScene.some(e => e.type === 'persistexpired'))
}

console.log('\n--- nesting warning ---')
{
  const scene = new FakeScene()
  const wrapper = new FakeEl('A-ENTITY', scene)
  const nested = new FakeEl('A-ENTITY', wrapper)
  let warned = false
  const orig = console.warn
  console.warn = msg => {
    if (String(msg).includes('directly under')) {
      warned = true
    }
  }
  attach('image-target', nested, {name: 'm1'})
  console.warn = orig
  check('warns when not a direct child of the scene', warned)
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
