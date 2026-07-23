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
    // after one sentence. The recovery is a fresh recognizer, never a switch to
    // online recognition and never a spoken word.
    const { VoiceController, recognizers } = loadInternals();
    const spoken = [];
    const voice = new VoiceController({ onOutput: (message) => spoken.push(message) });
    voice.activate({ localMode: true });
    voice.startListening();

    recognizers[0].hangAfterSpeech();
    assert.equal(voice.isRecognitionActive, true);

    await new Promise((resolve) => setTimeout(resolve, 3300));

    assert.equal(recognizers[0].abortCalls >= 1, true, "the wedged session is aborted");
    assert.equal(recognizers.length >= 2, true, "a fresh recognizer replaces it");
    assert.equal(recognizers.at(-1).startCalls >= 1, true, "the replacement starts listening");
    assert.deepEqual(spoken, [], "the recovery is silent — nothing is announced");
    voice.disable();
});

test("a run of hangs eventually fails cleanly instead of churning forever", async () => {
    // A single hang is replaced quietly, but a recognizer that hangs over and
    // over is genuinely broken and must stop, with one actionable message and
    // no mention of any online mode.
    const { VoiceController, recognizers } = loadInternals();
    let fatal = null;
    const voice = new VoiceController({ onFatalError: (error) => { fatal = error; } });
    voice.activate({ localMode: true });
    voice.startListening();

    for (let attempt = 0; attempt < 4 && !fatal; attempt += 1) {
        recognizers.at(-1).hangAfterSpeech();
        await new Promise((resolve) => setTimeout(resolve, 3300));
    }

    assert.ok(fatal, "a persistently broken recognizer is not retried forever");
    assert.doesNotMatch(fatal.message, /online/i, "the failure never suggests an online mode");
    assert.equal(voice.enabled, false);
});

