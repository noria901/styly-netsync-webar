import json, bs

js = json.load(open('js_out.json'))

def py_hex(b): return b.hex()

checks = []

# 1. hello
checks.append(("hello", js["hello"], py_hex(bs.serialize_client_hello("web-abc123", False))))
checks.append(("helloStealth", js["helloStealth"], py_hex(bs.serialize_client_hello("web-abc123", True))))

# 2. pose
pose_data = {
    "deviceId": "web-abc123",
    "poseSeq": 42,
    "head": {"posX":1.234,"posY":-0.567,"posZ":2.891,
             "rotX":0.1,"rotY":0.2,"rotZ":0.3,"rotW":0.927},
}
checks.append(("pose", js["pose"], py_hex(bs.serialize_client_transform(pose_data))))

stealth_data = {"deviceId":"web-abc123","poseSeq":7,"flags":bs.POSE_FLAG_STEALTH}
checks.append(("poseStealth", js["poseStealth"], py_hex(bs.serialize_client_transform(stealth_data))))

# 3. rpc
rpc_data = {"deviceId":"web-abc123","senderClientNo":5,"targetClientNos":[],
            "functionName":"SyncObj","argumentsJson":json.dumps(["a",1],separators=(',',':'))}
checks.append(("rpc", js["rpc"], py_hex(bs.serialize_rpc_message(rpc_data))))

ok = True
for name, a, b in checks:
    match = a == b
    ok &= match
    print(f"{'OK ' if match else 'FAIL'} {name}")
    if not match:
        print(f"   js: {a}\n   py: {b}")

print()
# 4. Round-trip: does the server's deserializer accept our frames?
for name in ("pose","poseStealth","rpc","hello"):
    raw = bytes.fromhex(js[name])
    t, data, _ = bs.deserialize(raw)
    print(f"deserialize({name}) -> type={t} data={'OK' if data is not None else 'REJECTED'}")
    if name == "pose":
        print("   decoded head:", {k:round(v,4) for k,v in data['clients'][0]['head'].items()}
              if 'clients' in data else {k:round(v,4) for k,v in data['head'].items()})
print()
print("ALL BYTE-EXACT" if ok else "MISMATCH")
