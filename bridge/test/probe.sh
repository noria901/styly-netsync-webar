#!/bin/bash
# Focused probe: REST global variables timing, and whether a REST write
# materialises a phantom client in the room.
set -u
cd /home/claude/run
rm -f probe*.log

python3 -m styly_netsync --no-server-discovery > probe_server.log 2>&1 &
SERVER=$!
sleep 7

cd /home/claude/8thwall-imgtarget-sample/bridge
node server.js > /home/claude/run/probe_bridge.log 2>&1 &
BRIDGE=$!
sleep 2
cd /home/claude/run

# One real client so the room exists and we can watch roomPose membership.
node fakeclient.mjs a normal > probe_a.log 2>&1 &
sleep 2

echo "### T+0  POST global variable"
curl -s -X POST http://127.0.0.1:8800/v1/rooms/venue-a/global-variables \
  -H 'Content-Type: application/json' -H 'Origin: https://example.test' \
  -d '{"variables":{"markerScale":"0.2"}}'
echo

for t in 0 1 2 3; do
  echo "### T+${t}s  GET"
  curl -s http://127.0.0.1:8800/v1/rooms/venue-a/global-variables
  echo
  sleep 1
done

echo "### client-variables for a device that never connected"
curl -s -X POST http://127.0.0.1:8800/v1/rooms/venue-a/devices/ghost-device/client-variables \
  -H 'Content-Type: application/json' -d '{"variables":{"x":"1"}}'
echo
echo "### /logs/export reachable without auth?"
curl -s -o /dev/null -w "  HTTP %{http_code}, %{size_download} bytes\n" \
  "http://127.0.0.1:8800/logs/export"

sleep 6
kill $BRIDGE 2>/dev/null; sleep 1
kill $SERVER 2>/dev/null; sleep 2

echo
echo "======== CLIENT A (room membership over time) ========"
cat probe_a.log
echo "======== SERVER ========"
grep -viE "██|╗|╔|╚|╝|═" probe_server.log | grep -iE "client|Global|Status|stealth" | tail -30
