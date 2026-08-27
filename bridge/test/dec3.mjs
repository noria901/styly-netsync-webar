import * as c from './codec.js'
import {readFileSync} from 'fs'
const f = JSON.parse(readFileSync('sync_frames.json', 'utf8'))
for (const [k, hex] of Object.entries(f)) {
  console.log(k, '->', JSON.stringify(c.decode(Buffer.from(hex, 'hex'))))
}
