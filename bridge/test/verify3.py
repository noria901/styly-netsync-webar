import bs, json
out = {}
out["mapping"] = bs.serialize_device_id_mapping(
    [(1, "web-a", False), (2, "quest-xyz", False), (3, "dashboard", True)],
    version=(0, 17, 4)).hex()
out["globalSync"] = bs.serialize_global_var_sync({"variables": [
    {"name": "markerScale", "value": "0.2", "lastWriterClientNo": 4},
    {"name": "anchor", "value": "sample-target", "lastWriterClientNo": 4},
]}).hex()
out["clientSync"] = bs.serialize_client_var_sync({"clientVariables": {
    "1": [{"name": "nickname", "value": "noria", "lastWriterClientNo": 1}],
    "2": [{"name": "role", "value": "spectator", "lastWriterClientNo": 2},
          {"name": "hp", "value": "100", "lastWriterClientNo": 2}],
}}).hex()
json.dump(out, open("sync_frames.json", "w"))
print("generated", {k: len(v)//2 for k, v in out.items()}, "bytes")
