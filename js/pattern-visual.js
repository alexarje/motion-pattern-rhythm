/**
 * pattern-visual.js
 * Renders the multi-layer step-sequencer grid + playhead animation on a canvas.
 * Also draws a real-time spectrum analyser strip at the top.
 */
class PatternVisual {
  constructor(canvas, rhythmEngine, audioEngine) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.rhythm = rhythmEngine;
    this.audio  = audioEngine;

    this._animId  = null;
    this._analyser = null;
    this._specBuf  = null;
    this._glowStep = -1;    // step that just fired (for flash)
    this._glowAlpha = 0;

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas);
    this._resize();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────
  start() {
    if (this._animId) return;
    // Wire up analyser if audio is initialised
    if (this.audio.ctx && !this._analyser) {
      this._analyser = this.audio.ctx.createAnalyser();
      this._analyser.fftSize = 256;
      this._analyser.smoothingTimeConstant = 0.8;
      this.audio.masterGain.connect(this._analyser);
      this._specBuf = new Uint8Array(this._analyser.frequencyBinCount);
    }
    this._loop();
  }

  stop() {
    if (this._animId) { cancelAnimationFrame(this._animId); this._animId = null; }
  }

  flashStep(step) {
    this._glowStep  = step;
    this._glowAlpha = 1;
  }

  // ── Resize ────────────────────────────────────────────────────────────
  _resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width  = rect.width  || 800;
    this.canvas.height = rect.height || 400;
  }

  // ── Animation loop ────────────────────────────────────────────────────
  _loop() {
    this._draw();
    this._animId = requestAnimationFrame(() => this._loop());
  }

  _draw() {
    const { ctx, canvas, rhythm } = this;
    const W = canvas.width;
    const H = canvas.height;

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    // Spectrum strip
    const specH = Math.round(H * 0.12);
    this._drawSpectrum(0, 0, W, specH);

    // Grid area
    const snap    = rhythm.getSnapshot();
    const nLayers = snap.layers.length;
    const nSteps  = 16;
    const pad     = 8;
    const gridTop = specH + 6;
    const gridBot = H - 24;          // reserve bottom for step numbers
    const layerH  = (gridBot - gridTop) / nLayers;
    const stepW   = (W - pad * 2) / nSteps;

    // Draw grid background lines
    ctx.strokeStyle = '#1e1e2e';
    ctx.lineWidth   = 1;
    for (let s = 0; s <= nSteps; s++) {
      const x = pad + s * stepW;
      ctx.beginPath(); ctx.moveTo(x, gridTop); ctx.lineTo(x, gridBot); ctx.stroke();
    }
    for (let l = 0; l <= nLayers; l++) {
      const y = gridTop + l * layerH;
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W - pad, y); ctx.stroke();
    }

    // Draw cells
    for (let l = 0; l < nLayers; l++) {
      const layer = snap.layers[l];
      const y0    = gridTop + l * layerH;

      for (let s = 0; s < nSteps; s++) {
        const x0 = pad + s * stepW;
        const active = layer.pattern[s];
        const isCurrent = s === snap.step;

        if (active) {
          // Filled cell
          const alpha = isCurrent ? 1 : 0.7;
          ctx.fillStyle = layer.muted
            ? this._hexAlpha('#888888', alpha * 0.4)
            : this._hexAlpha(layer.color, alpha);
          ctx.fillRect(x0 + 1, y0 + 2, stepW - 2, layerH - 4);

          // Glow on current active step
          if (isCurrent && !layer.muted) {
            ctx.shadowColor = layer.color;
            ctx.shadowBlur  = 14;
            ctx.fillRect(x0 + 1, y0 + 2, stepW - 2, layerH - 4);
            ctx.shadowBlur  = 0;
          }
        } else {
          // Empty cell
          ctx.fillStyle = '#141420';
          ctx.fillRect(x0 + 1, y0 + 2, stepW - 2, layerH - 4);
          if (isCurrent) {
            ctx.strokeStyle = '#2a2a4a';
            ctx.lineWidth = 1;
            ctx.strokeRect(x0 + 1, y0 + 2, stepW - 2, layerH - 4);
          }
        }
      }

      // Layer label
      ctx.fillStyle = layer.muted ? '#444' : layer.color;
      ctx.font = `bold ${Math.max(9, layerH * 0.38)}px 'Courier New', monospace`;
      ctx.textAlign = 'left';
      ctx.fillText(layer.name, pad + 2, y0 + layerH * 0.68);
    }

    // Playhead
    const pxStep = pad + snap.step * stepW;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(pxStep, gridTop, stepW, gridBot - gridTop);

    ctx.fillStyle  = 'rgba(255,255,255,0.85)';
    ctx.fillRect(pxStep, gridTop, 2, gridBot - gridTop);

    // Step numbers
    ctx.fillStyle = '#3a3a5a';
    ctx.font = `${Math.max(8, 9)}px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    for (let s = 0; s < nSteps; s++) {
      if (s % 4 === 0) {
        const x = pad + s * stepW + stepW / 2;
        ctx.fillStyle = s === snap.step ? '#ffffff' : '#3a3a5a';
        ctx.fillText(s + 1, x, gridBot + 14);
      }
    }

    // Playback-stopped dim overlay
    if (!rhythm.isPlaying) {
      ctx.fillStyle = 'rgba(10,10,15,0.55)';
      ctx.fillRect(0, specH, W, H - specH);
      ctx.fillStyle = '#3a3a6a';
      ctx.font = 'bold 14px Courier New, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('PRESS ▶ START', W / 2, H / 2);
    }
  }

  _drawSpectrum(x, y, w, h) {
    const { ctx } = this;
    ctx.fillStyle = '#0d0d16';
    ctx.fillRect(x, y, w, h);

    if (!this._analyser) return;
    this._analyser.getByteFrequencyData(this._specBuf);
    const bins = this._specBuf.length;
    const bw   = w / bins;

    for (let i = 0; i < bins; i++) {
      const v  = this._specBuf[i] / 255;
      const bh = v * h;
      // Hue gradient: bass=red, mid=cyan, hi=purple
      const hue = 180 + (i / bins) * 200;
      ctx.fillStyle = `hsl(${hue}, 100%, ${40 + v * 40}%)`;
      ctx.fillRect(x + i * bw, y + h - bh, bw - 0.5, bh);
    }
  }

  _hexAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
}
