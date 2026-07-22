"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.join(__dirname, "../builtFunctions/freedomChessApp.js");

// speak() defers speechSynthesis.speak() by one task: calling it in the same
// task as cancel() makes Chromium drop the utterance.
function tick() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function normalize(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function loadInternals({
    voices = [{ lang: "pt-BR", localService: true }],
    core = { normalizeSpeech: normalize }
} = {}) {
    const recognizers = [];
    const spoken = [];
    let cancelCalls = 0;

    class RecognitionMock {
        constructor() {
            this.startCalls = 0;
            this.abortCalls = 0;
            this.listeners = Object.create(null);
            this.phrases = [];
            recognizers.push(this);
        }

        start() {
            this.startCalls += 1;
        }

        abort() {
            this.abortCalls += 1;
        }

        stop() {}

        addEventListener(name, handler) {
            (this.listeners[name] ||= []).push(handler);
        }

        emit(name) {
            for (const handler of this.listeners[name] || []) {
                handler({ type: name });
            }
        }

        // Reproduces the observed Chrome on-device failure: the full audio
        // pipeline fires and then the session goes silent forever — no result,
        // no error, not even `end`.
        hangAfterSpeech() {
            this.onstart();
            for (const name of ["audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend"]) {
                this.emit(name);
            }
        }
    }

    class UtteranceMock {
        constructor(message) {
            this.text = message;
        }
    }

    const speechSynthesis = {
        cancel() {
            cancelCalls += 1;
        },
        getVoices() {
            return voices;
        },
        speak(utterance) {
            spoken.push(utterance);
        }
    };

    const sandbox = {
        FreedomChessCore: core,
        SpeechRecognition: RecognitionMock,
        SpeechSynthesisUtterance: UtteranceMock,
        WeakSet,
        clearTimeout,
        setTimeout,
        speechSynthesis
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;

    const original = fs.readFileSync(APP_PATH, "utf8");
    const assignment = "globalThis.FreedomChessApp = new FreedomChessApp();";
    assert.ok(original.includes(assignment), "app bootstrap assignment changed");
    const instrumented = original.replace(
        assignment,
        "globalThis.__FreedomChessInternals = { VoiceController, FreedomChessApp };"
    );
    vm.runInNewContext(instrumented, sandbox, { filename: "freedomChessApp.js" });

    return {
        ...sandbox.__FreedomChessInternals,
        cancelCalls: () => cancelCalls,
        recognizers,
        spoken
    };
}

test("a recognizer that starts after disable is aborted and never reports listening", () => {
    const { VoiceController, recognizers } = loadInternals();
    const states = [];
    const voice = new VoiceController({ onState: (state) => states.push(state) });

    voice.activate({ localMode: true });
    voice.startListening();
    const recognition = recognizers[0];
    assert.equal(recognition.startCalls, 1);

    voice.disable();
    assert.equal(recognition.abortCalls, 1);
    recognition.onstart();

    assert.equal(recognition.abortCalls, 2);
    assert.equal(states.includes("listening"), false);
    assert.equal(states.at(-1), "disabled");
});

test("a normal TTS end does not look like a timeout or cancel event", async () => {
    const { VoiceController, cancelCalls, recognizers, spoken } = loadInternals();
    const voice = new VoiceController({});
    voice.activate({ localMode: true });

    const completion = voice.speak("Lance confirmado.", { resume: true });
    await tick();
    assert.equal(spoken.length, 1);
    assert.equal(cancelCalls(), 1, "only the pre-speech cleanup should cancel");

    spoken[0].onend({ type: "end" });
    await completion;

    assert.equal(cancelCalls(), 1, "onend must not be treated as a truthy timeout flag");
    assert.equal(recognizers[0].startCalls, 1, "recognition resumes immediately after a real end");
    voice.disable();
});

test("falls back to a remote Portuguese voice rather than staying mute", async () => {
    // This used to assert spoken.length === 0. Requiring localService === true
    // meant that on any machine without a local pt-BR pack — and on the very
    // first call, before Chrome finishes loading its voice list — every message
    // the extension produced was silently dropped. Silence was the bug.
    const { VoiceController, recognizers, spoken } = loadInternals({
        voices: [{ name: "Google português do Brasil", lang: "pt-BR", localService: false }]
    });
    const outputs = [];
    const voice = new VoiceController({ onOutput: (message) => outputs.push(message) });
    voice.activate({ localMode: true });

    const completion = voice.speak("Texto do lance.", { resume: true });
    await tick();

    assert.deepEqual(outputs, ["Texto do lance."]);
    assert.equal(spoken.length, 1, "a remote Portuguese voice beats silence");
    assert.equal(spoken[0].lang, "pt-BR");

    spoken[0].onend({ type: "end" });
    await completion;
    assert.equal(recognizers[0].startCalls, 1);
    voice.disable();
});

test("prefers a local Portuguese voice and never speaks Portuguese with a foreign engine", async () => {
    const localPortuguese = { name: "Luciana", lang: "pt-BR", localService: true };
    const remotePortuguese = { name: "Google português do Brasil", lang: "pt-BR", localService: false };
    const localEnglish = { name: "Samantha", lang: "en-US", localService: true };

    const preferred = loadInternals({ voices: [remotePortuguese, localEnglish, localPortuguese] });
    assert.equal(new preferred.VoiceController({}).chooseVoice(), localPortuguese);

    // With no Portuguese voice at all, leave utterance.voice unset so Chrome
    // honours utterance.lang instead of reading Portuguese with an English engine.
    const foreignOnly = loadInternals({ voices: [localEnglish] });
    const voice = new foreignOnly.VoiceController({});
    assert.equal(voice.chooseVoice(), null);

    voice.activate({ localMode: true });
    const completion = voice.speak("Cavalo para efe três.", { resume: false });
    await tick();

    assert.equal(foreignOnly.spoken.length, 1, "it still speaks");
    assert.equal(foreignOnly.spoken[0].lang, "pt-BR");
    assert.equal(foreignOnly.spoken[0].voice, undefined, "no English engine is assigned");

    foreignOnly.spoken[0].onend({ type: "end" });
    await completion;
    voice.disable();
});

test("hands the microphone back quickly when synthesis never starts", async () => {
    const { VoiceController, recognizers } = loadInternals();
    const voice = new VoiceController({});
    voice.activate({ localMode: true });

    // No onstart, no onend: Chromium dropped the utterance. The old watchdog
    // waited max(6000, length * 140) ms with the microphone closed.
    const started = Date.now();
    await voice.speak("Modo Freedom ativo com reconhecimento local. Diga seu lance.", { resume: true });
    const waited = Date.now() - started;

    assert.ok(waited < 3000, `watchdog waited ${waited}ms`);

    // A cancelled utterance resumes listening on a short delay.
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(recognizers[0].startCalls, 1, "listening resumes after the watchdog");
    voice.disable();
});

test("a hung recognition session is replaced instead of deafening the extension", async () => {
    // Observed in the wild: audiostart/soundstart/speechstart/speechend/audioend
    // all fire and then nothing. Without `end`, isRecognitionActive stayed true
    // and every later startListening() was a silent no-op — permanently deaf
    // after one sentence.
    const { VoiceController, recognizers } = loadInternals();
    let asked = 0;
    const voice = new VoiceController({ onLocalModeUnusable: () => { asked += 1; } });
    voice.activate({ localMode: true });
    voice.startListening();

    recognizers[0].hangAfterSpeech();
    assert.equal(voice.isRecognitionActive, true);

    await new Promise((resolve) => setTimeout(resolve, 3300));

    assert.equal(recognizers[0].abortCalls >= 1, true, "the wedged session is aborted");
    assert.equal(voice.isRecognitionActive, false, "the extension is not left deaf");
    assert.equal(asked, 1, "on-device recognition that hangs offers the online mode");
    voice.disable();
});

test("aborting a hung session does not escalate the same utterance twice", async () => {
    // stopRecognition() aborts, which fires `end` on the way out. That `end`
    // used to look like a second unproductive session for one spoken sentence.
    const { VoiceController, recognizers } = loadInternals();
    let asked = 0;
    const voice = new VoiceController({ onLocalModeUnusable: () => { asked += 1; } });
    voice.activate({ localMode: true });
    voice.startListening();

    recognizers[0].hangAfterSpeech();
    await new Promise((resolve) => setTimeout(resolve, 3300));
    assert.equal(asked, 1, "one utterance, one escalation");

    // The abort finally lands and the wedged recognizer reports `end`.
    voice.stopRecognition(true);
    recognizers[0].onend();

    assert.equal(asked, 1, "the stale `end` must not escalate again");
    voice.disable();
});

test("a session that ends empty-handed once is simply retried", async () => {
    const { VoiceController, recognizers } = loadInternals();
    let asked = 0;
    const voice = new VoiceController({ onLocalModeUnusable: () => { asked += 1; } });
    voice.activate({ localMode: true });
    voice.startListening();

    const recognition = recognizers[0];
    recognition.onstart();
    recognition.emit("speechstart");
    recognition.emit("speechend");
    recognition.onend();

    assert.equal(asked, 0, "one empty session is ordinary, not a failure");
    assert.equal(voice.phraseHintsDisabled, false);
    assert.equal(voice.stalledSessions, 1);
    voice.disable();
});

test("a delivered result clears the stall bookkeeping", async () => {
    const { VoiceController, recognizers } = loadInternals();
    const heard = [];
    const voice = new VoiceController({ onAlternatives: (list) => heard.push(list) });
    voice.activate({ localMode: true });
    voice.startListening();

    const recognition = recognizers[0];
    recognition.onstart();
    recognition.emit("speechstart");
    recognition.emit("speechend");
    assert.ok(voice.stallTimer, "the watchdog is armed while a transcript is owed");

    recognition.onresult({
        resultIndex: 0,
        results: [Object.assign([{ transcript: "cavalo f3", confidence: 0.9 }], { isFinal: true })]
    });

    assert.equal(voice.stallTimer, null, "a result disarms the watchdog");
    assert.equal(voice.stalledSessions, 0);
    assert.equal(heard.length, 1);

    // The hung-session path must not fire afterwards.
    recognition.onend();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(recognizers.length, 1);
    voice.disable();
});

test("affirmative confirmation requires the primary recognition alternative", () => {
    const { FreedomChessApp } = loadInternals();
    const app = Object.create(FreedomChessApp.prototype);
    const alternatives = (...transcripts) => transcripts.map((transcript) => ({ transcript }));

    assert.equal(app.detectConfirmation(alternatives("cem", "sim")), null);
    assert.equal(app.detectConfirmation(alternatives("sim", "cem")), true);
    assert.equal(app.detectConfirmation(alternatives("sim", "não")), null);
    assert.equal(app.detectConfirmation(alternatives("talvez", "não")), false);
});

test("a transcript that matches nothing reports what was heard and offers the closest move", async () => {
    // The old no-match path spoke a single generic sentence and wrote it to a
    // clipped 1px region. With no usable TTS voice that was literally no output
    // at all — the reported "I speak and nothing happens".
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const app = Object.create(FreedomChessApp.prototype);

    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };
    const statuses = [];
    const spoken = [];
    const confirmations = [];

    app.enabled = true;
    app.busy = false;
    app.activationGeneration = 3;
    app.pendingConfirmation = null;
    app.queuedState = null;
    app.bridge = {
        getState: async () => ({ available: true, boardConnected: true, fen: "fen", legalMoves: [knight] })
    };
    app.assertUsableState = () => undefined;
    app.ui = { announceStatus: (message) => statuses.push(message) };
    app.voice = { speak: async (message) => spoken.push(message) };
    app.confirmAndMakeMove = async (move, generation, options) => confirmations.push({ move, options });
    app.flushQueuedState = async () => undefined;

    await app.handleAlternatives([{ transcript: "Cavalo efe treis", confidence: 0.7 }]);

    assert.equal(statuses.length, 1, "the failure is always reported visibly");
    assert.match(statuses[0], /Cavalo efe treis/);
    assert.match(statuses[0], /nenhum lance legal/i);

    assert.equal(confirmations.length, 1, "the closest legal move is offered");
    assert.equal(confirmations[0].move, knight);
    assert.equal(confirmations[0].options.approximate, "Cavalo efe treis");
    assert.deepEqual(spoken, [], "a suggestion replaces the generic failure sentence");
    assert.equal(app.busy, false);
});

test("unrelated speech fails loudly instead of guessing a move", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const app = Object.create(FreedomChessApp.prototype);

    const statuses = [];
    const spoken = [];
    const confirmations = [];

    app.enabled = true;
    app.busy = false;
    app.activationGeneration = 1;
    app.pendingConfirmation = null;
    app.queuedState = null;
    app.bridge = {
        getState: async () => ({
            available: true,
            boardConnected: true,
            fen: "fen",
            legalMoves: [{ from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" }]
        })
    };
    app.assertUsableState = () => undefined;
    app.ui = { announceStatus: (message) => statuses.push(message) };
    app.voice = { speak: async (message) => spoken.push(message) };
    app.confirmAndMakeMove = async (move, generation, options) => confirmations.push({ move, options });
    app.flushQueuedState = async () => undefined;

    await app.handleAlternatives([{ transcript: "qual é o placar do jogo", confidence: 0.9 }]);

    assert.equal(confirmations.length, 0, "nothing close enough to suggest");
    assert.equal(statuses.length, 1);
    assert.equal(spoken.length, 1);
    assert.match(spoken[0], /qual é o placar do jogo/);
});

test("an async command from an old activation cannot speak into a new session", async () => {
    const { FreedomChessApp } = loadInternals();
    const app = Object.create(FreedomChessApp.prototype);
    const spoken = [];
    let resolveState;

    app.activationGeneration = 7;
    app.enabled = true;
    app.bridge = {
        getState: () => new Promise((resolve) => {
            resolveState = resolve;
        })
    };
    app.voice = {
        speak: async (message) => spoken.push(message)
    };
    app.assertUsableState = () => undefined;

    const oldCommand = app.executeCommand("legal-moves", 7);
    app.activationGeneration = 9;
    app.enabled = true;
    resolveState({ available: true, legalMoves: [{ from: "e2", to: "e4", piece: "p" }] });
    await oldCommand;

    assert.deepEqual(spoken, []);
});
