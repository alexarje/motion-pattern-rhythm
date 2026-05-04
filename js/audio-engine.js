/**
 * audio-engine.js
 * Web Audio API synthesizer – kick, snare, hi-hat, bass, lead, counter, pad.
 * All synthesis is done with native Web Audio nodes (no external libraries).
 */
class AudioEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.reverbNode = null;
    this.reverbGain = null;
    this.dryGain = null;
    this.compressor = null;
    this._reverbBuffer = null;
    this.reverbAmount = 0.3;
    this.masterVolume = 0.8;
  }

  // ── Initialise (must be called from a user gesture) ──────────────────
  async init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    // Master chain: compressor → dry/wet → destination
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = this.masterVolume;

    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 1 - this.reverbAmount;

    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = this.reverbAmount;

    this.reverbNode = this.ctx.createConvolver();
    this._reverbBuffer = this._buildReverbBuffer(2.5);
    this.reverbNode.buffer = this._reverbBuffer;

    this.masterGain.connect(this.dryGain);
    this.masterGain.connect(this.reverbGain);
    this.reverbGain.connect(this.reverbNode);
    this.dryGain.connect(this.compressor);
    this.reverbNode.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
  }

  // ── Parameter setters ────────────────────────────────────────────────
  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.05);
    }
  }

  setReverb(wet) {
    this.reverbAmount = Math.max(0, Math.min(0.95, wet));
    if (this.reverbGain) {
      this.reverbGain.gain.setTargetAtTime(this.reverbAmount, this.ctx.currentTime, 0.1);
      this.dryGain.gain.setTargetAtTime(1 - this.reverbAmount * 0.7, this.ctx.currentTime, 0.1);
    }
  }

  get currentTime() { return this.ctx ? this.ctx.currentTime : 0; }

  // ── Drum synthesisers ────────────────────────────────────────────────
  kick(time, velocity = 1) {
    const gain = this._gain(this.masterGain);
    const osc  = this._osc('sine', 150);
    const click = this._osc('sine', 800);
    const clickGain = this._gain(this.masterGain);

    osc.connect(gain.node);
    gain.node.connect(this.masterGain);

    click.connect(clickGain.node);
    clickGain.node.connect(this.masterGain);

    // Pitch sweep
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.06);

    gain.node.gain.setValueAtTime(velocity * 0.9, time);
    gain.node.gain.exponentialRampToValueAtTime(0.001, time + 0.45);

    // Transient click
    clickGain.node.gain.setValueAtTime(velocity * 0.3, time);
    clickGain.node.gain.exponentialRampToValueAtTime(0.001, time + 0.012);

    this._schedule(osc, time, time + 0.45);
    this._schedule(click, time, time + 0.015);
  }

  snare(time, velocity = 1) {
    // Noise body
    const noiseGain = this._gain(this.masterGain);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2800;
    filter.Q.value = 0.6;

    const noise = this._noise(0.22);
    noise.connect(filter);
    filter.connect(noiseGain.node);
    noiseGain.node.connect(this.masterGain);

    noiseGain.node.gain.setValueAtTime(velocity * 0.75, time);
    noiseGain.node.gain.exponentialRampToValueAtTime(0.001, time + 0.22);
    this._schedule(noise, time, time + 0.22);

    // Tonal body
    const tonicGain = this._gain(this.masterGain);
    const osc = this._osc('triangle', 200);
    osc.connect(tonicGain.node);
    tonicGain.node.connect(this.masterGain);

    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(100, time + 0.1);
    tonicGain.node.gain.setValueAtTime(velocity * 0.35, time);
    tonicGain.node.gain.exponentialRampToValueAtTime(0.001, time + 0.14);
    this._schedule(osc, time, time + 0.14);
  }

  hihatClosed(time, velocity = 1) {
    const noiseGain = this._gain(this.masterGain);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;

    const noise = this._noise(0.08);
    noise.connect(hp);
    hp.connect(noiseGain.node);
    noiseGain.node.connect(this.masterGain);

    noiseGain.node.gain.setValueAtTime(velocity * 0.5, time);
    noiseGain.node.gain.exponentialRampToValueAtTime(0.001, time + 0.07);
    this._schedule(noise, time, time + 0.08);
  }

  hihatOpen(time, velocity = 1) {
    const noiseGain = this._gain(this.masterGain);
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5500;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 14000;

    const noise = this._noise(0.45);
    noise.connect(hp);
    hp.connect(lp);
    lp.connect(noiseGain.node);
    noiseGain.node.connect(this.masterGain);

    noiseGain.node.gain.setValueAtTime(velocity * 0.4, time);
    noiseGain.node.gain.exponentialRampToValueAtTime(0.001, time + 0.42);
    this._schedule(noise, time, time + 0.45);
  }

  perc(time, pitch = 440, velocity = 1) {
    const gain = this._gain(this.masterGain);
    const osc  = this._osc('sine', pitch * 2.1);
    osc.connect(gain.node);
    gain.node.connect(this.masterGain);

    osc.frequency.setValueAtTime(pitch * 2.1, time);
    osc.frequency.exponentialRampToValueAtTime(pitch * 0.8, time + 0.08);
    gain.node.gain.setValueAtTime(velocity * 0.55, time);
    gain.node.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    this._schedule(osc, time, time + 0.19);
  }

  // ── Melodic synthesisers ─────────────────────────────────────────────
  bass(time, freq, velocity = 1) {
    const dur = 0.35;
    const gain = this._gain(this.masterGain);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 3;

    const osc1 = this._osc('sawtooth', freq);
    const osc2 = this._osc('square',   freq * 0.501);
    const blend = this._gain(filter);
    blend.node.gain.value = 0.4;
    osc2.connect(blend.node);
    osc1.connect(filter);
    blend.node.connect(filter);
    filter.connect(gain.node);
    gain.node.connect(this.masterGain);

    filter.frequency.setValueAtTime(freq * 12, time);
    filter.frequency.exponentialRampToValueAtTime(freq * 1.5, time + 0.05);
    gain.node.gain.setValueAtTime(velocity * 0.85, time);
    gain.node.gain.exponentialRampToValueAtTime(velocity * 0.5, time + dur * 0.6);
    gain.node.gain.exponentialRampToValueAtTime(0.001, time + dur);

    this._schedule(osc1, time, time + dur);
    this._schedule(osc2, time, time + dur);
  }

  lead(time, freq, velocity = 1) {
    const dur = 0.28;
    const gain  = this._gain(this.masterGain);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 4;
    filter.Q.value = 1.2;

    const osc  = this._osc('sawtooth', freq);
    const osc2 = this._osc('sawtooth', freq * 1.004);
    const blend = this._gain(filter);
    blend.node.gain.value = 0.5;
    osc.connect(filter);
    osc2.connect(blend.node);
    blend.node.connect(filter);
    filter.connect(gain.node);
    gain.node.connect(this.masterGain);

    gain.node.gain.setValueAtTime(0.001, time);
    gain.node.gain.linearRampToValueAtTime(velocity * 0.6, time + 0.01);
    gain.node.gain.exponentialRampToValueAtTime(0.001, time + dur);

    this._schedule(osc,  time, time + dur);
    this._schedule(osc2, time, time + dur);
  }

  counter(time, freq, velocity = 1) {
    const dur = 0.22;
    const gain  = this._gain(this.masterGain);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq * 2;
    filter.Q.value = 0.8;

    const osc  = this._osc('square', freq);
    osc.connect(filter);
    filter.connect(gain.node);
    gain.node.connect(this.masterGain);

    gain.node.gain.setValueAtTime(velocity * 0.4, time);
    gain.node.gain.exponentialRampToValueAtTime(0.001, time + dur);
    this._schedule(osc, time, time + dur);
  }

  pad(time, freq, velocity = 1) {
    const dur = 1.2;
    const gain  = this._gain(this.masterGain);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq * 3;

    const oscs = [1, 1.498, 1.999, 2.503].map(r => {
      const o = this._osc('sine', freq * r);
      o.connect(filter);
      return o;
    });
    filter.connect(gain.node);
    gain.node.connect(this.masterGain);

    gain.node.gain.setValueAtTime(0.001, time);
    gain.node.gain.linearRampToValueAtTime(velocity * 0.3, time + 0.08);
    gain.node.gain.exponentialRampToValueAtTime(0.001, time + dur);
    oscs.forEach(o => this._schedule(o, time, time + dur));
  }

  // ── Internal helpers ─────────────────────────────────────────────────
  _osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    return o;
  }

  _gain(destination) {
    const n = this.ctx.createGain();
    return { node: n };
  }

  _noise(duration) {
    const samples = Math.ceil(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, samples, this.ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  _schedule(node, start, stop) {
    node.start(start);
    node.stop(stop);
  }

  _buildReverbBuffer(durationSec) {
    const rate    = this.ctx.sampleRate;
    const length  = Math.ceil(rate * durationSec);
    const buf     = this.ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
      }
    }
    return buf;
  }
}