test("a session that ends empty-handed once is simply retried, silently", async () => {
    const { VoiceController, recognizers } = loadInternals();
    const spoken = [];
    const voice = new VoiceController({ onOutput: (message) => spoken.push(message) });
    voice.activate({ localMode: true });
    voice.startListening();

    const recognition = recognizers[0];
    recognition.onstart();
    recognition.emit("speechstart");
    recognition.emit("speechend");
    recognition.onend();

    assert.equal(voice.phraseHintsDisabled, false);
    assert.equal(voice.hungSessions, 0, "an empty session is a silent player, not a hang");
    assert.deepEqual(spoken, [], "the player thinking must never make the extension talk");
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

test("a yes is read the way people actually say it", () => {
    const { FreedomChessApp } = loadInternals();
    const app = Object.create(FreedomChessApp.prototype);
    const value = (transcript) => app.confirmationValue({ transcript });

    for (const yes of [
        "sim", "Sim.", "SIM", "confirma", "Confirma!", "confirmar", "confirmo",
        "pode", "pode fazer", "pode ser", "ok", "OK.", "isso", "isso aí",
        "é isso aí", "isso mesmo", "positivo", "certo", "com certeza", "beleza",
        "manda", "manda ver", "vai", "vai lá", "faz", "faz isso", "joga",
        "claro", "exato", "afirmativo", "perfeito", "aham", "tá", "sim pode",
        "cem", "sem", "assim",
        // The mishearings that made the player repeat "confirma".
        "comfirma", "confirmaa", "confirmar isso", "confirmá", "confirmado",
    ]) {
        assert.equal(value(yes), true, `"${yes}" deveria confirmar`);
    }

    for (const no of [
        "muda", "mudar", "Muda!", "troca", "trocar", "outro",
        "não", "nao", "Não.", "nada", "cancela", "cancelar", "negativo", "para",
        "espera", "errado", "não pode", "cancela isso", "melhor não", "não sei",
        "não é isso", "isso não",
        // The mishearings that made the player repeat "muda".
        "mula", "muta", "mudaa", "mude", "trocar isso",
    ]) {
        assert.equal(value(no), false, `"${no}" deveria cancelar`);
    }

    for (const neither of [
        "talvez", "cavalo f3", "cavalo efe três", "torre a1 para a8",
        "e2 para e4", "peão e4", "roque pequeno", "qual é o placar", ""
    ]) {
        assert.equal(value(neither), null, `"${neither}" não é uma resposta`);
    }
});

test("a move spoken at the confirmation prompt is never read as a yes", () => {
    // This is where the removed "primary alternative" test's intent now lives.
    // "vai", "faz", "joga" and "manda" are affirmatives AND the imperatives that
    // prefix a move command; only the whole-utterance rule separates them.
    const { FreedomChessApp } = loadInternals();
    const app = Object.create(FreedomChessApp.prototype);
    const alternatives = (...transcripts) => transcripts.map((transcript) => ({ transcript }));

    for (const move of [
        "faz torre a1 a8", "joga cavalo f3", "vai torre a1 a8",
        "manda a dama para h5", "sim cavalo f3", "pode jogar a torre pra a8"
    ]) {
        assert.equal(app.confirmationValue({ transcript: move }), null, move);
    }
    assert.equal(app.detectConfirmation(alternatives("cavalo f3", "cavalo f3 vai")), null);
});

test("a yes does not have to be the primary recognition alternative", () => {
    // This assertion used to be the opposite: detectConfirmation(["cem","sim"])
    // had to be null. That rule is exactly the reported bug — pt-BR recognition
    // returns "cem" as the top alternative for a snapped "sim" routinely, and
    // the player ended up saying "sim" four times.
    const { FreedomChessApp } = loadInternals();
    const app = Object.create(FreedomChessApp.prototype);
    const alternatives = (...transcripts) => transcripts.map((transcript) => ({ transcript }));

    assert.equal(app.detectConfirmation(alternatives("cem", "sim")), true);
    assert.equal(app.detectConfirmation(alternatives("cem")), true, "the homophone alone still confirms");
    assert.equal(app.detectConfirmation(alternatives("sim", "cem")), true);
    assert.equal(app.detectConfirmation(alternatives("sim", "não")), null, "the same audio read both ways");
    assert.equal(app.detectConfirmation(alternatives("talvez", "não")), false);
    assert.equal(app.detectConfirmation([]), null);
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
    const executions = [];
    app.confirmAndMakeMove = async (move, generation, options) => confirmations.push({ move, options });
    app.executeMove = async (move) => executions.push(move);
    app.flushQueuedState = async () => undefined;

    await app.handleAlternatives([{ transcript: "Cavalo efe treis", confidence: 0.7 }]);

    assert.equal(statuses.length, 1, "the failure is always reported visibly");
    assert.match(statuses[0], /Cavalo efe treis/);
    assert.match(statuses[0], /nenhum lance legal/i);

    assert.equal(confirmations.length, 1, "the closest legal move is offered");
    assert.equal(confirmations[0].move, knight);
    assert.equal(confirmations[0].options.approximate, "Cavalo efe treis");
    assert.equal(executions.length, 0, "an approximate match is never played without confirmation");
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
    const executions = [];
    app.confirmAndMakeMove = async (move, generation, options) => confirmations.push({ move, options });
    app.executeMove = async (move) => executions.push(move);
    app.flushQueuedState = async () => undefined;

    await app.handleAlternatives([{ transcript: "qual é o placar do jogo", confidence: 0.9 }]);

    assert.equal(confirmations.length, 0, "nothing close enough to suggest");
    assert.equal(executions.length, 0, "nothing is played on a transcript that matched nothing");
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

// Shared fixture for the immediate-execution and confirmation-flow tests.
function makeMoveApp(FreedomChessApp, { legalMoves }) {
    const app = Object.create(FreedomChessApp.prototype);
    const spoken = [];
    const statuses = [];
    const executions = [];
    const confirmations = [];

    app.enabled = true;
    app.busy = false;
    app.activationGeneration = 1;
    app.pendingConfirmation = null;
    app.queuedState = null;
    app.bridge = {
        getState: async () => ({ available: true, boardConnected: true, fen: "fen", legalMoves })
    };
    app.assertUsableState = () => undefined;
    app.flushQueuedState = async () => undefined;
    app.isSessionCurrent = (generation) => app.enabled && generation === app.activationGeneration;
    app.ui = {
        announceStatus: (message) => statuses.push(message),
        showConfirmation: () => { throw new Error("showConfirmation deve estar mudo no caminho imediato"); },
    };
    app.voice = { speak: async (message) => spoken.push(message) };
    app.executeMove = async (move) => executions.push(move);
    app.confirmAndMakeMove = async (move, generation, options) => confirmations.push({ move, options });

    return { app, spoken, statuses, executions, confirmations };
}

test("a high-confidence top match is played without confirmation", async () => {
    // The "convicção alta" fast path: a confident, unambiguous top guess plays
    // at once. Default threshold is 0.97. Coordinate input ("g1 f3").
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };
    const { app, executions, confirmations } = makeMoveApp(FreedomChessApp, { legalMoves: [knight] });

    await app.handleAlternatives([{ transcript: "g1 f3", confidence: 0.98 }]);

    assert.equal(executions.length, 1, "a confident move is played straight away");
    assert.equal(executions[0], knight);
    assert.equal(confirmations.length, 0, "no confirmation when conviction is high");
    assert.equal(app.busy, false);
});

test("a low-confidence match is confirmed, not auto-played", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };
    const { app, executions, confirmations } = makeMoveApp(FreedomChessApp, { legalMoves: [knight] });

    await app.handleAlternatives([{ transcript: "g1 f3", confidence: 0.4 }]);

    assert.equal(confirmations.length, 1, "an unsure move waits for a spoken yes");
    assert.equal(confirmations[0].move, knight);
    assert.equal(executions.length, 0, "nothing reaches the board before a yes");
});

test("a match with no confidence score is confirmed", async () => {
    // The regression guard for the wrong-move bug: when the recognizer reports
    // no confidence, the move is never auto-played.
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };
    const { app, executions, confirmations } = makeMoveApp(FreedomChessApp, { legalMoves: [knight] });

    await app.handleAlternatives([{ transcript: "g1 f3", confidence: null }]);

    assert.equal(confirmations.length, 1, "no confidence means confirm");
    assert.equal(executions.length, 0);
});

