// Keyboard, mouse look, pointer lock and the two mouse "feet": the left button is
// the left foot and the right button is the right foot. While a button is held,
// mouse movement belongs to that foot (a stroke) instead of the camera.

export function createInput(canvas) {
  const keys = new Set();
  const handlers = {};
  let lookX = 0, lookY = 0, wheel = 0;
  let settleUntil = 0;
  const feet = { L: null, R: null }; // active stroke per foot: { pts, t0 }
  const emit = (name, ...a) => handlers[name]?.(...a);

  const locked = () => document.pointerLockElement === canvas;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    emit('key', e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => { keys.clear(); for (const s of ['L', 'R']) if (feet[s]) up(s); });

  const sideOf = (button) => (button === 0 ? 'L' : button === 2 ? 'R' : null);
  function up(side) {
    const f = feet[side];
    feet[side] = null;
    emit('footUp', side, f.pts, (performance.now() - f.t0) / 1000);
  }

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (!locked() && e.button === 0) emit('wantLock');
    const side = sideOf(e.button);
    if (!side) return;
    feet[side] = { pts: [{ x: 0, y: 0, t: 0 }], t0: performance.now() };
    emit('footDown', side);
  });
  window.addEventListener('mouseup', (e) => {
    const side = sideOf(e.button);
    if (side && feet[side]) up(side);
  });
  // Chrome batches mousemove to the next animation frame but delivers mouseup at once,
  // so a quick flick could lose its last movement. pointerrawupdate is unbatched.
  const rawMoves = 'onpointerrawupdate' in window;
  window.addEventListener(rawMoves ? 'pointerrawupdate' : 'mousemove', (e) => {
    // skip the jump some browsers report right after locking, and spurious spikes
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    if (!e.movementX && !e.movementY) return; // raw pointer updates also fire with no movement
    const active = feet.R ? 'R' : feet.L ? 'L' : null;
    if (active) {
      const f = feet[active];
      const last = f.pts[f.pts.length - 1];
      f.pts.push({ x: last.x + e.movementX, y: last.y + e.movementY, t: (performance.now() - f.t0) / 1000 });
      emit('footMove', active, e.movementX, e.movementY, f.pts);
      return;
    }
    if (locked() && performance.now() > settleUntil) { lookX += e.movementX; lookY += e.movementY; }
  });
  document.addEventListener('pointerlockchange', () => { settleUntil = performance.now() + 120; });
  canvas.addEventListener('wheel', (e) => { wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

  return {
    keys,
    on(name, fn) { handlers[name] = fn; },
    down: (code) => keys.has(code),
    held: (side) => !!feet[side],
    stroke: (side) => feet[side],
    locked,
    takeLook() { const r = [lookX, lookY]; lookX = 0; lookY = 0; return r; },
    takeWheel() { const w = wheel; wheel = 0; return w; },
    lock() { canvas.requestPointerLock?.()?.catch?.(() => {}); },
  };
}
