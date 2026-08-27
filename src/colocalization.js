// -----------------------------------------------------------------------------
// Co-localization via image target
// -----------------------------------------------------------------------------
// The problem NetSync doesn't solve for you: every client's SLAM session starts
// its world origin wherever that device happened to boot. Poses are only
// comparable across clients once everyone agrees on a common origin.
//
// A printed marker is that agreement. Everyone scans the same piece of paper,
// everyone derives the same origin, and from then on poses mean the same thing
// on a Quest, an XREAL and a phone browser alike.
//
// Two corrections matter and both bite in practice:
//
//   Scale. detail.scale is the marker's width in engine world units. The engine
//   derives it from SLAM, so it drifts device to device — two phones can
//   disagree by several percent on the same sheet of paper. Measure the print
//   with a ruler and pass knownWidth; positions then land in true metres, which
//   is what NetSync's encoder expects.
//
//   Handedness. three.js is right-handed, Unity is left-handed. If your WebAR
//   avatar shows up mirrored in the Unity scene, this is why.

const RIGHT_TO_LEFT_HANDED = true

export class Colocalizer {
  /**
   * @param {object} opts
   * @param {number} opts.knownWidth  Printed marker width in metres. 0 = trust
   *                                  the engine's estimate (not recommended for
   *                                  multi-device sessions).
   * @param {number} opts.samples     Frames to average before latching. The
   *                                  first frame after acquisition is the
   *                                  noisiest one, so never latch on it.
   */
  constructor({knownWidth = 0, samples = 30} = {}) {
    this.knownWidth = knownWidth
    this.samples = samples

    this.origin = new THREE.Vector3()
    this.originQuat = new THREE.Quaternion()
    this.invQuat = new THREE.Quaternion()
    this.scale = 1

    this.locked = false
    this._n = 0
    this._accPos = new THREE.Vector3()
    this._accQuat = new THREE.Quaternion()
    this._accScale = 0

    this._tmpPos = new THREE.Vector3()
    this._tmpQuat = new THREE.Quaternion()
  }

  /** Feed every xrimagefound / xrimageupdated for the anchor marker. */
  sample(detail) {
    if (this.locked) {
      return false
    }

    this._tmpQuat.copy(detail.rotation)

    if (this._n === 0) {
      this._accPos.copy(detail.position)
      this._accQuat.copy(this._tmpQuat)
      this._accScale = detail.scale
    } else {
      // Incremental mean. For quaternions slerp with a decaying weight
      // approximates the mean well enough over a few dozen near-identical
      // samples; a full eigen-decomposition is overkill here.
      const w = 1 / (this._n + 1)
      this._accPos.lerp(this._tmpPos.copy(detail.position), w)
      if (this._accQuat.dot(this._tmpQuat) < 0) {
        // Same rotation, opposite hemisphere — slerp would take the long way.
        this._tmpQuat.set(
          -this._tmpQuat.x, -this._tmpQuat.y, -this._tmpQuat.z, -this._tmpQuat.w)
      }
      this._accQuat.slerp(this._tmpQuat, w)
      this._accScale += (detail.scale - this._accScale) * w
    }

    if (++this._n >= this.samples) {
      this._lock()
      return true
    }
    return false
  }

  _lock() {
    this.origin.copy(this._accPos)
    this.originQuat.copy(this._accQuat).normalize()
    this.invQuat.copy(this.originQuat).invert()
    this.scale = this.knownWidth > 0 ? this.knownWidth / this._accScale : 1
    this.locked = true
  }

  /** Drop the lock and re-average on the next sightings of the marker. */
  realign() {
    this.locked = false
    this._n = 0
  }

  /**
   * Engine world space -> shared space. Mutates and returns outPos/outQuat.
   */
  toShared(worldPos, worldQuat, outPos, outQuat) {
    outPos.copy(worldPos)
      .sub(this.origin)
      .applyQuaternion(this.invQuat)
      .multiplyScalar(this.scale)
    outQuat.copy(this.invQuat).multiply(worldQuat)

    if (RIGHT_TO_LEFT_HANDED) {
      outPos.z = -outPos.z
      outQuat.set(-outQuat.x, -outQuat.y, outQuat.z, outQuat.w)
    }
    return outPos
  }

  /** Shared space -> engine world space, for placing remote avatars. */
  toWorld(sharedPos, sharedQuat, outPos, outQuat) {
    outPos.copy(sharedPos)
    outQuat.copy(sharedQuat)

    if (RIGHT_TO_LEFT_HANDED) {
      outPos.z = -outPos.z
      outQuat.set(-outQuat.x, -outQuat.y, outQuat.z, outQuat.w)
    }

    outPos.multiplyScalar(1 / this.scale)
      .applyQuaternion(this.originQuat)
      .add(this.origin)
    outQuat.premultiply(this.originQuat)
    return outPos
  }
}
