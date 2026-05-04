/**
 * app.js
 * Main controller – wires AudioEngine, RhythmEngine, PatternVisual,
 * MotionTracker, and MotionMapper together.
 */

// ── Layer colours (matches CSS variables) ───────────────────────────────
const LAYER_COLORS = ['#ff3366','#ff7043','#ffca28','#66bb6a','#00e5ff','#40c4ff','#ce93d8','#f48fb1'];
const LAYER_NAMES  = ['KICK','SNARE','HH-CL','HH-OP','BASS','LEAD','CNTR','PAD'];

class App {
  constructor() {
    this.audio   = new AudioEngine();
    this.rhythm  = new RhythmEngine(this.audio);
    this.visual  = null;
    this.tracker = null;
    this.mapper  = new MotionMapper();

    this._isStarted  = false;
    this._cameraOn   = false;
    this._beatFlash  = false;
    this._fillActive = false;
    this._paramLoopId = null;

    this._boundHandlers = {};
  }

  // ── Boot ─────────────────────────────────────────────────────────────
  init() {
    // DOM references
    this._els = {
      btnStart:   document.getElementById('btn-start-audio'),
      btnStop:    document.getElementById('btn-stop'),
      btnCamera:  document.getElementById('btn-camera'),
      camStatus:  document.getElementById('camera-status'),
      bpmValue:   document.getElementById('bpm-value'),
      beatInd:    document.getElementById('beat-indicator'),
      noCamera:   document.getElementById('no-camera-msg'),
      video:      document.getElementById('video'),
      poseCanvas: document.getElementById('pose-canvas'),
      patCanvas:  document.getElementById('pattern-canvas'),
      layerCtrls: document.getElementById('layer-controls'),
      fills: {
        tempo:      document.getElementById('fill-tempo'),
        volume:     document.getElementById('fill-volume'),
        complexity: document.getElementById('fill-complexity'),
        reverb:     document.getElementById('fill-reverb'),
        pitch:      document.getElementById('fill-pitch'),
        bass:       document.getElementById('fill-bass'),
      },
    };

    this._buildLayerButtons();
    this._attachEvents();
    this._syncPoseCanvasSize();
    window.addEventListener('resize', () => this._syncPoseCanvasSize());

    // Show the pattern grid immediately (without audio)
    this.visual = new PatternVisual(this._els.patCanvas, this.rhythm, this.audio);
    this.visual.start();
  }

  // ── Events ───────────────────────────────────────────────────────────
  _attachEvents() {
    this._els.btnStart.addEventListener('click', () => this._start());
    this._els.btnStop.addEventListener('click',  () => this._stop());
    this._els.btnCamera.addEventListener('click', () => this._toggleCamera());
  }

  // ── Start audio + sequencer ──────────────────────────────────────────
  async _start() {
    if (this._isStarted) return;

    await this.audio.init();
    this._isStarted = true;

    // Wire analyser into existing visual (audio now available)
    if (this.visual) {
      this.visual.stop();
      this.visual = new PatternVisual(this._els.patCanvas, this.rhythm, this.audio);
      this.visual.start();
    }

    // Rhythm callbacks
    this.rhythm.onStep = (step) => this.visual && this.visual.flashStep(step);
    this.rhythm.onBeat = (_beat) => this._flashBeat();

    this.rhythm.start();

    // UI state
    this._els.btnStart.disabled = true;
    this._els.btnStop.disabled  = false;
    this._els.bpmValue.textContent = this.rhythm.tempo;

    // Start param update loop
    this._paramLoop();
  }

  _stop() {
    this.rhythm.stop();
    // Restart visual in stopped state (grid remains visible)
    if (this.visual) {
      this.visual.stop();
      this.visual = new PatternVisual(this._els.patCanvas, this.rhythm, this.audio);
      this.visual.start();
    }
    this._isStarted = false;
    this._els.btnStart.disabled = false;
    this._els.btnStop.disabled  = true;
    if (this._paramLoopId) { clearInterval(this._paramLoopId); this._paramLoopId = null; }
  }

