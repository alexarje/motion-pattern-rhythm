/**
 * rhythm-engine.js
 * Multi-layer Euclidean rhythm scheduler using Web Audio API clock.
 * Each layer carries a different synthesised instrument and an independently
 * generated Euclidean pattern that can be mutated in real-time.
 */

// C-minor pentatonic: C D Eb G Ab  (across 3 octaves)
const SCALE_BASS  = [36, 43, 48, 51, 55, 56, 60, 63, 67];   // MIDI
const SCALE_LEAD  = [60, 62, 63, 67, 68, 72, 74, 75, 79];
const SCALE_COUNT = [55, 58, 60, 63, 65, 67, 70, 72, 75];
const SCALE_PAD   = [36, 43, 48, 51];

function midiToFreq(n) { return 440 * Math.pow(2, (n - 69) / 12); }

// Euclidean rhythm generator – returns bool[] of length `steps`
function euclidean(pulses, steps, offset = 0) {
  if (pulses <= 0) return new Array(steps).fill(false);
  if (pulses >= steps) return new Array(steps).fill(true);

  let pattern = [];
  let bucket = 0;
  for (let i = 0; i < steps; i++) {
    bucket += pulses;
    if (bucket >= steps) {
      bucket -= steps;
      pattern.push(true);
    } else {
      pattern.push(false);
    }
  }
  // Apply offset rotation
  if (offset) {
    offset = ((offset % steps) + steps) % steps;
    pattern = [...pattern.slice(offset), ...pattern.slice(0, offset)];
  }
  return pattern;
}

// Layer definitions
const LAYER_DEFS = [
  { id: 0, name: 'KICK',   color: '#ff3366', pulses:  4, steps: 16, offset: 0, inst: 'kick',   baseScale: null },
  { id: 1, name: 'SNARE',  color: '#ff7043', pulses:  2, steps: 16, offset: 4, inst: 'snare',  baseScale: null },
  { id: 2, name: 'HH-CL',  color: '#ffca28', pulses:  8, steps: 16, offset: 0, inst: 'hhC',    baseScale: null },
  { id: 3, name: 'HH-OP',  color: '#66bb6a', pulses:  3, steps: 16, offset: 2, inst: 'hhO',    baseScale: null },
  { id: 4, name: 'BASS',   color: '#00e5ff', pulses:  5, steps: 16, offset: 0, inst: 'bass',   baseScale: SCALE_BASS },
  { id: 5, name: 'LEAD',   color: '#40c4ff', pulses:  3, steps: 16, offset: 3, inst: 'lead',   baseScale: SCALE_LEAD },
  { id: 6, name: 'CNTR',   color: '#ce93d8', pulses:  5, steps: 16, offset: 6, inst: 'counter',baseScale: SCALE_COUNT },
  { id: 7, name: 'PAD',    color: '#f48fb1', pulses:  2, steps: 16, offset: 8, inst: 'pad',    baseScale: SCALE_PAD },
];

class RhythmEngine {
  constructor(audioEngine) {
    this.audio = audioEngine;
    this.tempo = 120;            // BPM
    this.isPlaying = false;
    this.lookahead   = 25;       // ms between scheduler ticks
    this.scheduleAhead = 0.12;   // seconds to schedule ahead

    this._timerID   = null;
    this._nextBeat  = 0;         // Web Audio clock time of next step
    this._step      = 0;         // current global step (0-15)
    this._bar       = 0;         // bars elapsed

    // Per-layer state
    this.layers = LAYER_DEFS.map(def => ({
      ...def,
      pattern:   euclidean(def.pulses, def.steps, def.offset),
      muted:     false,
      velocity:  1.0,
      pitchIdx:  0,              // walking index through scale
      complexityMod: 0,          // -pulses … +pulses modifier
    }));

    this._fillBars       = 0;      // bars remaining in fill mode
    this._pitchTranspose = 0;      // semitone offset applied to melodic layers

    // Callbacks
    this.onStep  = null;   // (step, activeFlags) → void
    this.onBar   = null;   // (bar) → void
    this.onBeat  = null;   // (beat) → void  (quarter-note pulse)
  }

