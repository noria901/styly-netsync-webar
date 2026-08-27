// -----------------------------------------------------------------------------
// STYLY NetSync wire codec — protocol v8
// -----------------------------------------------------------------------------
// Ported from STYLY-NetSync-Server/src/styly_netsync/binary_serializer.py.
//
// The version byte is checked for strict equality on the server. A mismatch
// raises inside deserialize(), which is caught and turned into a dropped frame
// plus a server-side log line — the client is told nothing. So if poses stop
// appearing after a server upgrade, check PROTOCOL_VERSION before anything else.
//
// Note the source's own docstrings still say "protocol v5 compact format" in
// places. They are stale. The constant is the truth.

export const PROTOCOL_VERSION = 8

export const MSG = {
  RPC: 3,
  DEVICE_ID_MAPPING: 6,
  GLOBAL_VAR_SYNC: 8,
  CLIENT_VAR_SYNC: 10,
  CLIENT_POSE: 11,
  ROOM_POSE: 12,
  CLIENT_HELLO: 19,
}

const CLIENT_HELLO_FLAG_STEALTH = 0x01

// Head absolute position: int24 at 1 cm. Range is +/-83,886 m, so the play area
// is never the constraint — but 1 cm is the floor on positional precision.
const ABS_POS_SCALE = 0.01
// Hands and virtual transforms: int16 at 5 mm, RELATIVE TO HEAD. This is where
// the +/-163.84 m limit in the README applies. It is a limb-length budget, not
// a world-size budget.
const REL_POS_SCALE = 0.005
const LOCO_POS_SCALE = 0.01
const PHYSICAL_YAW_SCALE = 0.1

const POSE_FLAG_STEALTH = 1 << 0
const POSE_FLAG_PHYSICAL_VALID = 1 << 1
const POSE_FLAG_HEAD_VALID = 1 << 2
const POSE_FLAG_RIGHT_VALID = 1 << 3
const POSE_FLAG_LEFT_VALID = 1 << 4
const POSE_FLAG_MOVING_FLOOR_LOCAL = 1 << 6

const ENCODING_PHYSICAL_YAW_ONLY = 1 << 0
const ENCODING_RIGHT_REL_HEAD = 1 << 1
const ENCODING_LEFT_REL_HEAD = 1 << 2
const ENCODING_VIRTUAL_REL_HEAD = 1 << 3
const ENCODING_PHYSICAL_IS_XRORIGIN_DELTA = 1 << 4
const ENCODING_FLAGS_DEFAULT =
  ENCODING_PHYSICAL_YAW_ONLY | ENCODING_RIGHT_REL_HEAD | ENCODING_LEFT_REL_HEAD |
  ENCODING_VIRTUAL_REL_HEAD | ENCODING_PHYSICAL_IS_XRORIGIN_DELTA

const QUAT_MIN = -0.70710677
const QUAT_MAX = 0.70710677

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

// --- primitives --------------------------------------------------------------

class Writer {
  constructor() {
    this.bytes = []
  }
  u8(v) {
    this.bytes.push(v & 0xff)
    return this
  }
  u16(v) {
    this.bytes.push(v & 0xff, (v >> 8) & 0xff)
    return this
  }
  i16(v) {
    return this.u16(clamp(Math.round(v), -32768, 32767) & 0xffff)
  }
  u32(v) {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff)
    return this
  }
  i24(v) {
    const u = clamp(Math.round(v), -(1 << 23), (1 << 23) - 1) & 0xffffff
    this.bytes.push(u & 0xff, (u >> 8) & 0xff, (u >> 16) & 0xff)
    return this
  }
  f64(v) {
    const b = new Uint8Array(8)
    new DataView(b.buffer).setFloat64(0, v, true)
    for (const x of b) {
      this.bytes.push(x)
    }
    return this
  }
  str(s, ushort = false) {
    const b = new TextEncoder().encode(s)
    ushort ? this.u16(b.length) : this.u8(b.length)
    for (const x of b) {
      this.bytes.push(x)
    }
    return this
  }
  done() {
    return Buffer.from(this.bytes)
  }
}

class Reader {
  constructor(buf) {
    this.b = buf
    this.o = 0
  }
  u8() {
    return this.b[this.o++]
  }
  u16() {
    const v = this.b.readUInt16LE(this.o)
    this.o += 2
    return v
  }
  i16() {
    const v = this.b.readInt16LE(this.o)
    this.o += 2
    return v
  }
  u32() {
    const v = this.b.readUInt32LE(this.o)
    this.o += 4
    return v
  }
  i24() {
    let raw = this.b[this.o] | (this.b[this.o + 1] << 8) | (this.b[this.o + 2] << 16)
    this.o += 3
    if (raw & 0x800000) {
      raw -= 1 << 24
    }
    return raw
  }
  f64() {
    const v = this.b.readDoubleLE(this.o)
    this.o += 8
    return v
  }
  str(ushort = false) {
    const len = ushort ? this.u16() : this.u8()
    const s = this.b.subarray(this.o, this.o + len).toString('utf8')
    this.o += len
    return s
  }
}

