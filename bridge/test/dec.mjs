import * as c from './codec.js'
import {readFileSync} from 'fs'
const buf = Buffer.from(readFileSync('room_pose.hex','utf8').trim(), 'hex')
const m = c.decode(buf)
console.log('type:', m.type, ' room:', m.roomId, ' t:', m.broadcastTime, ' n:', m.clients.length)
for (const cl of m.clients) {
  console.log(` clientNo=${cl.clientNo} seq=${cl.poseSeq}`,
    'head=', cl.head.position.map(v=>+v.toFixed(3)),
    'quat=', cl.head.rotation.map(v=>+v.toFixed(3)),
    cl.rightHand ? ' rightHand='+JSON.stringify(cl.rightHand.position.map(v=>+v.toFixed(3))) : '')
}
