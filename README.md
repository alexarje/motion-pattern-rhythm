# Motion Pattern Rhythm

A web audio-based musical instrument that translates on-screen visual patterns into a multi-layered, complex rhythmic structure controlled by full-body motion capture via webcam.

## Features

- **8-layer Euclidean rhythm engine** — kick, snare, hi-hat (closed & open), bass, lead, counter-melody, and pad layers, each with independently generated Euclidean patterns.
- **Real-time Web Audio synthesis** — all sounds produced natively in the browser (no audio files required): percussive drums, sub-bass, filtered synths, and harmonic pads in a C-minor pentatonic scale.
- **Full-body motion capture** — uses [MediaPipe Pose](https://developers.google.com/mediapipe/solutions/vision/pose_landmarker) via webcam to track 33 body landmarks.
- **Gesture-to-parameter mapping**:
  | Gesture | Parameter |
  |---------|-----------|
  | Right wrist height | Tempo (60–200 BPM) |
  | Left wrist height | Master volume |
  | Right arm spread | Drum density |
  | Left arm spread | Reverb amount |
  | Head/nose height | Pitch transpose (±6 semitones) |
  | Hip height (squat) | Bass intensity |
  | Torso lean | Drum/melody layer balance |
  | Both wrists above shoulders | Fill/break trigger |
- **Visual pattern display** — animated multi-layer step-sequencer grid with a real-time spectrum analyser.
- **Per-layer mute buttons** — click to toggle individual rhythm layers during performance.

## Getting Started

Open `index.html` in a modern browser (Chrome/Edge recommended for best WebRTC and AudioContext support).

1. Click **▶ START** to initialise the audio engine and begin playback.
2. Optionally click **📷 CAMERA** to enable webcam motion control.
3. Move your body to shape the rhythm in real-time.

> **Note:** The browser must grant webcam permissions. No audio files or server required — the entire app runs client-side.

## File Structure

```
index.html              Main app
css/
  style.css             Dark neon theme
js/
  audio-engine.js       Web Audio API synthesizer
  rhythm-engine.js      Multi-layer Euclidean rhythm scheduler
  pattern-visual.js     Canvas step-sequencer + spectrum visualiser
  motion-tracker.js     MediaPipe Pose wrapper
  motion-mapper.js      Pose-landmark → musical-parameter mapper
  app.js                Main application controller
```
