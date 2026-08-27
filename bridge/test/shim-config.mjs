globalThis.window = globalThis.window ?? {location:{protocol:'https:',search:''}}
export function readMultiplayerConfig(search = window.location.search) {
  const q = new URLSearchParams(search)
  const bridge = q.get('bridge')
  if (!bridge) {
    return null
  }
  // A page served over https can only open wss. ws:// is blocked as mixed
  // content before any I/O happens, so catch it here and say why.
  if (window.location.protocol === 'https:' && bridge.startsWith('ws://')) {
    console.warn(
      '[netsync] ignoring ws:// bridge on an https page (mixed content). ' +
      'Use wss:// with a real certificate.')
    return null
  }
  return {bridge, room: q.get('room') || 'default'}
}