  // ── Camera ───────────────────────────────────────────────────────────
  async _toggleCamera() {
    if (this._cameraOn) {
      await this.tracker.stop();
      this._cameraOn = false;
      this._els.camStatus.textContent = 'OFF';
      this._els.camStatus.className   = 'status-off';
      this._els.noCamera.classList.remove('hidden');
      this._els.btnCamera.textContent = '📷 CAMERA';
    } else {
      if (!this.tracker) {
        this.tracker = new MotionTracker(this._els.video, this._els.poseCanvas);
        this.tracker.onPoseUpdate   = (lm) => this._onPose(lm);
        this.tracker.onStatusChange = (on) => {
          this._cameraOn = on;
          this._els.camStatus.textContent = on ? 'ON' : 'OFF';
          this._els.camStatus.className   = on ? 'status-on' : 'status-off';
          if (on) this._els.noCamera.classList.add('hidden');
        };
      }
      this._els.btnCamera.textContent = '⏳ STARTING…';
      await this.tracker.start();
      this._els.btnCamera.textContent = '📷 CAMERA';
    }
  }

  // ── Pose callback ─────────────────────────────────────────────────────
  _onPose(landmarks) {
    this.mapper.update(landmarks);
  }

  // ── Parameter update loop (runs at ~10 fps independently of audio) ───
  _paramLoop() {
    this._paramLoopId = setInterval(() => this._applyParams(), 100);
  }

  _applyParams() {
    if (!this._isStarted) return;
    const m = this.mapper;

    // Apply to rhythm/audio only if camera is on
    if (this._cameraOn) {
      const bpm = m.getBPM();
      this.rhythm.setTempo(bpm);
      this.audio.setMasterVolume(m.getVolume());
      this.audio.setReverb(m.getReverb());
      this.rhythm.setDrumComplexity(m.getDrumDensity());
      this.rhythm.setPitchTranspose(m.getPitchSemitones());
      this.rhythm.setBassIntensity(m.getBassIntensity());

      // Layer emphasis via torso lean
      const lean = m.getLean();
      // lean > 0.6 → boost right-side melodic layers; < 0.4 → boost drum layers
      for (let i = 0; i < 8; i++) {
        if (i < 4) {
          this.rhythm.setLayerVelocity(i, 0.6 + (1 - lean) * 0.4);
        } else {
          this.rhythm.setLayerVelocity(i, 0.4 + lean * 0.6);
        }
      }

      // Fill on gesture
      if (m.isFill() && !this._fillActive) {
        this._fillActive = true;
        this.rhythm.triggerFill();
        setTimeout(() => { this._fillActive = false; }, 1500);
      }

      // Update HUD bars
      this._setBar('tempo',      m.params.tempo);
      this._setBar('volume',     m.params.volume);
      this._setBar('complexity', m.getDrumDensity());
      this._setBar('reverb',     m.params.reverb);
      this._setBar('pitch',      m.params.pitch);
      this._setBar('bass',       m.params.bass);
    }

    // Always update BPM display
    this._els.bpmValue.textContent = this.rhythm.tempo;
  }

  // ── Beat flash ────────────────────────────────────────────────────────
  _flashBeat() {
    const ind = this._els.beatInd;
    ind.classList.add('flash');
    setTimeout(() => ind.classList.remove('flash'), 80);
  }

  // ── Layer buttons ─────────────────────────────────────────────────────
  _buildLayerButtons() {
    const container = this._els.layerCtrls;
    container.innerHTML = '';

    for (let i = 0; i < 8; i++) {
      const btn = document.createElement('button');
      btn.className = 'layer-btn active';
      btn.dataset.layer = i;
      btn.style.color = LAYER_COLORS[i];
      btn.innerHTML = `<span class="dot" style="background:${LAYER_COLORS[i]}"></span>${LAYER_NAMES[i]}`;
      btn.addEventListener('click', () => {
        const isActive = btn.classList.toggle('active');
        const muted = !isActive;
        this.rhythm.setLayerMute(i, muted);
        btn.style.color = muted ? '#444' : LAYER_COLORS[i];
        btn.querySelector('.dot').style.background = muted ? '#444' : LAYER_COLORS[i];
      });
      container.appendChild(btn);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────
  _setBar(name, value) {
    const el = this._els.fills[name];
    if (el) el.style.width = Math.round(Math.max(0, Math.min(1, value)) * 100) + '%';
  }

  _syncPoseCanvasSize() {
    const container = this._els.poseCanvas.parentElement;
    const rect = container.getBoundingClientRect();
    this._els.poseCanvas.width  = rect.width;
    this._els.poseCanvas.height = rect.height;
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
  window._app = app;  // expose for debugging
});
