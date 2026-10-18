// English copy: same keys as messages/ru/voice.ts.
import type { ruVoice } from "../ru/voice";

export const enVoice: Record<keyof typeof ruVoice, string> = {
  "voice.mic": "Speak to type",
  "voice.stop": "Stop",
  "voice.micAria": "Microphone: speak to type",
  "voice.stopAria": "Turn the microphone off",
  "voice.listening": "Listening... tap again to stop",
  "voice.timerAria": "Recording time {time}",
  "voice.lang": "Speaking language",
  "voice.langUr": "Urdu",
  "voice.langEn": "English",
  "voice.hint": "Tap the mic and speak. The text is written in Roman Urdu and you can edit it.",
  "voice.interim": "Being heard now",
  "voice.started": "Microphone on. Keep talking; it listens until you tap again.",
  "voice.stopped": "Microphone off.",
  "voice.unsupported": "For voice use Chrome or Edge, or your keyboard's mic",
  "voice.denied": "Microphone permission was not given. Tap the mic icon in the address bar, allow it, then try again.",
  "voice.noMic": "No microphone was found. Connect one or use your keyboard's mic.",
  "voice.network": "Voice needs an internet connection. Check it and try again.",
  "voice.failed": "The microphone stopped. Tap again or type.",
};