test("a confident move that is only a secondary alternative is confirmed", async () => {
    // The confident TOP guess is something illegal/unmatched; the actual move
    // only surfaced in a lower alternative, so it must not auto-play.
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };
    const { app, executions, confirmations } = makeMoveApp(FreedomChessApp, { legalMoves: [knight] });

    await app.handleAlternatives([
        { transcript: "qual é o placar", confidence: 0.98 },
        { transcript: "g1 f3", confidence: 0.98 },
    ]);

    assert.equal(confirmations.length, 1, "only the top alternative earns the fast path");
    assert.equal(confirmations[0].move, knight);
    assert.equal(executions.length, 0);
});

test("a promotion whose piece was not named asks for the piece, not the origin square", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const promotions = ["q", "r", "b", "n"].map((promotion) => ({
        from: "e7", to: "e8", piece: "p", flags: "np", promotion, san: `e8=${promotion.toUpperCase()}`
    }));
    const { app, spoken, executions, confirmations } = makeMoveApp(FreedomChessApp, { legalMoves: promotions });

    await app.handleAlternatives([{ transcript: "e7 e8", confidence: 0.9 }]);

    assert.equal(executions.length, 0, "an unnamed promotion is never auto-played");
    assert.equal(confirmations.length, 0);
    assert.equal(spoken.length, 1);
    assert.match(spoken[0], /peça da promoção/);
    assert.doesNotMatch(spoken[0], /casa de origem/);
});

test("a fully named promotion is resolved to the right piece and played when confident", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const promotions = ["q", "r", "b", "n"].map((promotion) => ({
        from: "e7", to: "e8", piece: "p", flags: "np", promotion, san: `e8=${promotion.toUpperCase()}`
    }));
    const { app, executions, confirmations } = makeMoveApp(FreedomChessApp, { legalMoves: promotions });

    await app.handleAlternatives([{ transcript: "e7 e8 dama", confidence: 0.98 }]);

    assert.equal(executions.length, 1, "a confident, fully named promotion plays");
    assert.equal(realCore.movePromotion(executions[0]), "q");
    assert.equal(confirmations.length, 0);
});

test("a fully named promotion at low confidence is confirmed", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const promotions = ["q", "r", "b", "n"].map((promotion) => ({
        from: "e7", to: "e8", piece: "p", flags: "np", promotion, san: `e8=${promotion.toUpperCase()}`
    }));
    const { app, executions, confirmations } = makeMoveApp(FreedomChessApp, { legalMoves: promotions });

    await app.handleAlternatives([{ transcript: "e7 e8 dama", confidence: 0.5 }]);

    assert.equal(confirmations.length, 1, "an unsure promotion still gets confirmed");
    assert.equal(realCore.movePromotion(confirmations[0].move), "q");
    assert.equal(executions.length, 0);
});

test("coordinate-only: a piece name or bare destination is refused with guidance", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };

    for (const bare of ["cavalo f3", "e4"]) {
        const { app, spoken, executions, confirmations } =
            makeMoveApp(FreedomChessApp, { legalMoves: [knight] });
        await app.handleAlternatives([{ transcript: bare, confidence: 0.98 }]);

        assert.equal(executions.length, 0, `"${bare}" must not be played`);
        assert.equal(confirmations.length, 0, `"${bare}" must not be confirmed`);
        assert.equal(spoken.length, 1, `"${bare}" gets one guidance message`);
        assert.match(spoken[0], /origem/, bare);
        assert.match(spoken[0], /e2 e4/, bare);
    }
});

