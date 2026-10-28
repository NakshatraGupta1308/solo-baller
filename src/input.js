// Keyboard, mouse look, pointer lock and right-button gesture capture.

export function createInput(canvas) {
  const keys = new Set();
  const handlers = {};
  let lookX = 0, lookY = 0, wheel = 0;
  let gesture = null;
  let settleUntil = 0;
  const emit = (name, ...a) => handlers[name]?.(...a);

  const locked = () => document.pointerLockElement === canvas;

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    emit('key', e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (!locked() && e.button === 0) emit('wantLock');
    if (e.button === 0) emit('lmbDown');
    if (e.button === 2) { gesture = [{ x: 0, y: 0 }]; emit('gestureStart'); }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) emit('lmbUp');
    if (e.button === 2 && gesture) { const g = gesture; gesture = null; emit('gestureEnd', g); }
  });
  window.addEventListener('mousemove', (e) => {
    if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
    if (gesture) {
      const last = gesture[gesture.length - 1];
      gesture.push({ x: last.x + e.movementX, y: last.y + e.movementY });
      emit('gestureMove', gesture);
      return;
    }
    // skip the jump some browsers report right after locking, and spurious spikes
    if (locked() && performance.now() > settleUntil) {
      lookX += e.movementX; lookY += e.movementY;
    }
  });
  document.addEventListener('pointerlockchange', () => { settleUntil = performance.now() + 120; });
  canvas.addEventListener('wheel', (e) => { wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });

  return {
    keys,
    on(name, fn) { handlers[name] = fn; },
    down: (code) => keys.has(code),
    locked,
    takeLook() { const r = [lookX, lookY]; lookX = 0; lookY = 0; return r; },
    takeWheel() { const w = wheel; wheel = 0; return w; },
    lock() { canvas.requestPointerLock?.()?.catch?.(() => {}); },
  };
}
