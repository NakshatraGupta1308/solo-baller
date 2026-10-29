"""Convert Gameplay Football / Google Research Football .anim clips to JSON.

Source format (one line per body part, keys are comma separated):
  player,frame,x,y,z,...                root offset per key (metres)
  <joint>,frame,qx,qy,qz,qw,...         local rotation per key
  extension,football,frame,x,y,z        frame and position where the foot meets the ball
  <tag> value </tag>                    metadata (balldirection, incomingballdirection, ...)
Frames are 10 ms apart. Space is Z up with the player facing -Y and +X on the
player's left. With every rotation at identity the skeleton stands straight with
the arms hanging, which matches the rest pose the game's rig retargeting uses.

Output space is the game's: Y up, facing +Z, +X on the left. Positions map
(x, y, z) -> (x, z, -y) and quaternions map the same way on their vector part.

Usage: python3 convert.py <source dir> <output dir>
"""

import json
import math
import os
import re
import sys

JOINTS = [
    'body', 'middle', 'neck',
    'left_shoulder', 'left_elbow', 'right_shoulder', 'right_elbow',
    'left_thigh', 'left_knee', 'left_ankle', 'right_thigh', 'right_knee', 'right_ankle',
]


def to_game_vec(x, y, z):
    return [x, z, -y]


def to_game_quat(x, y, z, w):
    return [x, z, -y, w]


def rotate(q, v):
    """Rotate vector v by unit quaternion q = [x, y, z, w]."""
    x, y, z, w = q
    vx, vy, vz = v
    # t = 2 * cross(q.xyz, v)
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)]


def parse(path):
    text = open(path, encoding='utf-8').read()
    lines = text.splitlines()
    tracks, touch = {}, None
    for line in lines:
        parts = [p.strip() for p in line.split(',')]
        if not parts or not parts[0] or parts[0].startswith('<'):
            break
        name = parts[0]
        if name == 'extension':
            if len(parts) >= 6 and parts[1] == 'football':
                f, x, y, z = int(parts[2]), *map(float, parts[3:6])
                touch = {'frame': f, 'pos': [round(c, 4) for c in to_game_vec(x, y, z)]}
            continue
        vals = parts[1:]
        keys = []
        if name == 'player':
            for i in range(0, len(vals) - 3, 4):
                f = int(vals[i])
                keys.append([f, *[round(c, 4) for c in to_game_vec(*map(float, vals[i + 1:i + 4]))]])
        else:
            for i in range(0, len(vals) - 4, 5):
                f = int(vals[i])
                q = to_game_quat(*map(float, vals[i + 1:i + 5]))
                n = math.sqrt(sum(c * c for c in q)) or 1
                keys.append([f, *[round(c / n, 5) for c in q]])
        tracks[name] = keys

    tags = {}
    for m in re.finditer(r'<(\w+)>\s*(.*?)\s*</\1>', text, re.S):
        tags[m.group(1)] = m.group(2).strip()
    return tracks, touch, tags


def convert(path):
    tracks, touch, tags = parse(path)
    missing = [j for j in JOINTS + ['player'] if j not in tracks]
    if missing:
        raise ValueError(f'{path}: missing tracks {missing}')
    frames = max(k[0] for keys in tracks.values() for k in keys)

    # how far the body turns over the clip (radians, positive turns toward +X / left)
    q_end = tracks['body'][-1][1:]
    fwd = rotate(q_end, [0, 0, 1])
    turn = math.atan2(fwd[0], fwd[2])

    clip = {
        'source': os.path.basename(path),
        'fps': 100,
        'frames': frames,
        'root': tracks['player'],
        'joints': {j: tracks[j] for j in JOINTS},
        'turn': round(turn, 4),
    }
    if touch:
        clip['touch'] = touch
        clip['foot'] = 'L' if touch['pos'][0] > 0.02 else 'R'
    for tag in ('balldirection', 'incomingballdirection'):
        if tag in tags:
            x, y, z = (float(v) for v in tags[tag].split(','))
            clip[tag] = [round(c, 4) for c in to_game_vec(x, y, z)]
    return clip


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    for name in sorted(os.listdir(src)):
        if not name.endswith('.anim'):
            continue
        clip = convert(os.path.join(src, name))
        dst = os.path.join(out, name[:-5] + '.json')
        with open(dst, 'w', encoding='utf-8') as f:
            json.dump(clip, f, separators=(',', ':'))
        t = clip.get('touch')
        print(f"{name}: {clip['frames']} frames, turn {math.degrees(clip['turn']):.0f} deg, "
              f"touch {t['frame'] if t else '-'} {clip.get('foot', '')} -> {dst}")


if __name__ == '__main__':
    main()