// --- quaternion: smallest-three into uint32 ----------------------------------

function normalizeQuat(q) {
  const [x, y, z, w] = q
  const n = Math.hypot(x, y, z, w)
  return n < 1e-12 ? [0, 0, 0, 1] : [x / n, y / n, z / n, w / n]
}

export function packQuat(q) {
  let v = normalizeQuat(q)
  let largest = 0
  for (let i = 1; i < 4; i++) {
    if (Math.abs(v[i]) > Math.abs(v[largest])) {
      largest = i
    }
  }
  // The largest component's sign is not transmitted — it is reconstructed as
  // positive. Flip the whole quaternion when it isn't.
  if (v[largest] < 0) {
    v = v.map(c => -c)
  }

  let packed = largest << 30
  let wi = 0
  for (let i = 0; i < 4; i++) {
    if (i === largest) {
      continue
    }
    const c = clamp(v[i], QUAT_MIN, QUAT_MAX)
    const scaled = clamp(Math.round(((c - QUAT_MIN) / (QUAT_MAX - QUAT_MIN)) * 1023), 0, 1023)
    packed |= scaled << (20 - wi * 10)
    wi++
  }
  return packed >>> 0
}

export function unpackQuat(packed) {
  const largest = (packed >>> 30) & 0x3
  const raw = [(packed >>> 20) & 0x3ff, (packed >>> 10) & 0x3ff, packed & 0x3ff]
  const dec = v => QUAT_MIN + (QUAT_MAX - QUAT_MIN) * (v / 1023)

  const v = [0, 0, 0, 0]
  let ri = 0
  for (let i = 0; i < 4; i++) {
    if (i === largest) {
      continue
    }
    v[i] = dec(raw[ri++])
  }
  let sumSq = 0
  for (let i = 0; i < 4; i++) {
    if (i !== largest) {
      sumSq += v[i] * v[i]
    }
  }
  v[largest] = Math.sqrt(Math.max(0, 1 - sumSq))
  return normalizeQuat(v)
}

// --- uplink ------------------------------------------------------------------

/** Control lane. Binds this DEALER's identity to a device id. */
export function encodeClientHello(deviceId, isStealth = false) {
  return new Writer()
    .u8(MSG.CLIENT_HELLO)
    .u8(PROTOCOL_VERSION)
    .u8(isStealth ? CLIENT_HELLO_FLAG_STEALTH : 0)
    .str(deviceId)
    .done()
}

/**
 * Transform lane. A browser client normally has head only — no controllers, no
 * XR origin — so PHYSICAL/RIGHT/LEFT/VIRTUALS stay unset.
 *
 * The server keys everything off deviceId in this payload; the ZMQ identity is
 * only used for its unicast return path.
 */
export function encodeClientPose({deviceId, poseSeq = 0, head, stealth = false}) {
  const w = new Writer()
  w.u8(MSG.CLIENT_POSE).u8(PROTOCOL_VERSION).str(deviceId)

  let flags = 0
  if (stealth) {
    flags = POSE_FLAG_STEALTH
  } else if (head) {
    flags |= POSE_FLAG_HEAD_VALID
  }

  w.u16(poseSeq & 0xffff)
  w.u8(flags)
  w.u8(computeEncodingFlags(flags))

  if (flags & POSE_FLAG_HEAD_VALID) {
    w.i24(head.position[0] / ABS_POS_SCALE)
    w.i24(head.position[1] / ABS_POS_SCALE)
    w.i24(head.position[2] / ABS_POS_SCALE)
    w.u32(packQuat(head.rotation))
  }

  w.u8(0)   // virtual transform count
  return w.done()
}

function computeEncodingFlags(flags) {
  let e = ENCODING_FLAGS_DEFAULT
  if (flags & POSE_FLAG_MOVING_FLOOR_LOCAL) {
    e &= ~ENCODING_PHYSICAL_IS_XRORIGIN_DELTA
  }
  return e & 0xff
}

/** Control lane. An empty targetClientNos means broadcast to the room. */
export function encodeRpc(
  {deviceId, senderClientNo = 0, targetClientNos = [], functionName, argumentsJson}) {
  const w = new Writer()
  w.u8(MSG.RPC).u16(senderClientNo).str(deviceId)
  w.u8(targetClientNos.length)
  for (const n of targetClientNos) {
    w.u16(n)
  }
  w.str(functionName).str(argumentsJson, true)
  return w.done()
}

