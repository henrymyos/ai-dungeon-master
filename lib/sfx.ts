"use client";

/**
 * Procedural one-shot sound effects fired in response to tool events.
 * All synthesized live via Web Audio — no asset files. Shares no state
 * with the ambient bed; each call spins up a few short-lived nodes.
 *
 * Usage: sfx.play("dice"), sfx.play("hit"), etc.
 */

const STORAGE_KEY = "dm_sfx_enabled";

export type SfxKind =
  | "dice"
  | "hit"
  | "heal"
  | "pickup"
  | "drop"
  | "combat_start"
  | "enemy_down"
  | "quest"
  | "level_change";

class SfxEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;

  constructor() {
    if (typeof window !== "undefined") {
      this.muted = window.localStorage.getItem(STORAGE_KEY) === "0";
    }
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    type W = Window & { webkitAudioContext?: typeof AudioContext };
    const AC = window.AudioContext ?? (window as W).webkitAudioContext ?? null;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.35;
    this.master.connect(this.ctx.destination);
    return this.ctx;
  }

  isEnabled() {
    return !this.muted;
  }

  setEnabled(on: boolean) {
    this.muted = !on;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
    }
    if (this.master) this.master.gain.value = on ? 0.35 : 0;
  }

  play(kind: SfxKind) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    switch (kind) {
      case "dice":
        this.dice(ctx, this.master);
        break;
      case "hit":
        this.hit(ctx, this.master);
        break;
      case "heal":
        this.sweep(ctx, this.master, 440, 880, 0.4, "sine");
        break;
      case "pickup":
        this.sweep(ctx, this.master, 660, 990, 0.25, "triangle");
        break;
      case "drop":
        this.sweep(ctx, this.master, 440, 220, 0.2, "triangle");
        break;
      case "combat_start":
        this.stinger(ctx, this.master);
        break;
      case "enemy_down":
        this.sweep(ctx, this.master, 220, 55, 0.6, "sawtooth");
        break;
      case "quest":
        this.chime(ctx, this.master, [523.25, 659.25, 783.99]);
        break;
      case "level_change":
        this.chime(ctx, this.master, [392.0, 523.25, 659.25, 783.99]);
        break;
    }
  }

  // ─── individual sounds ───────────────────────────────────────────────

  /** Clattery noise burst with high-cutoff sweep — dice on a table. */
  private dice(ctx: AudioContext, out: GainNode) {
    const dur = 0.35;
    const noise = this.noiseSource(ctx, dur);
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(2500, ctx.currentTime);
    filter.Q.value = 0.7;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(filter).connect(gain).connect(out);
    noise.start();
    noise.stop(ctx.currentTime + dur);
  }

  /** Short low thud + noise transient — damage taken. */
  private hit(ctx: AudioContext, out: GainNode) {
    const t = ctx.currentTime;
    const dur = 0.25;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + dur);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0.6, t);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(oscGain).connect(out);
    osc.start(t);
    osc.stop(t + dur);

    const noise = this.noiseSource(ctx, 0.08);
    const nFilter = ctx.createBiquadFilter();
    nFilter.type = "lowpass";
    nFilter.frequency.value = 500;
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.35, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
    noise.connect(nFilter).connect(nGain).connect(out);
    noise.start(t);
    noise.stop(t + 0.08);
  }

  /** Pitched sweep — pickup / heal / drop. */
  private sweep(
    ctx: AudioContext,
    out: GainNode,
    fromHz: number,
    toHz: number,
    durSec: number,
    wave: OscillatorType,
  ) {
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = wave;
    osc.frequency.setValueAtTime(fromHz, t);
    osc.frequency.exponentialRampToValueAtTime(toHz, t + durSec);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + durSec);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + durSec);
  }

  /** Two-note ominous stab — combat starts. */
  private stinger(ctx: AudioContext, out: GainNode) {
    const t = ctx.currentTime;
    const freqs = [82.4, 116.5]; // E2 + Bb2 — tritone
    for (const f of freqs) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = f;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 800;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.4, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.connect(filter).connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.7);
    }
  }

  /** Short arpeggiated triad — quest / level change. */
  private chime(ctx: AudioContext, out: GainNode, hertz: number[]) {
    const t0 = ctx.currentTime;
    const step = 0.08;
    hertz.forEach((f, i) => {
      const t = t0 + i * step;
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      osc.frequency.value = f;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.linearRampToValueAtTime(0.3, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.4);
    });
  }

  /** White-noise sample source with the given duration. */
  private noiseSource(ctx: AudioContext, durSec: number) {
    const samples = Math.floor(ctx.sampleRate * durSec);
    const buf = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }
}

export const sfx = new SfxEngine();
