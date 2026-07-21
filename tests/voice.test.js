"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const APP_PATH = path.join(__dirname, "../builtFunctions/freedomChessApp.js");

function normalize(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

function loadInternals({ voices = [{ lang: "pt-BR", localService: true }] } = {}) {
    const recognizers = [];
    const spoken = [];
    let cancelCalls = 0;

    class RecognitionMock {
        constructor() {
            this.startCalls = 0;
            this.abortCalls = 0;
            recognizers.push(this);
        }

        start() {
            this.startCalls += 1;
        }

        abort() {
            this.abortCalls += 1;
        }

        stop() {}
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
        FreedomChessCore: {
            normalizeSpeech: normalize
        },
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
    assert.equal(spoken.length, 1);
    assert.equal(cancelCalls(), 1, "only the pre-speech cleanup should cancel");

    spoken[0].onend({ type: "end" });
    await completion;

    assert.equal(cancelCalls(), 1, "onend must not be treated as a truthy timeout flag");
    assert.equal(recognizers[0].startCalls, 1, "recognition resumes immediately after a real end");
    voice.disable();
});

test("remote synthesis voices are not used", async () => {
    const { VoiceController, recognizers, spoken } = loadInternals({
        voices: [{ lang: "pt-BR", localService: false }]
    });
    const outputs = [];
    const voice = new VoiceController({ onOutput: (message) => outputs.push(message) });
    voice.activate({ localMode: true });

    await voice.speak("Texto privado do lance.", { resume: true });

    assert.deepEqual(outputs, ["Texto privado do lance."]);
    assert.equal(spoken.length, 0);
    assert.equal(recognizers[0].startCalls, 1);
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
