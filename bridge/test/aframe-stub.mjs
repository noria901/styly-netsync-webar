// Minimal A-Frame / THREE stand-in: enough to instantiate a component, fire
// engine events at it, and observe what it emits and where.
//
// The point is the "where". A component can be perfectly correct and still be
// invisible to its listeners if the event doesn't bubble, and that is not
// something reading the file tells you.
import * as THREE from 'three'

globalThis.THREE = THREE
globalThis.performance = globalThis.performance ?? {now: () => Date.now()}

class FakeEl {
  constructor(tagName, parent = null) {
    this.tagName = tagName
    this.parentEl = parent
    this.object3D = new THREE.Object3D()
    this.children = []
    this._listeners = new Map()
    this.sceneEl = parent ? parent.sceneEl : this
    if (parent) {
      parent.children.push(this)
    }
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) {
      this._listeners.set(type, [])
    }
    this._listeners.get(type).push(fn)
  }

  removeEventListener(type, fn) {
    const l = this._listeners.get(type)
    if (l) {
      this._listeners.set(type, l.filter(f => f !== fn))
    }
  }

  /** Mirrors A-Frame: emit(name, detail, bubbles = true). */
  emit(type, detail = {}, bubbles = true) {
    this._dispatch(type, detail)
    if (bubbles && this.parentEl) {
      this.parentEl.emit(type, detail, true)
    }
  }

  _dispatch(type, detail) {
    for (const fn of this._listeners.get(type) ?? []) {
      fn({type, detail, target: this})
    }
  }
}

class FakeScene extends FakeEl {
  constructor() {
    super('A-SCENE', null)
    this.camera = new THREE.PerspectiveCamera()
    this.camera.updateMatrixWorld(true)
  }
}

const registry = new Map()
globalThis.AFRAME = {
  registerComponent(name, def) {
    registry.set(name, def)
  },
}

/** Instantiate a registered component on an element, applying schema defaults. */
function attach(name, el, attrs = {}) {
  const def = registry.get(name)
  if (!def) {
    throw new Error(`component not registered: ${name}`)
  }
  const data = {}
  for (const [k, spec] of Object.entries(def.schema ?? {})) {
    data[k] = spec.default ?? (spec.type === 'boolean' ? false
      : spec.type === 'number' ? 0 : '')
  }
  Object.assign(data, attrs)

  const inst = Object.create(def)
  inst.el = el
  inst.data = data
  inst.init?.()
  el.components = el.components ?? {}
  el.components[name] = inst
  return inst
}

export {FakeEl, FakeScene, attach, registry, THREE}
