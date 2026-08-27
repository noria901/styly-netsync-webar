import * as c from './codec.js'
const out = {}
out.hello = c.encodeClientHello('web-abc123', false).toString('hex')
out.helloStealth = c.encodeClientHello('web-abc123', true).toString('hex')
out.pose = c.encodeClientPose({
  deviceId: 'web-abc123', poseSeq: 42,
  head: {position: [1.234, -0.567, 2.891], rotation: [0.1, 0.2, 0.3, 0.927]},
}).toString('hex')
out.poseStealth = c.encodeClientPose({deviceId: 'web-abc123', poseSeq: 7, stealth: true}).toString('hex')
out.rpc = c.encodeRpc({
  deviceId: 'web-abc123', senderClientNo: 5, targetClientNos: [],
  functionName: 'SyncObj', argumentsJson: JSON.stringify(['a', 1]),
}).toString('hex')
console.log(JSON.stringify(out))
