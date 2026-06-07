"use client";

/**
 * Thin wrapper around the browser's free SpeechSynthesis API.
 *
 * Chrome quirks worth knowing:
 *   - Voices populate asynchronously; first getVoices() often returns [].
 *     We re-read on the `voiceschanged` event.
 *   - The engine silently pauses after ~15s of utterance; call .resume()
 *     defensively before each speak.
 *   - speechSynthesis.speak() needs to ride a user gesture for the very
 *     first utterance after page load on autoplay-restricted setups.
 *     primeSpeech() queues a silent utterance synchronously inside the
 *     submit handler to satisfy that requirement.
 */

const STORAGE_KEY = "dm_tts_enabled";
const DEBUG =
  typeof window !== "undefined" &&
  window.localStorage?.getItem("dm_tts_debug") === "1";

function log(...args: unknown[]) {
  if (DEBUG) console.log("[tts]", ...args);
}

let _voices: SpeechSynthesisVoice[] = [];

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  const refresh = () => {
    _voices = window.speechSynthesis.getVoices();
    log("voices refreshed:", _voices.length);
  };
  refresh();
  window.speechSynthesis.addEventListener("voiceschanged", refresh);
}

export function isTtsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isTtsEnabled(): boolean {
  if (!isTtsAvailable()) return false;
  return window.localStorage.getItem(STORAGE_KEY) === "1";
}

export function setTtsEnabled(on: boolean) {
  if (!isTtsAvailable()) return;
  window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

function pickVoice(): SpeechSynthesisVoice | null {
  let voices = _voices;
  if (voices.length === 0 && isTtsAvailable()) {
    voices = window.speechSynthesis.getVoices();
    _voices = voices;
  }
  if (voices.length === 0) return null;

  // Filter to local voices — Google's cloud-streamed voices fail
  // silently on too many network/policy conditions.
  const local = voices.filter((v) => v.localService);
  const pool = local.length > 0 ? local : voices;

  // Tiered preference list. The "Enhanced" / "Premium" / "(Neural)"
  // tags are higher-quality voice models — Apple ships them as
  // optional downloads under System Settings → Accessibility →
  // Spoken Content → Manage Voices. If the user has any of those
  // installed, they sound dramatically more human than the
  // compact-tier defaults.
  const tiers: RegExp[] = [
    // Best quality: explicitly enhanced / premium / neural variants.
    /\b(Premium|Enhanced|Neural)\b/i,
    // Narrator-suited voices, lower-pitched / measured.
    /Daniel|Arthur|Reed|Oliver|Tom|Albert|Bahh|Bruce|Fred/i,
    // Microsoft Edge premium neural voices (if present).
    /Microsoft (Ryan|Guy|Liam|Arthur|Aaron|Davis|Tony)/i,
    // English locale fallbacks.
    /^en-GB/i,
    /^en-AU/i,
    /^en-US/i,
    /^en/i,
  ];
  for (const re of tiers) {
    const m = pool.find((v) => re.test(v.name) || re.test(v.lang));
    if (m) return m;
  }
  return pool[0];
}

export function cancelSpeech() {
  if (!isTtsAvailable()) return;
  window.speechSynthesis.cancel();
}

/**
 * No-op kept for source compatibility. Previously queued a silent
 * utterance to satisfy Chrome's autoplay policy, but on macOS Chrome
 * a volume-0 utterance gets stuck in a phantom "speaking" state forever
 * — which then poisons the real speak() call a few seconds later. The
 * speaker-toggle click is itself a user gesture and is enough to unlock
 * the engine for the session.
 */
export function primeSpeech() {
  // intentionally empty
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function enqueue(text: string) {
  const synth = window.speechSynthesis;
  synth.resume();
  const voice = pickVoice();
  log("enqueue", {
    chars: text.length,
    voice: voice?.name ?? "(default)",
    lang: voice?.lang ?? "(none)",
    speakingBefore: synth.speaking,
    pendingBefore: synth.pending,
    paused: synth.paused,
  });

  // Speak the whole narration as a single utterance. The previous
  // sentence-by-sentence splitting was the main source of the "jumpy"
  // sound — the synth pauses noticeably between utterances. One
  // utterance = continuous prosody, natural sentence rhythm.
  const u = new SpeechSynthesisUtterance(text);
  if (voice) {
    u.voice = voice;
    u.lang = voice.lang || "en-US";
  } else {
    u.lang = "en-US";
  }
  // Slower + slightly lower than default for a narrator cadence.
  u.rate = 0.88;
  u.pitch = 0.9;
  u.onerror = (e) => log("utterance error", e.error ?? e);
  u.onstart = () => log("utterance start");
  u.onend = () => log("utterance end");
  synth.speak(u);

  log("after enqueue", {
    speaking: synth.speaking,
    pending: synth.pending,
    paused: synth.paused,
  });
}

export function speak(text: string) {
  if (!isTtsAvailable()) {
    log("speak skipped: no synth");
    return;
  }
  if (!isTtsEnabled()) {
    log("speak skipped: tts disabled");
    return;
  }
  const clean = stripMarkdown(text);
  if (!clean) {
    log("speak skipped: empty after strip");
    return;
  }

  const synth = window.speechSynthesis;
  log("speak", {
    chars: clean.length,
    voicesCached: _voices.length,
    speaking: synth.speaking,
    pending: synth.pending,
    paused: synth.paused,
  });

  // Chrome's speechSynthesis has a known bug where synth.speaking sticks
  // at true even after the actual utterance has finished or never
  // played, especially after volume-0 priming or cancel-then-speak. If
  // we see that stuck state, hard-reset the engine before queueing.
  if (synth.speaking || synth.pending || synth.paused) {
    synth.cancel();
    log("reset stuck engine — deferring speak 100ms");
    setTimeout(() => enqueue(clean), 100);
    return;
  }

  if (_voices.length === 0) {
    log("waiting for voices…");
    const handler = () => {
      synth.removeEventListener("voiceschanged", handler);
      _voices = synth.getVoices();
      enqueue(clean);
    };
    synth.addEventListener("voiceschanged", handler);
    setTimeout(() => {
      synth.removeEventListener("voiceschanged", handler);
      enqueue(clean);
    }, 250);
    return;
  }

  enqueue(clean);
}

/** Expose internal state for debugging from the browser console. */
if (typeof window !== "undefined") {
  (
    window as Window & { __dmTts?: unknown }
  ).__dmTts = {
    voices: () => _voices,
    enabled: isTtsEnabled,
    speak,
    primeSpeech,
    state: () => ({
      speaking: window.speechSynthesis.speaking,
      pending: window.speechSynthesis.pending,
      paused: window.speechSynthesis.paused,
    }),
    /** Bypass everything. Direct browser-native test — if this is
     *  silent too, the problem is OS/Chrome, not our code. */
    rawTest: () => {
      const u = new SpeechSynthesisUtterance(
        "If you can hear this, your browser TTS works.",
      );
      u.lang = "en-US";
      u.onstart = () => console.log("[tts:rawTest] started");
      u.onend = () => console.log("[tts:rawTest] ended");
      u.onerror = (e) => console.log("[tts:rawTest] error", e.error ?? e);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      console.log(
        "[tts:rawTest] queued; state =",
        window.speechSynthesis.speaking,
        window.speechSynthesis.pending,
      );
    },
    enableDebug: () => {
      window.localStorage.setItem("dm_tts_debug", "1");
      console.log(
        "[tts] debug mode on — reload to take effect on the module log line",
      );
    },
  };
}
