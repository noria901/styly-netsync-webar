import bs, json
# Build a ROOM_POSE broadcast exactly as the server would, and hand it to JS.
room = {
  "roomId": "venue-a",
  "broadcastTime": 1234.5,
  "clients": [
    {"clientNo": 1, "poseTime": 10.25, "poseSeq": 3,
     "head": {"posX": 0.5, "posY": 1.6, "posZ": -2.0,
              "rotX": 0.0, "rotY": 0.7071, "rotZ": 0.0, "rotW": 0.7071}},
    {"clientNo": 7, "poseTime": 10.30, "poseSeq": 4,
     "head": {"posX": -3.0, "posY": 1.5, "posZ": 4.25,
              "rotX": 0.0, "rotY": 0.0, "rotZ": 0.0, "rotW": 1.0},
     "rightHand": {"posX": -2.7, "posY": 1.2, "posZ": 4.35,
                   "rotX":0,"rotY":0,"rotZ":0,"rotW":1}},
  ],
}
open('room_pose.hex','w').write(bs.serialize_room_transform(room).hex())
print("server-encoded ROOM_POSE:", len(bs.serialize_room_transform(room)), "bytes")