// --- downlink ----------------------------------------------------------------

export function decode(buf) {
  const r = new Reader(buf)
  const type = r.u8()

  switch (type) {
  case MSG.ROOM_POSE: {
    assertVersion(r.u8())
    const roomId = r.str()
    const broadcastTime = r.f64()
    const count = r.u16()
    const clients = []
    for (let i = 0; i < count; i++) {
      clients.push(readClientShort(r))
    }
    return {type: 'roomPose', roomId, broadcastTime, clients}
  }
  // Sent on the control lane whenever room membership changes. This is the
  // only place clientNo -> deviceId is published, so a client that ignores it
  // can never name its peers. Note there is NO version byte here — the layout
  // goes straight to a 3-byte server version.
  case MSG.DEVICE_ID_MAPPING: {
    const serverVersion = [r.u8(), r.u8(), r.u8()].join('.')
    const count = r.u16()
    const mappings = []
    for (let i = 0; i < count; i++) {
      mappings.push({
        clientNo: r.u16(),
        isStealth: r.u8() === 0x01,
        deviceId: r.str(),
      })
    }
    return {type: 'deviceIdMapping', serverVersion, mappings}
  }

  case MSG.GLOBAL_VAR_SYNC: {
    const count = r.u16()
    const variables = {}
    for (let i = 0; i < count; i++) {
      const name = r.str()
      const value = r.str(true)
      const lastWriterClientNo = r.u16()
      variables[name] = {value, lastWriterClientNo}
    }
    return {type: 'globalVarSync', variables}
  }

  case MSG.CLIENT_VAR_SYNC: {
    const clientCount = r.u16()
    const clients = {}
    for (let i = 0; i < clientCount; i++) {
      const clientNo = r.u16()
      const varCount = r.u16()
      const variables = {}
      for (let j = 0; j < varCount; j++) {
        const name = r.str()
        const value = r.str(true)
        const lastWriterClientNo = r.u16()
        variables[name] = {value, lastWriterClientNo}
      }
      clients[clientNo] = variables
    }
    return {type: 'clientVarSync', clients}
  }

  case MSG.RPC: {
    const senderClientNo = r.u16()
    const deviceId = r.str()
    const n = r.u8()
    const targetClientNos = []
    for (let i = 0; i < n; i++) {
      targetClientNos.push(r.u16())
    }
    return {
      type: 'rpc',
      senderClientNo,
      deviceId,
      targetClientNos,
      functionName: r.str(),
      argumentsJson: r.str(true),
    }
  }
  default:
    return {type: 'unhandled', msgType: type, raw: buf}
  }
}

function readClientShort(r) {
  const clientNo = r.u16()
  const poseTime = r.f64()
  const poseSeq = r.u16()
  const flags = r.u8()
  r.u8()   // encoding flags

  const out = {clientNo, poseTime, poseSeq, flags}

  if (flags & POSE_FLAG_PHYSICAL_VALID) {
    out.physical = {
      x: r.i16() * LOCO_POS_SCALE,
      y: r.i16() * LOCO_POS_SCALE,
      z: r.i16() * LOCO_POS_SCALE,
      yaw: r.i16() * PHYSICAL_YAW_SCALE,
    }
  }

  const headValid = !!(flags & POSE_FLAG_HEAD_VALID)
  if (headValid) {
    out.head = {
      position: [r.i24() * ABS_POS_SCALE, r.i24() * ABS_POS_SCALE, r.i24() * ABS_POS_SCALE],
      rotation: unpackQuat(r.u32()),
    }
  }

  if (headValid && flags & POSE_FLAG_RIGHT_VALID) {
    out.rightHand = readRelative(r, out.head)
  }
  if (headValid && flags & POSE_FLAG_LEFT_VALID) {
    out.leftHand = readRelative(r, out.head)
  }

  const virtualCount = r.u8()
  if (virtualCount) {
    out.virtuals = []
    for (let i = 0; i < virtualCount; i++) {
      out.virtuals.push(readRelative(r, out.head))
    }
  }
  return out
}

function readRelative(r, head) {
  const rel = [r.i16() * REL_POS_SCALE, r.i16() * REL_POS_SCALE, r.i16() * REL_POS_SCALE]
  const relRotation = unpackQuat(r.u32())
  if (!head) {
    return {relPosition: rel, relRotation}
  }
  return {
    position: [
      head.position[0] + rel[0],
      head.position[1] + rel[1],
      head.position[2] + rel[2],
    ],
    relRotation,
  }
}

function assertVersion(v) {
  if (v !== PROTOCOL_VERSION) {
    throw new Error(
      `protocol version mismatch: server sent ${v}, this codec speaks ${PROTOCOL_VERSION}`)
  }
}
