"use client";

import { useSyncExternalStore } from "react";

// A soft two-note chime (Web Audio, no files). Muting is a per-browser convenience.
const KEY = "agentguard.muted";
const EVENT = "agentguard:muted";

export function isMuted(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    /* storage unavailable: keep the default */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Mute state that is correct on first client render and never mismatches the server HTML. */
export function useMuted(): boolean {
  return useSyncExternalStore(subscribe, isMuted, () => false);
}

let ctx: AudioContext | null = null;

export function chime(kind: "alert" | "resolved") {
  if (isMuted() || typeof window === "undefined") return;
  try {
    ctx ??= new AudioContext();
    const notes = kind === "alert" ? [880, 660] : [660, 990];
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      const start = ctx!.currentTime + i * 0.16;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.45);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(start);
      osc.stop(start + 0.5);
    });
  } catch {
    /* audio not available */
  }
}
