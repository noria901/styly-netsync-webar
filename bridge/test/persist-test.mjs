import * as THREE from 'three'
globalThis.THREE = THREE

// Replay a realistic loss: marker held face-on, then tilted away and swung out
// of frame over the last ~10 frames. Compare "freeze on last sample" against
// "freeze on best-scored sample".
const truePos = new THREE.Vector3(0, 0, -1.2)
const trueQuat = new THREE.Quaternion()   // facing camera
const camPos = new THREE.Vector3(0, 0, 0)

const MIN_FACING = 0.42
let prev = null
const score = (position, rotation) => {
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation)
  const toCam = camPos.clone().sub(position).normalize()
  const facing = Math.max(0, normal.dot(toCam))
  let jitter = 0
  if (prev) jitter = prev.distanceTo(position)
  prev = position.clone()
  const facingTerm = facing < MIN_FACING ? facing * 0.5 : facing
  return facingTerm - Math.min(1, jitter * 4)
}

// Deterministic noise so the numbers are reproducible.
let seed = 12345
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff - 0.5
}
// Baseline estimation noise present even face-on: ~3 mm, ~0.4 deg.
const BASE_POS = 0.003
const BASE_ROT = 0.007

const run = () => {
prev = null
const history = []
for (let i = 0; i < 20; i++) {
  // First 10 frames: steady and face-on. Last 10: tilting away and drifting,
  // with estimation error growing as the marker goes edge-on.
  const t = Math.max(0, (i - 9) / 10)
  const tilt = t * (75 * Math.PI / 180)
  const err = t * t * 0.18                       // pose error grows with tilt
  const drift = t * 0.5                          // marker swinging out of frame

  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(0, tilt, 0)).multiply(
    new THREE.Quaternion().setFromEuler(new THREE.Euler(
      err + rnd() * BASE_ROT, err * 0.7 + rnd() * BASE_ROT, err * 0.4 + rnd() * BASE_ROT)))
  const position = truePos.clone().add(new THREE.Vector3(
    drift + rnd() * BASE_POS, err * 1.5 + rnd() * BASE_POS, err * 2.0 + rnd() * BASE_POS))

  history.push({i, position, rotation, score: score(position, rotation)})
}
return history
}
const history = run()

const last = history[history.length - 1]
let best = history[0]
for (const s of history) if (s.score > best.score) best = s

const posErr = s => s.position.distanceTo(truePos)
const angErr = s => THREE.MathUtils.radToDeg(2 * Math.acos(
  Math.min(1, Math.abs(s.rotation.dot(trueQuat)))))

console.log('frame  score   posErr(m)  angErr(deg)')
for (const s of history) {
  const mark = s === best ? ' <- best' : (s === last ? ' <- last' : '')
  if (s.i >= 8) {
    console.log(`  ${String(s.i).padStart(2)}  ${s.score.toFixed(3).padStart(6)}   ` +
      `${posErr(s).toFixed(3)}      ${angErr(s).toFixed(1)}${mark}`)
  }
}
console.log()
console.log(`freeze on LAST : pos err ${posErr(last).toFixed(3)} m, ang err ${angErr(last).toFixed(1)} deg`)
console.log(`freeze on BEST : pos err ${posErr(best).toFixed(3)} m, ang err ${angErr(best).toFixed(1)} deg`)
console.log(best === last ? 'NO IMPROVEMENT' :
  `improvement: ${(posErr(last) / posErr(best)).toFixed(1)}x position, ` +
  `${(angErr(last) / angErr(best)).toFixed(1)}x angle`)

// Repeat over many noise seeds to check it is not a lucky draw.
let wins = 0, ties = 0, losses = 0
const ratios = []
for (let trial = 0; trial < 200; trial++) {
  seed = 1000 + trial * 7919
  const h = run()
  const l = h[h.length - 1]
  let b = h[0]
  for (const s of h) if (s.score > b.score) b = s
  const rl = angErr(l), rb = angErr(b)
  if (rb < rl - 1e-9) { wins++; ratios.push(rl / rb) } else if (Math.abs(rb - rl) < 1e-9) ties++
  else losses++
}
ratios.sort((a, b) => a - b)
console.log()
console.log(`over 200 seeds: better ${wins}, tie ${ties}, worse ${losses}`)
console.log(`angle-error improvement  median ${ratios[Math.floor(ratios.length/2)].toFixed(1)}x  ` +
  `worst ${ratios[0].toFixed(1)}x`)
