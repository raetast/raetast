const tooltips = document.querySelectorAll('.info-tooltip');
tooltips.forEach((tooltip) => {
  let frame = null;
  let pointer;
  tooltip.addEventListener('mousemove', (event) => {
    pointer = { x: event.clientX, y: event.clientY };
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const rect = tooltip.getBoundingClientRect();
      tooltip.style.setProperty('--tooltip-x', `${pointer.x - rect.left}px`);
      tooltip.style.setProperty('--tooltip-y', `${pointer.y - rect.top}px`);
    });
  }, { passive: true });
  tooltip.addEventListener('mouseleave', () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });
});

const currentYear = document.getElementById('current-year');
if (currentYear) {
  currentYear.textContent = new Date().getFullYear();
}

function initHeadlineOrbit() {
  const stage = document.querySelector('.stage');
  const layers = stage ? [...stage.querySelectorAll('.layer')] : [];
  if (!layers.length || !layers[0].animate) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 600px)');
  let animations = [];

  const keyframes = () => {
    const style = getComputedStyle(stage);
    const orbitX = parseFloat(style.getPropertyValue('--orbit-x'));
    const orbitY = parseFloat(style.getPropertyValue('--orbit-y'));

    // Dense sine samples let the browser animate a smooth figure-eight on the compositor.
    return Array.from({ length: 257 }, (_, index) => {
      const offset = index / 256;
      const phase = offset * Math.PI * 2;
      const horizontal = Math.sin(phase);
      const vertical = Math.sin(phase * 2);
      return {
        offset,
        transform: `translate3d(${orbitX * horizontal}px, ${orbitY * vertical}px, 0) rotateY(${24 * horizontal}deg) rotateX(${18 * vertical}deg)`,
      };
    });
  };

  const updateMotion = () => {
    animations.forEach(animation => animation.cancel());
    animations = [];
    if (reduceMotion.matches) return;

    const frames = keyframes();
    const startTime = document.timeline.currentTime - 3000;
    animations = layers.map(layer => {
      const animation = layer.animate(frames, { duration: 16000, iterations: Infinity });
      animation.startTime = startTime;
      if (document.hidden) animation.pause();
      return animation;
    });
  };

  mobile.addEventListener('change', () => {
    if (!animations.length) return;
    const frames = keyframes();
    animations.forEach(animation => animation.effect.setKeyframes(frames));
  });
  reduceMotion.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', () => {
    animations.forEach(animation => document.hidden ? animation.pause() : animation.play());
  });
  updateMotion();
}

