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
| Left click | Tap to pass, hold to charge a shot. Hold `A`/`D` as you release to curl it. Aim higher for a chip with backspin |
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
| `Z` | | La Croqueta (hold `A`/`D` to pick the side) |
| `X` | | Cruyff turn (hold `A`/`D` to pick the side) |
| `T` | | Sole roll (hold `A`/`D` to pick the side) |
| `Y` | | Sombrero flick |
| `G` | | Keepy-uppy mode |

### Animation

The legs are driven by inverse kinematics: every move places the ankles where they need to be (on top of the ball, wrapped around it, passing over it) and the hips and knees follow. The step over genuinely circles the boot over the ball from the inside to the outside, the elastico pushes with the outside of the boot and wraps around to snap it back with the inside, the roulette drags with each sole in turn, and the rainbow rolls the ball up the back of the standing calf before the heel flicks it over. Running uses planted feet that stay put on the grass, with a lifted swing, hip bob, arm pump and a counter-twisting torso, and every joint is smoothed so poses blend instead of snapping. Shots connect when the swinging boot reaches the ball.

### Close control

When the ball is at your feet a thin green ring appears under it. While you have it, the ball stays glued just ahead of your boot: small touches in rhythm with your steps when jogging, bigger touches when sprinting, and it stops under your sole when you stop. You only give it up when you pass, shoot, flick it or start juggling, and loose balls are collected as soon as they come within reach. Balls dropping from the air (like your own rainbow flick) are cushioned down to your feet.

### Bumps and bounces

A loose ball bounces off whatever part of you it hits: head, chest, thighs, shins, feet or arms. A moving limb passes some of its speed on, so running into a loose ball nudges it ahead, and glancing contacts put spin on it. On the ground the ball bounces like a real one on grass (a 2.5 m drop comes back up to about 1 m), with a slightly uneven turf feel and a little squash on landing.

Skills chain into combos (up to x5) if you land the next one within a couple of seconds. Catch your own rainbow flick before it lands for a bonus. Goals score 500, and shots through the green rings in the top corners score 1000.

## How it's built

- [three.js](https://threejs.org) r170, vendored in `vendor/` so the game runs offline and on GitHub Pages without a bundler.
- `src/shaders.js`: the graph-paper ground and sky, the procedural pitch (mowing stripes, line markings, a ragged grass edge) and instanced grass blades that wrap around the camera and bend away from the ball and the player.
- `src/ball.js`: ball physics with gravity, quadratic drag, Magnus curl, dip and lift, and a contact friction spin model (a skidding ball grips and starts rolling, backspin checks up on the bounce, topspin kicks on). Plus rolling resistance on grass and goal frame and net collisions.
- `src/player.js`: the pose pipeline: two-bone leg IK, a planted-foot gait, skill and kick pose overrides, and joint smoothing, with a simple mannequin as a fallback while the model loads.
- `src/rig.js`: loads the rigged player model, paints a plain kit on it, retargets the pose system onto its Mixamo bones, builds bone-following capsules for ball collisions, and clips the upper body in first person.
- `src/skills.js`: each skill's ball path, spline foot paths for both feet, body motion and release, plus the mouse gesture recogniser.
- `src/main.js`: the fixed-step game loop, close control (a stride-synced spring that keeps the ball at your feet), first touch and cushioning, shooting, keepy-uppy, scoring and the camera.

The visual style (paper white, graph lines, a single green accent) is inspired by graph-paper construction sheets.

## Roadmap ideas

- 1v1 against a simple defender
- Cone slalom time trial using the cones already on the pitch
- More skills (rabona, around the world, heel chop, Berba spin)
- Replay camera for clipping your best moves
- More locations: street court, rooftop, beach, night stadium

## Credits

- Player model: the "X Bot" character from [Mixamo](https://www.mixamo.com), as distributed with the [three.js examples](https://github.com/mrdoob/three.js/tree/dev/examples/models/gltf). The kit colours are applied in code.
- [three.js](https://threejs.org) and its glTF loader, MIT licensed (see `vendor/three.LICENSE`).

## Using your own player model

Replace `assets/player.glb` with any humanoid rigged with Mixamo bone names (for example a character auto-rigged on mixamo.com, exported as FBX and converted to GLB). Only use models you have the rights to publish.

## License

MIT for the game code.
