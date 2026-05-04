/**
 * motion-tracker.js
 * Wraps MediaPipe Pose to provide smoothed, normalised landmark data.
 * Emits a `poseUpdate` callback with processed landmark data.
 */
class MotionTracker {
  constructor(videoEl, overlayCanvas) {
    this.video   = videoEl;
    this.canvas  = overlayCanvas;
    this.ctx     = overlayCanvas.getContext('2d');
    this.isActive = false;

    this._pose    = null;
    this._camera  = null;
    this._smooth  = {};   // EMA smoothed values per landmark
    this._alpha   = 0.35; // smoothing factor

    this.onPoseUpdate = null;   // (landmarks, screenW, screenH) → void
    this.onStatusChange = null; // (bool active) → void
  }

  // ── Start webcam + pose estimation ──────────────────────────────────
  async start() {
    if (this.isActive) return;

    // Check MediaPipe availability
    if (typeof Pose === 'undefined') {
      console.error('MediaPipe Pose not loaded');
      return;
    }

    this._pose = new Pose({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
    });

    this._pose.setOptions({
      modelComplexity:       1,
      smoothLandmarks:       true,
      enableSegmentation:    false,
      smoothSegmentation:    false,
      minDetectionConfidence: 0.55,
      minTrackingConfidence:  0.55,
    });

    this._pose.onResults((results) => this._onResults(results));

    this._camera = new Camera(this.video, {
      onFrame: async () => {
        if (this._pose && this.isActive) {
          await this._pose.send({ image: this.video });
        }
      },
      width:  640,
      height: 480,
    });

    await this._camera.start();
    this.isActive = true;
    if (this.onStatusChange) this.onStatusChange(true);
  }

  async stop() {
    this.isActive = false;
    if (this._camera) { await this._camera.stop(); this._camera = null; }
    if (this._pose)   { this._pose.close();         this._pose   = null; }
    this._clearCanvas();
    if (this.onStatusChange) this.onStatusChange(false);
  }

  // ── Process MediaPipe results ────────────────────────────────────────
  _onResults(results) {
    this._clearCanvas();
    if (!results.poseLandmarks) return;

    const lm = results.poseLandmarks;

    // Draw skeleton overlay
    this._drawSkeleton(lm, results.image);

    // Smooth landmarks
    const smoothed = lm.map((pt, i) => {
      if (!this._smooth[i]) this._smooth[i] = { x: pt.x, y: pt.y, z: pt.z, v: pt.visibility || 0 };
      const s = this._smooth[i];
      const a = this._alpha;
      s.x = a * pt.x + (1 - a) * s.x;
      s.y = a * pt.y + (1 - a) * s.y;
      s.z = a * pt.z + (1 - a) * s.z;
      s.v = a * (pt.visibility || 0) + (1 - a) * s.v;
      return { x: s.x, y: s.y, z: s.z, visibility: s.v };
    });

    if (this.onPoseUpdate) {
      this.onPoseUpdate(smoothed, this.canvas.width, this.canvas.height);
    }
  }

  // ── Canvas drawing ───────────────────────────────────────────────────
  _clearCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  _drawSkeleton(lm, _image) {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const ctx = this.ctx;

    // Mirror x because video is mirrored in CSS
    const px = (pt) => ({ x: (1 - pt.x) * W, y: pt.y * H });

    // Connections (pairs of landmark indices)
    const connections = [
      // Torso
      [11,12],[11,23],[12,24],[23,24],
      // Left arm
      [11,13],[13,15],
      // Right arm
      [12,14],[14,16],
      // Left leg
      [23,25],[25,27],[27,29],[29,31],
      // Right leg
      [24,26],[26,28],[28,30],[30,32],
    ];

    ctx.lineWidth = 2;
    for (const [a, b] of connections) {
      if (!lm[a] || !lm[b]) continue;
      if ((lm[a].visibility || 0) < 0.4 || (lm[b].visibility || 0) < 0.4) continue;
      const pa = px(lm[a]);
      const pb = px(lm[b]);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.6)';
      ctx.stroke();
    }

    // Landmark dots
    const keypoints = [0,11,12,13,14,15,16,23,24,25,26,27,28];
    for (const i of keypoints) {
      if (!lm[i] || (lm[i].visibility || 0) < 0.4) continue;
      const p = px(lm[i]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fillStyle   = i < 11 ? '#ffea00' : '#00e5ff';
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur  = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Wrist highlights
    for (const wi of [15, 16]) {
      if (!lm[wi] || (lm[wi].visibility || 0) < 0.5) continue;
      const p = px(lm[wi]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.strokeStyle = wi === 15 ? '#ff3366' : '#ffca28';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }
}
