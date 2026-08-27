#!/bin/bash
# Scenario 2: bridge and server actually up.
set -u
cd /home/claude/run

python3 -m styly_netsync --no-server-discovery > fb_server.log 2>&1 &
SERVER=$!
sleep 7
cd /home/claude/8thwall-imgtarget-sample/bridge && node server.js > /home/claude/run/fb_bridge.log 2>&1 &
BRIDGE=$!
sleep 2
cd /home/claude/run

# A peer, so remotes is non-empty.
node fakeclient.mjs peer normal > fb_peer.log 2>&1 &
sleep 1

timeout 30 node fallback-test.mjs live

sleep 1
kill $BRIDGE 2>/dev/null; sleep 1
kill $SERVER 2>/dev/null; sleep 1
echo "--- server saw ---"
grep -viE "██|╗|╔|╚|╝|═" fb_server.log | grep -iE "Assigned|Status" | tail -4