  // ── Public controls ──────────────────────────────────────────────────
  start() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this._step     = 0;
    this._bar      = 0;
    this._nextBeat = this.audio.currentTime + 0.05;
    this._tick();
  }

  stop() {
    this.isPlaying = false;
    clearTimeout(this._timerID);
  }

  setTempo(bpm) {
    this.tempo = Math.max(40, Math.min(240, bpm));
  }

  setLayerMute(layerId, muted) {
    const l = this.layers[layerId];
    if (l) l.muted = muted;
  }

  setLayerVelocity(layerId, vel) {
    const l = this.layers[layerId];
    if (l) l.velocity = Math.max(0, Math.min(1, vel));
  }

  /** Rebuild Euclidean patterns for layers 0-3 (drums) with a complexity modifier */
  setDrumComplexity(mod) {
    // mod: 0..1 where 0.5 is default
    const delta = Math.round((mod - 0.5) * 8); // -4..+4
    for (const layer of this.layers.slice(0, 4)) {
      const def = LAYER_DEFS[layer.id];
      const newPulses = Math.max(1, Math.min(def.steps - 1, def.pulses + delta));
      layer.pattern = euclidean(newPulses, def.steps, def.offset);
    }
  }

  /** Rebuild Euclidean patterns for melodic layers 4-7 */
  setMelodicComplexity(mod) {
    const delta = Math.round((mod - 0.5) * 6);
    for (const layer of this.layers.slice(4)) {
      const def = LAYER_DEFS[layer.id];
      const newPulses = Math.max(1, Math.min(def.steps - 1, def.pulses + delta));
      layer.pattern = euclidean(newPulses, def.steps, def.offset);
    }
  }

  /** Transpose melodic layers by semitone offset */
  setPitchTranspose(semitones) {
    this._pitchTranspose = Math.round(semitones);
  }

  setBassIntensity(v) {
    const l = this.layers[4];
    if (l) l.velocity = Math.max(0.1, Math.min(1.2, v));
  }

  triggerFill() {
    // Temporarily set all drum layers to full density for one bar
    this._fillBars = 1;
    for (const layer of this.layers.slice(0, 4)) {
      layer._fillPattern = new Array(layer.steps).fill(true);
    }
  }

  // ── Scheduling loop ──────────────────────────────────────────────────
  _tick() {
    const now = this.audio.currentTime;
    while (this._nextBeat < now + this.scheduleAhead) {
      this._scheduleStep(this._step, this._nextBeat);

      const secPerStep = (60 / this.tempo) / 4; // 16th note
      this._nextBeat += secPerStep;

      const prevStep = this._step;
      this._step = (this._step + 1) % 16;
      if (this._step === 0) {
        this._bar++;
        if (this._fillBars > 0) {
          this._fillBars--;
          if (this._fillBars === 0) {
            for (const layer of this.layers.slice(0, 4)) {
              layer._fillPattern = null;
            }
          }
        }
        if (this.onBar) this.onBar(this._bar);
      }
      // Quarter-note pulse
      if (prevStep % 4 === 0 && this.onBeat) this.onBeat(prevStep / 4);
    }

    if (this.onStep) this.onStep(this._step);

    if (this.isPlaying) {
      this._timerID = setTimeout(() => this._tick(), this.lookahead);
    }
  }

  _scheduleStep(step, time) {
    const transpose = this._pitchTranspose;

    for (const layer of this.layers) {
      if (layer.muted) continue;

      const pattern = layer._fillPattern || layer.pattern;
      if (!pattern[step]) continue;

      const vel = layer.velocity;

      switch (layer.inst) {
        case 'kick':    this.audio.kick(time, vel); break;
        case 'snare':   this.audio.snare(time, vel); break;
        case 'hhC':     this.audio.hihatClosed(time, vel * 0.7); break;
        case 'hhO':     this.audio.hihatOpen(time, vel * 0.6); break;
        case 'bass': {
          const scale = layer.baseScale;
          const idx   = (layer.pitchIdx + Math.floor(step * 0.4)) % scale.length;
          const freq  = midiToFreq(scale[idx] + transpose * 0.3);
          this.audio.bass(time, freq, vel);
          break;
        }
        case 'lead': {
          const scale = layer.baseScale;
          const idx   = (step + Math.floor(this._bar * 0.7)) % scale.length;
          const freq  = midiToFreq(scale[idx] + transpose);
          this.audio.lead(time, freq, vel * 0.75);
          break;
        }
        case 'counter': {
          const scale = layer.baseScale;
          const idx   = ((step * 3) + this._bar) % scale.length;
          const freq  = midiToFreq(scale[idx] + transpose);
          this.audio.counter(time, freq, vel * 0.6);
          break;
        }
        case 'pad': {
          const scale = layer.baseScale;
          const idx   = Math.floor(this._bar / 2) % scale.length;
          const freq  = midiToFreq(scale[idx] + transpose);
          this.audio.pad(time, freq, vel * 0.4);
          break;
        }
      }
    }
  }

  // ── Snapshot (for visual) ─────────────────────────────────────────────
  getSnapshot() {
    return {
      step:   this._step,
      layers: this.layers.map(l => ({
        id:      l.id,
        name:    l.name,
        color:   l.color,
        pattern: [...(l._fillPattern || l.pattern)],
        muted:   l.muted,
      })),
    };
  }
}
