import test from "node:test";
import assert from "node:assert/strict";
import { formatElapsed, SpeechSession } from "./speech-session";
import type { RecognitionEventLike, RecognitionLike } from "./speech-session";

class FakeRecognition implements RecognitionLike {
  static instances: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((e: RecognitionEventLike) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.starts += 1;
  }
  stop() {
    this.stops += 1;
  }
  emit(results: Array<[string, boolean]>, resultIndex = 0) {
    const list = results.map(([t, f]) => ({ isFinal: f, 0: { transcript: t } }));
    this.onresult?.({ resultIndex, results: Object.assign(list, { length: list.length }) });
  }
}

function setup() {
  FakeRecognition.instances = [];
  const clock = { t: 0 };
  const log = { finals: [] as string[], interim: [] as string[], listening: [] as boolean[], errors: [] as string[] };
  const s = new SpeechSession(
    FakeRecognition,
    "ur-PK",
    {
      onFinal: (t) => log.finals.push(t),
      onInterim: (t) => log.interim.push(t),
      onListening: (on) => log.listening.push(on),
      onError: (k) => log.errors.push(k),
    },
    { now: () => clock.t },
  );
  return { s, log, clock };
}

test("configures continuous Urdu recognition with interim results", () => {
  const { s, log } = setup();
  assert.equal(s.start(), true);
  const r = FakeRecognition.instances[0];
  assert.equal(r.lang, "ur-PK");
  assert.equal(r.continuous, true);
  assert.equal(r.interimResults, true);
  assert.equal(r.starts, 1);
  assert.deepEqual(log.listening, [true]);
});

test("interim text is live, finals are delivered once", () => {
  const { s, log } = setup();
  s.start();
  const r = FakeRecognition.instances[0];
  r.emit([["baqi", false]]);
  assert.equal(log.interim.at(-1), "baqi");
  r.emit([["baqi paisa", true], ["kal", false]]);
  r.emit([["baqi paisa", true], ["kal dega", true]], 1);
  assert.deepEqual(log.finals, ["baqi paisa", "kal dega"]);
  assert.equal(log.interim.at(-1), "");
});

test("restarts on end while the toggle is on, until stopped", () => {
  const { s, log, clock } = setup();
  s.start();
  const r = FakeRecognition.instances[0];
  for (let i = 0; i < 4; i += 1) {
    clock.t += 5000; // a long pause: Chrome ends the session by itself
    r.onend?.();
  }
  assert.equal(r.starts, 5, "started again after every end");
  assert.equal(s.listening, true);
  s.stop();
  assert.equal(r.stops, 1);
  r.onend?.();
  assert.equal(r.starts, 5, "no restart after the owner stopped");
  assert.deepEqual(log.listening, [true, false]);
});

test("words heard but not finalised before an end are kept", () => {
  const { s, log, clock } = setup();
  s.start();
  const r = FakeRecognition.instances[0];
  r.emit([["paanch sau", false]]);
  clock.t += 3000;
  r.onend?.();
  assert.deepEqual(log.finals, ["paanch sau"]);
});

test("no-speech is ignored; permission denied stops with a clear error", () => {
  const { s, log, clock } = setup();
  s.start();
  const r = FakeRecognition.instances[0];
  r.onerror?.({ error: "no-speech" });
  clock.t += 2000;
  r.onend?.();
  assert.equal(r.starts, 2);
  r.onerror?.({ error: "not-allowed" });
  r.onend?.();
  assert.equal(r.starts, 2);
  assert.deepEqual(log.errors, ["denied"]);
  assert.equal(s.listening, false);
});

test("a recogniser that keeps ending at once is given up on", () => {
  const { s, log } = setup();
  s.start();
  const r = FakeRecognition.instances[0];
  for (let i = 0; i < 10; i += 1) r.onend?.(); // the clock never moves
  assert.deepEqual(log.errors, ["failed"]);
  assert.equal(s.listening, false);
});

test("start() that throws reports failure", () => {
  const { s, log } = setup();
  const orig = FakeRecognition.prototype.start;
  FakeRecognition.prototype.start = function () {
    throw new Error("InvalidStateError");
  };
  try {
    assert.equal(s.start(), false);
  } finally {
    FakeRecognition.prototype.start = orig;
  }
  assert.deepEqual(log.errors, ["failed"]);
});

test("formatElapsed", () => {
  assert.equal(formatElapsed(0), "0:00");
  assert.equal(formatElapsed(65), "1:05");
  assert.equal(formatElapsed(600), "10:00");
});
