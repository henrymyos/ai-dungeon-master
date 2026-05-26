"use client";

/**
 * Thin wrapper around the browser's free SpeechSynthesis API.
 *
 * Loads a voice preference from localStorage; on every `speak()` call,
 * picks the best available voice (prefers en-GB / en-AU / male voices
 * because they feel more "dungeon master" than the default en-US Siri).
 */

const STORAGE_KEY = "dm_tts_enabled";

export function isTtsAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isTtsEnabled(): boolean {
  if (!isTtsAvailable()) return false;
  const v = window.localStorage.getItem(STORAGE_KEY);
  // Default OFF — auto-play would surprise visitors. They opt in.
  return v === "1";
}

export function setTtsEnabled(on: boolean) {
  if (!isTtsAvailable()) return;
  window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const prefs = [
    /Google UK English Male/i,
    /Daniel/i, // macOS UK male
    /Microsoft Ryan|Liam|Arthur/i,
    /en-GB/i,
    /en-AU/i,
    /en-US/i,
  ];
  for (const re of prefs) {
    const m = voices.find((v) => re.test(v.name) || re.test(v.lang));
    if (m) return m;
  }
  return voices[0];
}

export function cancelSpeech() {
  if (!isTtsAvailable()) return;
  window.speechSynthesis.cancel();
}

export function speak(text: string) {
  if (!isTtsAvailable() || !isTtsEnabled()) return;
  // Cancel anything currently speaking — we never want overlap.
  window.speechSynthesis.cancel();

  // Strip markdown formatting that doesn't translate to speech.
  const clean = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/^#+\s*/gm, "")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return;

  // Some browsers limit per-utterance length; chunk on sentence boundaries.
  const chunks = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];

  const voice = pickVoice();
  for (const chunk of chunks) {
    const u = new SpeechSynthesisUtterance(chunk);
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 0.95;
    window.speechSynthesis.speak(u);
  }
}