test("move confirmation is voice-only: no dialog, 'muda' rejects, 'confirma' plays", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const app = Object.create(FreedomChessApp.prototype);
    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };
    const executions = [];
    let dialogOpened = false;

    app.enabled = true;
    app.activationGeneration = 1;
    app.pendingConfirmation = null;
    app.voiceState = "";
    app.isSessionCurrent = (generation) => app.enabled && generation === app.activationGeneration;
    app.ui = {
        setState: () => undefined,
        announceStatus: () => undefined,
        showConfirmation: () => { dialogOpened = true; throw new Error("a confirmação não pode abrir diálogo sobre o tabuleiro"); },
    };
    app.voice = {
        speak: async () => undefined,
        startListening: () => undefined,
        stopRecognition: () => undefined,
    };
    app.executeMove = async (move) => executions.push(move);

    // "muda" rejects and nothing is played.
    const rejected = app.confirmAndMakeMove(knight, 1);
    await tick();
    assert.ok(app.pendingConfirmation, "the move waits for a spoken answer");
    assert.equal(dialogOpened, false, "no panel is drawn in front of the board");
    await app.handleAlternatives([{ transcript: "muda" }]);
    await rejected;
    assert.equal(executions.length, 0, "'muda' does not play the move");

    // "confirma" plays it.
    const confirmed = app.confirmAndMakeMove(knight, 1);
    await tick();
    await app.handleAlternatives([{ transcript: "confirma" }]);
    await confirmed;
    assert.equal(executions.length, 1, "'confirma' plays the move");
    assert.equal(executions[0], knight);
    assert.equal(dialogOpened, false, "still no dialog anywhere in the flow");
});

test("a second transcript cannot start a second move while one is executing", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };
    const { app, statuses, executions } = makeMoveApp(FreedomChessApp, { legalMoves: [knight] });
    app.busy = true;

    await app.handleAlternatives([{ transcript: "cavalo f3", confidence: 0.9 }]);

    assert.equal(executions.length, 0, "the move in flight is not disturbed");
    assert.equal(statuses.length, 1, "the collision is reported");
    assert.equal(app.busy, true, "the guard must not clear another path's flag");
});

test("a move the board never confirms is reported by name", async () => {
    const realCore = require("../builtFunctions/core.js");
    const { FreedomChessApp } = loadInternals({ core: realCore });
    const knight = { from: "g1", to: "f3", piece: "n", flags: "n", san: "Nf3" };
    const spoken = [];
    const app = Object.create(FreedomChessApp.prototype);

    app.enabled = true;
    app.activationGeneration = 1;
    app.isSessionCurrent = (generation) => app.enabled && generation === app.activationGeneration;
    app.assertUsableState = () => undefined;
    app.bridge = {
        getState: async () => ({ available: true, boardConnected: true, fen: "fen", legalMoves: [knight] })
    };
    app.ui = { announceStatus: () => undefined };
    app.voice = { speak: async (message) => spoken.push(message) };
    app.performPointerMove = () => undefined;
    app.waitForMove = async () => null;
    app.updatePhraseHints = () => undefined;

    await app.executeMove(knight, 1);

    assert.equal(spoken.length, 1);
    assert.match(spoken[0], /Não consegui completar/);
    assert.match(spoken[0], /[Cc]avalo/);
});

test("three unreadable answers cancel instead of re-prompting forever", async () => {
    const { FreedomChessApp } = loadInternals();
    const app = Object.create(FreedomChessApp.prototype);
    const spoken = [];
    let decided = "untouched";

    app.enabled = true;
    app.activationGeneration = 1;
    app.pendingConfirmation = { misses: 0, finish: (value) => { decided = value; } };
    app.voice = { speak: async (message) => spoken.push(message) };

    await app.handleAlternatives([{ transcript: "hum" }]);
    await app.handleAlternatives([{ transcript: "hum" }]);
    assert.equal(decided, "untouched", "still waiting after two unreadable answers");
    assert.deepEqual(spoken, ["Diga confirma ou muda.", "Diga confirma ou muda."]);

    await app.handleAlternatives([{ transcript: "hum" }]);
    assert.equal(decided, false, "the third unreadable answer cancels");
    assert.equal(spoken.length, 2, "cancelling does not add another prompt");
});

test("a browser without on-device recognition fails clearly and never goes online", async () => {
    const { FreedomChessApp } = loadInternals();
    const app = Object.create(FreedomChessApp.prototype);
    app.ui = { showConfirmation: () => { throw new Error("uma ativação sem pacote local não deve perguntar nada"); } };

    // The default RecognitionMock exposes no available/install and no
    // processLocally, so supportsLocal is false — a browser with no on-device
    // pt-BR. With online recognition removed, that is a hard, actionable stop,
    // not a silent switch to the cloud.
    await assert.rejects(
        () => app.prepareRecognitionMode(),
        (error) => {
            assert.doesNotMatch(error.message, /online/i, "the message never offers an online mode");
            assert.match(error.message, /dispositivo/i);
            return true;
        },
    );
});
