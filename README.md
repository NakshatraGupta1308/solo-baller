# Solo Baller

A casual 3D football sandbox. You are one player with a ball on a mown pitch laid over an endless sheet of graph paper. Dribble, juggle, pull off skills with the keyboard or mouse gestures, and try to bend one into the top bin.

Play in first person or third person, and switch any time with `V`.

## Run it

It's a static site with no build step. Serve the folder with any static server:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk won't work, because browsers block ES modules on `file://`.

## Controls

| Input | Action |
|---|---|
| `WASD` | Move (relative to the camera) |
| `Shift` | Sprint |
| Mouse | Look and aim (click the game to lock the pointer) |
| Arrow keys | Look, if the pointer can't be locked |
| Left click | Tap to pass, hold to charge a shot. Hold `A`/`D` as you release to curl it |
| `Space` | Jump, or a juggle touch in keepy-uppy mode |
| `V` | Toggle first / third person |
| `B` | Bring the ball back to your feet |
| `H` | Show / hide all controls |
| Mouse wheel | Third person camera distance |

### Skills

| Key | Gesture (hold right mouse and draw) | Skill |
|---|---|---|
| `Q` | zig-zag left and right | Step over |
| `E` | swipe left or right | Elastico (goes the way you swipe) |
| `R` | draw a circle | Roulette |
| `F` | flick up | Rainbow flick |
| `C` | pull down | Drag back |
| `G` | | Keepy-uppy mode |

Skills chain into combos (up to x5) if you land the next one within a couple of seconds. Catch your own rainbow flick before it lands for a bonus. Goals score 500, and shots through the green rings in the top corners score 1000.

## How it's built

- [three.js](https://threejs.org) r170, vendored in `vendor/` so the game runs offline and on GitHub Pages without a bundler.
- `src/shaders.js`: the graph-paper ground and sky, the procedural pitch (mowing stripes, line markings, a ragged grass edge) and instanced grass blades that wrap around the camera and bend away from the ball and the player.
- `src/ball.js`: ball physics with gravity, quadratic drag, Magnus curl, bounce, rolling resistance on grass, goal frame and net collisions.
- `src/player.js`: a procedural mannequin rig with a run cycle and pose overrides.
- `src/skills.js`: each skill's pose, ball path and release, plus the mouse gesture recogniser.
- `src/main.js`: the fixed-step game loop, dribbling and first touch, shooting, keepy-uppy, scoring and the camera.

The visual style (paper white, graph lines, a single green accent) is inspired by graph-paper construction sheets.

## Roadmap ideas

- 1v1 against a simple defender
- Cone slalom time trial using the cones already on the pitch
- More skills (rabona, sombrero flick, Cruyff turn, around the world)
- Replay camera for clipping your best moves
- More locations: street court, rooftop, beach, night stadium

## License

MIT. three.js is MIT licensed too (see `vendor/three.LICENSE`).
