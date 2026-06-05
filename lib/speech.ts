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

  // Chrome's "Google …" voices stream from Google's servers and fail
  // silently on a depressingly long list of network/policy conditions
  // (CSP, cookie blockers, offline, etc). Prefer a local voice every
  // time even if it sounds less polished. Apple/Microsoft built-ins
  // (Daniel, Ryan, Aaron, Arthur, Samantha) all qualify.
  const local = voices.filter((v) => v.localService);
  const pool = local.length > 0 ? local : voices;

  const prefs = [
    /Daniel/i,
    /Microsoft (Ryan|Guy|Liam|Arthur|Aaron)/i,
    /Aaron|Arthur|Fred|Reed/i,
    /^en-GB/i,
    /^en-AU/i,
    /^en-US/i,
    /^en/i,
  ];
  for (const re of prefs) {
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
 * Queue a near-silent utterance synchronously from a user-gesture
 * handler (e.g. the submit button click) so Chrome treats the
 * subsequent end-of-stream speak() as still "user-initiated."
 */
export function primeSpeech() {
  if (!isTtsAvailable() || !isTtsEnabled()) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0; // silent — just unlocks the engine
    u.rate = 10;
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(u);
    log("primed");
  } catch (err) {
    log("prime failed", err);
  }
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
  // Chrome silently pauses the engine after ~15s of speech. resume() is
  // a no-op when running, so call it unconditionally.
  synth.resume();
  const voice = pickVoice();
  log("enqueue", { chars: text.length, voice: voice?.name ?? "(default)" });
  const chunks = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  for (const chunk of chunks) {
    const u = new SpeechSynthesisUtterance(chunk);
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 0.95;
    u.onerror = (e) => log("utterance error", e.error ?? e);
    u.onstart = () => log("utterance start");
    u.onend = () => log("utterance end");
    synth.speak(u);
  }
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

  log("speak", { chars: clean.length, voicesCached: _voices.length });
  window.speechSynthesis.cancel();

  // If voices haven't loaded yet, wait one tick on `voiceschanged`.
  if (_voices.length === 0) {
    log("waiting for voices…");
    const handler = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      _voices = window.speechSynthesis.getVoices();
      enqueue(clean);
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
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
    enableDebug: () => {
      window.localStorage.setItem("dm_tts_debug", "1");
      console.log(
        "[tts] debug mode on — reload to take effect on the module log line",
      );
    },
  };
}
