#!/bin/bash
# End-to-end: NetSync server <- bridge <- two headless WebAR clients
set -u
cd /home/claude/run
rm -f *.log

echo "### starting server"
python3 -m styly_netsync --no-server-discovery > server.log 2>&1 &
SERVER=$!
sleep 7

echo "### starting bridge"
cd /home/claude/8thwall-imgtarget-sample/bridge
node server.js > /home/claude/run/bridge.log 2>&1 &
BRIDGE=$!
sleep 2
cd /home/claude/run

echo "### starting clients"
node fakeclient.mjs a normal > a.log 2>&1 &
sleep 1
node fakeclient.mjs b normal > b.log 2>&1 &
sleep 2
node fakeclient.mjs c stealth > c.log 2>&1 &

sleep 12

echo "### REST API from 'browser' (CORS check)"
curl -s -i -X OPTIONS http://127.0.0.1:8800/v1/rooms/venue-a/global-variables \
  -H "Origin: https://192.168.1.10:5173" \
  -H "Access-Control-Request-Method: POST" | head -12
echo
curl -s -X POST http://127.0.0.1:8800/v1/rooms/venue-a/global-variables \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://192.168.1.10:5173' \
  -d '{"variables":{"markerScale":"0.2","anchor":"sample-target"}}'
echo
curl -s http://127.0.0.1:8800/v1/rooms/venue-a/global-variables \
  -H 'Origin: https://192.168.1.10:5173'
echo

echo "### prefix-matching check: does room 'venue' receive 'venue-a' traffic?"
ROOM=venue node - <<'EOF'
import('zeromq').then(async zmq => {
  const sub = new zmq.Subscriber()
  sub.connect('tcp://127.0.0.1:5556')
  sub.subscribe('venue')          // deliberately a PREFIX of venue-a
  let n = 0
  const topics = new Set()
  const timer = setTimeout(() => {
    console.log(`  frames=${n} topics=${[...topics].join(',')}`)
    process.exit(0)
  }, 3000)
  for await (const [topic] of sub) {
    n++
    topics.add(topic.toString())
    if (n > 200) { clearTimeout(timer); break }
  }
  console.log(`  frames=${n} topics=${[...topics].join(',')}`)
  process.exit(0)
})
EOF

sleep 1
kill $BRIDGE 2>/dev/null
sleep 1
kill $SERVER 2>/dev/null
sleep 2

echo
echo "======== CLIENT A ========"; cat a.log
echo "======== CLIENT B ========"; cat b.log
echo "======== CLIENT C (stealth) ========"; cat c.log
echo "======== BRIDGE ========"; cat bridge.log
echo "======== SERVER (filtered) ========"
grep -v "^$" server.log | grep -viE "██|╗|╔|╚|╝|═" | tail -40