function initHeadlinePixels() {
  const stage = document.querySelector('.stage');
  const front = stage?.querySelector('.layer');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!front || !window.DOMMatrixReadOnly ||
      !(CSS.supports('background-clip', 'text') || CSS.supports('-webkit-background-clip', 'text'))) return;

  const size = 48;
  const cellSize = 8;
  const glowSize = size * cellSize;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return;

  const pixels = context.createImageData(size, size);
  const phases = Float32Array.from({ length: size * size }, (_, i) => {
    const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
    return (seed - Math.floor(seed)) * Math.PI * 2;
  });
  const swirlOffsets = Float64Array.from(phases, (_, i) => (i % size) * 0.49 + Math.floor(i / size) * 0.36);
  const noiseRates = Float64Array.from(phases, phase => 1.4 + phase * 0.22);
  const palette = [
    [255, 170, 190], [255, 145, 156], [242, 109, 125], [220, 99, 114],
    [180, 81, 95], [139, 63, 74], [96, 46, 53], [60, 32, 37],
    [33, 22, 26], [17, 17, 17],
  ];
  let pointer = null;
  let pointerInside = false;
  let lastPosition = null;
  let strength = 0;
  let frame = null;
  let timer = null;
  let lastPaint = null;
  let geometry = null;

  const reset = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    if (timer !== null) clearTimeout(timer);
    timer = geometry = null;
    frame = lastPaint = null;
    pointer = lastPosition = null;
    pointerInside = false;
    strength = 0;
    stage.classList.remove('pixel-active');
    for (const property of ['--pixel-texture', '--pixel-x', '--pixel-y']) {
      stage.style.removeProperty(property);
    }
  };

  const projectPointer = () => {
    // Only the animated transform changes between paints; cache the static geometry.
    if (!geometry) {
      const layerStyle = getComputedStyle(front);
      const stageStyle = getComputedStyle(stage);
      const [originX, originY] = layerStyle.transformOrigin.split(' ').map(parseFloat);
      const [perspectiveX, perspectiveY] = stageStyle.perspectiveOrigin.split(' ').map(parseFloat);
      geometry = {
        bounds: stage.getBoundingClientRect(),
        originX, originY, perspectiveX, perspectiveY,
        perspective: parseFloat(stageStyle.perspective),
        width: stage.offsetWidth,
        height: parseFloat(getComputedStyle(front, '::after').height),
      };
    }
    const { bounds, originX, originY, perspectiveX, perspectiveY, perspective, width, height } = geometry;
    const layerStyle = getComputedStyle(front);
    const matrix = new DOMMatrixReadOnly(layerStyle.transform);
    const u = pointer.x - bounds.left - perspectiveX;
    const v = pointer.y - bounds.top - perspectiveY;

    // Invert the text plane's perspective so the glow follows the pointer as it tilts.
    const a = matrix.m11 + u * matrix.m13 / perspective;
    const b = matrix.m21 + u * matrix.m23 / perspective;
    const c = matrix.m12 + v * matrix.m13 / perspective;
    const d = matrix.m22 + v * matrix.m23 / perspective;
    const x = u * (1 - matrix.m43 / perspective) - originX + perspectiveX - matrix.m41;
    const y = v * (1 - matrix.m43 / perspective) - originY + perspectiveY - matrix.m42;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 0.001) return null;
    return {
      x: (d * x - b * y) / determinant + originX,
      y: (a * y - c * x) / determinant + originY,
      width,
      height,
    };
  };

  const paintTexture = (time) => {
    const center = size / 2;
    const driftX = Math.sin(time * 1.17) * 3.9 + Math.sin(time * 2.93) * 1.5;
    const driftY = Math.cos(time * 1.43) * 3.3 + Math.sin(time * 3.47) * 1.5;
    const satelliteX = center + Math.sin(time * 0.83 + 1.4) * 9;
    const satelliteY = center + Math.cos(time * 1.09) * 7.5;
    for (let y = 0; y < size; y++) {
      const rowSwirl = Math.sin(y * 0.31 - time) * 2.8;
      for (let x = 0; x < size; x++) {
        const cell = y * size + x;
        const phase = phases[cell];
        const envelope = Math.max(0, 1 - Math.hypot(x - center - driftX, y - center - driftY) / 19.5);
        const satellite = Math.max(0, 1 - Math.hypot(x - satelliteX, y - satelliteY) / 10.5);
        const swirl = Math.sin(swirlOffsets[cell] + time * 2.8 + rowSwirl);
        const noise = Math.sin(time * noiseRates[cell] + phase);
        const spark = Math.pow(Math.max(0, Math.sin(time * 2.3 + phase)), 10);
        const energy = Math.min(1, Math.max(0,
          envelope * (0.86 + swirl * 0.42 + noise * 0.3) +
          satellite * 0.35 + spark * envelope * 0.45
        ));
        const color = palette[Math.round(energy * (palette.length - 1))];
        const offset = cell * 4;
        pixels.data[offset] = color[0];
        pixels.data[offset + 1] = color[1];
        pixels.data[offset + 2] = color[2];
        pixels.data[offset + 3] = Math.round(255 * envelope * energy * strength * 0.8);
      }
    }
    context.putImageData(pixels, 0, 0);
    stage.style.setProperty('--pixel-texture', `url("${canvas.toDataURL('image/png')}")`);
  };

  const animate = (timestamp) => {
    frame = null;
    if (document.hidden || reduceMotion.matches || !finePointer.matches || !pointer) {
      reset();
      return;
    }
    const position = projectPointer();
    const nearHeadline = pointerInside && position &&
      position.x >= 0 && position.x <= position.width &&
      position.y >= -glowSize / 4 && position.y <= position.height + glowSize / 4;
    const elapsed = lastPaint === null ? 1000 / 16 : timestamp - lastPaint;
    strength += ((nearHeadline ? 1 : 0) - strength) * (1 - Math.exp(-elapsed / 90));
    if (!nearHeadline && strength < 0.01) {
      reset();
      return;
    }
    if (nearHeadline) lastPosition = position;
    if (lastPosition) {
      stage.style.setProperty('--pixel-x', `${Math.round(lastPosition.x / cellSize) * cellSize - glowSize / 2}px`);
      stage.style.setProperty('--pixel-y', `${Math.round(lastPosition.y / cellSize) * cellSize - glowSize / 2}px`);
      paintTexture(timestamp / 1000);
      stage.classList.add('pixel-active');
    }
    lastPaint = timestamp;
    // Wake only for the next 16 fps paint, then align it with the browser's frame.
    timer = setTimeout(() => {
      timer = null;
      frame = requestAnimationFrame(animate);
    }, 1000 / 16);
  };

  window.addEventListener('pointermove', (event) => {
    if (document.hidden || reduceMotion.matches || !finePointer.matches || event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    pointerInside = true;
    if (frame === null && timer === null) frame = requestAnimationFrame(animate);
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { pointerInside = false; });
  window.addEventListener('blur', reset);
  window.addEventListener('scroll', reset, { passive: true });
  window.addEventListener('resize', reset);
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  reduceMotion.addEventListener('change', reset);
  finePointer.addEventListener('change', reset);
}

initHeadlineOrbit();
initHeadlinePixels();
