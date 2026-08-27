# Verification

## Unit — byte-parity with the Python serializer

Copy `src/styly_netsync/binary_serializer.py` from a STYLY-NetSync-Server
checkout next to these scripts as `bs.py`, and `../codec.js` as `codec.js`.

```bash
node gen.mjs > js_out.json
python3 verify.py     # hello / pose / stealth pose / RPC -> byte-identical
python3 verify2.py && node dec.mjs    # server ROOM_POSE -> decoded by codec.js
python3 verify3.py && node dec3.mjs   # DEVICE_ID_MAPPING / GLOBAL_VAR_SYNC / CLIENT_VAR_SYNC
```

## Integration — against a running server

```bash
pip install -e path/to/STYLY-NetSync-Server
bash e2e.sh      # server + bridge + 3 headless clients, ~30s
bash probe.sh    # REST global-variable timing, phantom-client effect
```

`e2e.sh` also checks that a SUB on room `venue` receives `venue-a` traffic —
the prefix-matching behaviour the bridge guards against in software.

`fakeclient.mjs <name> <normal|stealth>` is a headless stand-in for the browser:
same WebSocket messages, no camera. Useful on its own for load-testing the
bridge without standing up phones.

Paths in these scripts assume the layout they were written against
(`/home/claude/run`, `/home/claude/8thwall-imgtarget-sample`). Adjust before use.
