"use client";

import type { SceneMood } from "@/lib/tools";

/**
 * Procedural ambient audio per scene mood. Generates everything from a
 * noise buffer + filters + slow LFOs — no audio files, works offline,
 * crossfades smoothly when the mood changes.
 */

const STORAGE_KEY = "dm_ambient_enabled";
const MASTER_GAIN = 0.25;

type MoodConfig = {
  /** Lowpass cutoff in Hz — defines the "weight" of the bed. */
  cutoff: number;
  /** Resonance / Q on the lowpass — higher = more harmonic ringing. */
  q: number;
  /** LFO frequency in Hz for breathing motion. */
  lfoRate: number;
  /** LFO depth (Hz) — how much the cutoff sways. */
  lfoDepth: number;
  /** Master output level in this mood (0..1, scaled by MASTER_GAIN). */
  level: number;
  /** Hint a tonal drone behind the noise (Hz), or null for pure noise. */
  drone: number | null;
};

const MOODS: Record<SceneMood, MoodConfig> = {
  calm: { cutoff: 600, q: 0.4, lfoRate: 0.06, lfoDepth: 200, level: 0.8, drone: null },
  tense: { cutoff: 350, q: 1.2, lfoRate: 0.12, lfoDepth: 120, level: 0.9, drone: 55 },
  combat: { cutoff: 250, q: 1.6, lfoRate: 0.6, lfoDepth: 180, level: 1.0, drone: 41 },
  mysterious: { cutoff: 450, q: 2.0, lfoRate: 0.04, lfoDepth: 300, level: 0.85, drone: 87.31 },
  festive: { cutoff: 900, q: 0.6, lfoRate: 0.18, lfoDepth: 250, level: 0.7, drone: 110 },
};

type LiveBed = {
  mood: SceneMood;
  gain: GainNode;
  cleanup: () => void;
};

class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private current: LiveBed | null = null;
  private muted = false;

  private ensureContext() {
    if (this.ctx) return this.ctx;
    type W = Window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AC =
      window.AudioContext ?? (window as W).webkitAudioContext ?? null;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
    this.master.connect(this.ctx.destination);
    this.noiseBuffer = this.buildNoiseBuffer(this.ctx);
    return this.ctx;
  }

  /** Generate ~6 seconds of brown-ish noise once and loop it. */
  private buildNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = ctx.sampleRate * 6;
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      // Simple brown-noise integrator + leakage.
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    return buf;
  }

  private buildBed(mood: SceneMood): LiveBed {
    const ctx = this.ctx!;
    const cfg = MOODS[mood];

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master!);

    // Noise source through a resonant lowpass with LFO-modulated cutoff.
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer!;
    noise.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = cfg.cutoff;
    filter.Q.value = cfg.q;

    const lfo = ctx.createOscillator();
    lfo.frequency.value = cfg.lfoRate;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = cfg.lfoDepth;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    noise.connect(filter).connect(gain);
    noise.start();

    const drones: OscillatorNode[] = [];
    if (cfg.drone) {
      // Slow drone with two harmonics for body.
      for (const ratio of [1, 1.5]) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = cfg.drone * ratio;
        const g = ctx.createGain();
        g.gain.value = ratio === 1 ? 0.06 : 0.025;
        osc.connect(g).connect(gain);
        osc.start();
        drones.push(osc);
      }
    }

    const target = cfg.level;
    return {
      mood,
      gain,
      cleanup: () => {
        try {
          noise.stop();
        } catch {}
        try {
          lfo.stop();
        } catch {}
        for (const d of drones) {
          try {
            d.stop();
          } catch {}
        }
        try {
          gain.disconnect();
        } catch {}
      },
    } as LiveBed;
  }

  isEnabled() {
    if (typeof window === "undefined") return false;
    // Default OFF — auto-playing audio would surprise visitors.
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  }

  setEnabled(on: boolean) {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    this.muted = !on;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.linearRampToValueAtTime(on ? MASTER_GAIN : 0, now + 0.4);
    }
  }

  /** Crossfade to a new mood. Safe to call repeatedly. */
  setMood(mood: SceneMood) {
    if (!this.isEnabled()) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      // Autoplay policy — we can only resume after a user gesture. The
      // toggle button click satisfies that; later setMood calls just work.
      void ctx.resume();
    }
    if (this.current?.mood === mood) return;

    const cfg = MOODS[mood];
    const next = this.buildBed(mood);
    const now = ctx.currentTime;
    next.gain.gain.setValueAtTime(0, now);
    next.gain.gain.linearRampToValueAtTime(cfg.level, now + 2.5);

    if (this.current) {
      const old = this.current;
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.linearRampToValueAtTime(0, now + 2.5);
      setTimeout(() => old.cleanup(), 2700);
    }
    this.current = next;
  }

  stop() {
    if (!this.ctx || !this.current) return;
    const old = this.current;
    const now = this.ctx.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.linearRampToValueAtTime(0, now + 0.5);
    setTimeout(() => old.cleanup(), 700);
    this.current = null;
  }
}

let _engine: AmbientEngine | null = null;
function engine() {
  if (!_engine) _engine = new AmbientEngine();
  return _engine;
}

export const ambient = {
  isEnabled: () => engine().isEnabled(),
  setEnabled: (on: boolean) => engine().setEnabled(on),
  setMood: (mood: SceneMood) => engine().setMood(mood),
  stop: () => engine().stop(),
};
