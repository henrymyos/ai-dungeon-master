"use client";

/**
 * Thin wrapper around the browser's free SpeechSynthesis API.
 *
 * Voices populate asynchronously in some browsers (Chrome especially) —
 * the first getVoices() call right after page load often returns []. We
 * cache the voice list and refresh it on the `voiceschanged` event.
 */

const STORAGE_KEY = "dm_tts_enabled";

let _voices: SpeechSynthesisVoice[] = [];

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Prime the voice list. Both reads — the initial one and the event —
  // are necessary because browsers behave differently.
  const refresh = () => {
    _voices = window.speechSynthesis.getVoices();
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
  // Use the cached list if populated; fall back to a fresh read.
  let voices = _voices;
  if (voices.length === 0 && isTtsAvailable()) {
    voices = window.speechSynthesis.getVoices();
    _voices = voices;
  }
  if (voices.length === 0) return null;
  const prefs = [
    /Google UK English Male/i,
    /Daniel/i,
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
  const voice = pickVoice();
  const chunks = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  for (const chunk of chunks) {
    const u = new SpeechSynthesisUtterance(chunk);
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 0.95;
    window.speechSynthesis.speak(u);
  }
}

export function speak(text: string) {
  if (!isTtsAvailable() || !isTtsEnabled()) return;
  const clean = stripMarkdown(text);
  if (!clean) return;

  window.speechSynthesis.cancel();

  // If voices haven't loaded yet, wait one tick on `voiceschanged`.
  if (_voices.length === 0) {
    const handler = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      _voices = window.speechSynthesis.getVoices();
      enqueue(clean);
    };
    window.speechSynthesis.addEventListener("voiceschanged", handler);
    // Belt-and-braces: also enqueue after a small delay in case the event
    // never fires (some browsers populate voices synchronously after a
    // microtask).
    setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", handler);
      enqueue(clean);
    }, 250);
    return;
  }

  enqueue(clean);
}
