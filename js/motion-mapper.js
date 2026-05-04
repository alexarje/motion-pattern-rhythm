/**
 * motion-mapper.js
 * Maps MediaPipe Pose landmarks to musical/rhythmic control parameters.
 *
 * Landmark indices (MediaPipe Pose 33-point model):
 *  0  = nose           11/12 = shoulders
 *  13/14 = elbows      15/16 = wrists
 *  23/24 = hips        25/26 = knees   27/28 = ankles
 *
 * Coordinate system: x,y in [0..1], y=0 = top of frame.
 *
 * Gesture → parameter mapping:
 *  Right wrist Y   → tempo      (0.8=60BPM, 0.1=200BPM)
 *  Left wrist Y    → volume     (y low = high volume)
 *  Right arm angle → drum density
 *  Left arm angle  → reverb
 *  Torso lean X    → layer emphasis / balance
 *  Head Y / nose   → pitch transpose
 *  Hip height      → bass intensity
 *  Both wrists > shoulders → fill trigger
 */
class MotionMapper {
  constructor() {
    // Smoothed output parameters (0..1 unless noted)
    this.params = {
      tempo:       0.5,   // maps to BPM
      volume:      0.7,
      drumDensity: 0.5,
      reverb:      0.3,
      lean:        0.5,   // 0=left, 1=right
      pitch:       0.5,   // maps to semitone transpose
      bass:        0.5,
      fill:        false,
    };

    this._alpha        = 0.25;  // EMA smoothing for params
    this._fillCooldown = 0;     // frames remaining before next fill allowed
    this._prevFill     = false;
  }

  // ── Process landmarks ────────────────────────────────────────────────
  update(lm) {
    if (!lm || lm.length < 29) return;

    const get = (i) => (lm[i] && (lm[i].visibility || 0) > 0.4) ? lm[i] : null;

    const rWrist    = get(16);
    const lWrist    = get(15);
    const rElbow    = get(14);
    const lElbow    = get(13);
    const rShoulder = get(12);
    const lShoulder = get(11);
    const rHip      = get(24);
    const lHip      = get(23);
    const nose      = get(0);

    const raw = {};

    // ── Tempo: right wrist height (y)
    if (rWrist) {
      // y 0=top, 1=bottom.  Low y (raised hand) → faster tempo
      raw.tempo = 1 - Math.min(1, Math.max(0, (rWrist.y - 0.05) / 0.85));
    }

    // ── Volume: left wrist height
    if (lWrist) {
      raw.volume = 1 - Math.min(1, Math.max(0, (lWrist.y - 0.05) / 0.85));
    }

    // ── Drum density: right arm angle (angle at elbow shoulder→elbow→wrist)
    if (rShoulder && rElbow && rWrist) {
      raw.drumDensity = this._armSpread(rShoulder, rElbow, rWrist);
    }

    // ── Reverb: left arm spread
    if (lShoulder && lElbow && lWrist) {
      raw.reverb = this._armSpread(lShoulder, lElbow, lWrist);
    }

    // ── Torso lean: midpoint of shoulders vs midpoint of hips
    if (rShoulder && lShoulder && rHip && lHip) {
      const shoulderMidX = (rShoulder.x + lShoulder.x) / 2;
      const hipMidX      = (rHip.x + lHip.x) / 2;
      // positive = leaning right in camera (left in mirror)
      raw.lean = Math.min(1, Math.max(0, 0.5 + (shoulderMidX - hipMidX) * 3));
    }

    // ── Pitch: nose vertical position
    if (nose) {
      raw.pitch = 1 - Math.min(1, Math.max(0, (nose.y - 0.02) / 0.6));
    }

    // ── Bass intensity: hip height (y close to 0.5-1 range normally)
    if (rHip && lHip) {
      const hipY = (rHip.y + lHip.y) / 2;
      // Squatting pushes hips lower (higher y) → more bass
      raw.bass = Math.min(1, Math.max(0, (hipY - 0.3) / 0.5));
    }

    // ── Fill: both wrists raised above shoulders
    let fillNow = false;
    if (rWrist && lWrist && rShoulder && lShoulder) {
      const rRaised = rWrist.y < rShoulder.y - 0.08;
      const lRaised = lWrist.y < lShoulder.y - 0.08;
      fillNow = rRaised && lRaised;
    }

    // EMA smooth all continuous params
    const a = this._alpha;
    for (const key of ['tempo','volume','drumDensity','reverb','lean','pitch','bass']) {
      if (raw[key] !== undefined) {
        this.params[key] = a * raw[key] + (1 - a) * this.params[key];
      }
    }

    // Fill trigger: rising edge with cooldown
    if (this._fillCooldown > 0) this._fillCooldown--;
    if (fillNow && !this._prevFill && this._fillCooldown === 0) {
      this.params.fill = true;
      // Cooldown ~3 seconds at typical MediaPipe processing rate (~30 fps).
      // Increase this value if fills trigger too frequently on slower devices.
      this._fillCooldown = 90;
    } else {
      this.params.fill = false;
    }
    this._prevFill = fillNow;
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  /**
   * Returns normalised arm "openness" 0..1 based on distance
   * from shoulder to wrist relative to shoulder-elbow distance.
   */
  _armSpread(shoulder, elbow, wrist) {
    const segLen  = this._dist(shoulder, elbow);
    const totalLen = this._dist(shoulder, wrist);
    if (segLen < 0.001) return 0.5;
    // Ratio: 1 = arm fully extended, 0 = arm folded
    return Math.min(1, Math.max(0, totalLen / (segLen * 2)));
  }

  _dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── Derived musical parameters ────────────────────────────────────────
  getBPM()     { return Math.round(60 + this.params.tempo * 140); }        // 60..200
  getVolume()  { return Math.max(0.05, this.params.volume); }
  getReverb()  { return this.params.reverb * 0.85; }
  getLean()    { return this.params.lean; }
  getDrumDensity()    { return this.params.drumDensity; }
  getPitchSemitones() {
    // map 0..1 → -6..+6
    return Math.round((this.params.pitch - 0.5) * 12);
  }
  getBassIntensity()  { return 0.4 + this.params.bass * 0.8; }
  isFill()     { return this.params.fill; }
}
