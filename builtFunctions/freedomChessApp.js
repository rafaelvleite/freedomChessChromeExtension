(function bootstrapFreedomChess() {
    "use strict";

    const Core = globalThis.FreedomChessCore;
    if (!Core) {
        console.error("Freedom Chess: o núcleo não foi carregado.");
        return;
    }

    const LANGUAGE = "pt-BR";
    const BUTTON_ID = "freedom-chess-toggle";
    const STATUS_ID = "freedom-chess-status";
    const DIALOG_ID = "freedom-chess-dialog";
    const FALLBACK_CONTROLS_ID = "freedom-chess-fallback-controls";
    const PAGE_SOURCE = "freedom-chess-page";
    const EXTENSION_SOURCE = "freedom-chess-extension";
    const ACTIVE_BOARD_SELECTOR = 'wc-chess-board[data-freedom-chess-active-board="true"]';
    const MOVE_TIMEOUT_MS = 2500;

    const delay = (milliseconds) => new Promise((resolve) => {
        window.setTimeout(resolve, milliseconds);
    });

    function uniqueBy(items, keyBuilder) {
        const found = new Map();
        for (const item of items) {
            found.set(keyBuilder(item), item);
        }
        return [...found.values()];
    }

    function moveKey(move) {
        if (!move) {
            return "";
        }
        return [move.from || "", move.to || "", move.promotion || "", move.san || ""].join(":");
    }

    function safeErrorMessage(error) {
        if (!error) {
            return "erro desconhecido";
        }
        return String(error.message || error).replace(/^Error:\s*/i, "");
    }

    function sendRuntimeMessage(message) {
        return new Promise((resolve) => {
            if (!globalThis.chrome?.runtime?.sendMessage) {
                resolve({ ok: true });
                return;
            }

            try {
                chrome.runtime.sendMessage(message, (response) => {
                    if (chrome.runtime.lastError) {
                        resolve({ ok: false, error: chrome.runtime.lastError.message });
                        return;
                    }
                    resolve(response || { ok: true });
                });
            } catch (error) {
                resolve({ ok: false, error: safeErrorMessage(error) });
            }
        });
    }

    class SiteBridge {
        constructor(onStateChanged) {
            this.token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
            this.pending = new Map();
            this.onStateChanged = onStateChanged;
            this.handleMessage = this.handleMessage.bind(this);
            window.addEventListener("message", this.handleMessage);
        }

        handleMessage(event) {
            if (event.source !== window || event.origin !== window.location.origin) {
                return;
            }

            const message = event.data;
            if (!message || message.source !== PAGE_SOURCE) {
                return;
            }

            if (message.type === "FREEDOM_CHESS_STATE_CHANGED") {
                if (message.state && typeof message.state === "object") {
                    this.onStateChanged?.(message.state);
                }
                return;
            }

            if (message.type !== "FREEDOM_CHESS_STATE" || message.token !== this.token) {
                return;
            }

            const request = this.pending.get(message.requestId);
            if (!request) {
                return;
            }

            window.clearTimeout(request.timeoutId);
            this.pending.delete(message.requestId);
            if (message.ok) {
                request.resolve(message.state);
            } else {
                const bridgeMessage = typeof message.error === "string"
                    ? message.error
                    : message.error?.message;
                request.reject(new Error(bridgeMessage || "O Chess.com não retornou o estado da partida."));
            }
        }

        getState(timeoutMilliseconds = 1800, { minimal = false } = {}) {
            const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
            return new Promise((resolve, reject) => {
                const timeoutId = window.setTimeout(() => {
                    this.pending.delete(requestId);
                    reject(new Error("Tempo esgotado ao ler a posição atual."));
                }, timeoutMilliseconds);

                this.pending.set(requestId, { resolve, reject, timeoutId });
                window.postMessage({
                    source: EXTENSION_SOURCE,
                    type: "FREEDOM_CHESS_GET_STATE",
                    requestId,
                    token: this.token,
                    minimal: Boolean(minimal),
                }, window.location.origin);
            });
        }

        destroy() {
            window.removeEventListener("message", this.handleMessage);
            for (const request of this.pending.values()) {
                window.clearTimeout(request.timeoutId);
                request.reject(new Error("Freedom Chess foi encerrado."));
            }
            this.pending.clear();
        }
    }

    class FreedomUi {
        constructor(onToggle) {
            this.onToggle = onToggle;
            this.button = null;
            this.status = null;
            this.dialog = null;
            this.dialogResolver = null;
            this.dialogPreviousFocus = null;
            this.dialogKeyHandler = null;
            this.ensureStatusRegion();
        }

        ensureStatusRegion() {
            let status = document.getElementById(STATUS_ID);
            if (!status) {
                status = document.createElement("div");
                status.id = STATUS_ID;
                status.className = "freedom-chess-visually-hidden";
                status.setAttribute("role", "status");
                status.setAttribute("aria-live", "polite");
                status.setAttribute("aria-atomic", "true");
                (document.body || document.documentElement).append(status);
            }
            this.status = status;
        }

        mount(controls) {
            if (!controls) {
                return;
            }

            if (!this.button) {
                const button = document.createElement("button");
                button.id = BUTTON_ID;
                button.type = "button";
                button.className = "freedom-chess-button";
                button.setAttribute("aria-label", "Ativar controle de xadrez por voz em português");
                button.setAttribute("aria-pressed", "false");
                button.title = "Freedom Chess — controle por voz em português";
                button.innerHTML = [
                    '<span class="freedom-chess-button-icon" aria-hidden="true">🎙️</span>',
                    '<span class="freedom-chess-visually-hidden">Freedom Chess</span>',
                ].join("");
                button.addEventListener("click", () => this.onToggle?.());
                this.button = button;
            }

            if (this.button.parentElement !== controls) {
                controls.append(this.button);
            }
        }

        setEnabled(enabled, state = enabled ? "listening" : "disabled") {
            if (!this.button) {
                return;
            }
            this.button.setAttribute("aria-pressed", String(Boolean(enabled)));
            this.button.dataset.state = state;
            this.button.classList.toggle("is-enabled", Boolean(enabled));
            this.button.setAttribute(
                "aria-label",
                enabled
                    ? "Desativar controle de xadrez por voz em português"
                    : "Ativar controle de xadrez por voz em português",
            );
        }

        setState(state) {
            if (this.button) {
                this.button.dataset.state = state;
            }
        }

        announceStatus(message) {
            if (!this.status) {
                this.ensureStatusRegion();
            }
            this.status.textContent = "";
            window.setTimeout(() => {
                if (this.status) {
                    this.status.textContent = message;
                }
            }, 10);
        }

        showNotice(title, message, buttonLabel = "OK") {
            return this.showDialog({
                title,
                message,
                confirmLabel: buttonLabel,
                cancelLabel: null,
            });
        }

        showConfirmation({
            title,
            message,
            confirmLabel = "Sim",
            cancelLabel = "Não",
            danger = false,
        }) {
            return this.showDialog({ title, message, confirmLabel, cancelLabel, danger });
        }

        showDialog({ title, message, confirmLabel, cancelLabel, danger = false }) {
            this.closeDialog(false);
            this.dialogPreviousFocus = document.activeElement;

            const overlay = document.createElement("div");
            overlay.id = DIALOG_ID;
            overlay.className = "freedom-chess-dialog-overlay";

            const dialog = document.createElement("section");
            dialog.className = "freedom-chess-dialog";
            dialog.setAttribute("role", "alertdialog");
            dialog.setAttribute("aria-modal", "true");
            dialog.setAttribute("aria-labelledby", `${DIALOG_ID}-title`);
            dialog.setAttribute("aria-describedby", `${DIALOG_ID}-message`);

            const heading = document.createElement("h2");
            heading.id = `${DIALOG_ID}-title`;
            heading.textContent = title;

            const body = document.createElement("p");
            body.id = `${DIALOG_ID}-message`;
            body.textContent = message;

            const actions = document.createElement("div");
            actions.className = "freedom-chess-dialog-actions";

            const confirmButton = document.createElement("button");
            confirmButton.type = "button";
            confirmButton.className = danger
                ? "freedom-chess-dialog-button is-danger"
                : "freedom-chess-dialog-button is-primary";
            confirmButton.textContent = confirmLabel;
            confirmButton.addEventListener("click", () => this.closeDialog(true));
            actions.append(confirmButton);

            let cancelButton = null;
            if (cancelLabel) {
                cancelButton = document.createElement("button");
                cancelButton.type = "button";
                cancelButton.className = "freedom-chess-dialog-button";
                cancelButton.textContent = cancelLabel;
                cancelButton.addEventListener("click", () => this.closeDialog(false));
                actions.append(cancelButton);
            }

            dialog.append(heading, body, actions);
            overlay.append(dialog);
            (document.body || document.documentElement).append(overlay);
            this.dialog = overlay;

            this.dialogKeyHandler = (event) => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    this.closeDialog(false);
                    return;
                }
                if (event.key !== "Tab") {
                    return;
                }
                const buttons = [...dialog.querySelectorAll("button:not([disabled])")];
                if (!buttons.length) {
                    event.preventDefault();
                    return;
                }
                const first = buttons[0];
                const last = buttons[buttons.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            };
            overlay.addEventListener("keydown", this.dialogKeyHandler);
            if (cancelButton) {
                overlay.addEventListener("click", (event) => {
                    if (event.target === overlay) {
                        this.closeDialog(false);
                    }
                });
            }

            const promise = new Promise((resolve) => {
                this.dialogResolver = resolve;
            });

            window.setTimeout(() => (danger && cancelButton ? cancelButton : confirmButton).focus(), 0);
            return promise;
        }

        closeDialog(value = false) {
            const resolver = this.dialogResolver;
            const previousFocus = this.dialogPreviousFocus;
            if (this.dialog && this.dialogKeyHandler) {
                this.dialog.removeEventListener("keydown", this.dialogKeyHandler);
            }
            this.dialogResolver = null;
            this.dialogPreviousFocus = null;
            this.dialogKeyHandler = null;
            this.dialog?.remove();
            this.dialog = null;
            if (previousFocus?.isConnected && typeof previousFocus.focus === "function") {
                previousFocus.focus();
            }
            resolver?.(Boolean(value));
        }
    }

    class VoiceController {
        constructor({ onAlternatives, onFatalError, onState, onOutput }) {
            this.onAlternatives = onAlternatives;
            this.onFatalError = onFatalError;
            this.onState = onState;
            this.onOutput = onOutput;
            this.Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
            this.recognition = null;
            this.enabled = false;
            this.localMode = true;
            this.isRecognitionActive = false;
            this.recognitionStartPending = false;
            this.wantsListening = false;
            this.restartTimer = null;
            this.restartAttempts = 0;
            this.abortedRecognitions = new WeakSet();
            this.networkErrors = 0;
            this.otherErrors = 0;
            this.phraseHintsDisabled = false;
            this.speechGeneration = 0;
            this.activeSpeechFinish = null;
            this.phraseHints = [];
        }

        static getRecognitionConstructor() {
            return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
        }

        setState(state) {
            this.onState?.(state);
        }

        activate({ localMode }) {
            if (!this.Recognition) {
                throw new Error("Este navegador não oferece reconhecimento de voz compatível.");
            }
            this.enabled = true;
            this.localMode = Boolean(localMode);
            this.restartAttempts = 0;
            this.networkErrors = 0;
            this.otherErrors = 0;
            this.phraseHintsDisabled = false;
            this.createRecognition();
        }

        createRecognition() {
            this.stopRecognition(true);
            const recognition = new this.Recognition();
            recognition.lang = LANGUAGE;
            recognition.continuous = false;
            recognition.interimResults = false;
            recognition.maxAlternatives = 5;

            if ("processLocally" in recognition) {
                recognition.processLocally = this.localMode;
            }
            if ("quality" in recognition) {
                recognition.quality = "command";
            }

            recognition.onstart = () => {
                if (recognition !== this.recognition) {
                    if (this.abortedRecognitions.has(recognition)) {
                        try {
                            recognition.abort();
                        } catch (_error) {
                            // A superseded recognizer may already be ending.
                        }
                    }
                    return;
                }
                if (!this.enabled || !this.wantsListening) {
                    this.recognitionStartPending = false;
                    this.abortedRecognitions.add(recognition);
                    try {
                        recognition.abort();
                    } catch (_error) {
                        // The late session may already be ending.
                    }
                    return;
                }
                this.recognitionStartPending = false;
                this.isRecognitionActive = true;
                this.setState("listening");
            };

            recognition.onresult = (event) => {
                if (recognition !== this.recognition || !this.enabled) {
                    return;
                }

                const result = event.results[event.resultIndex];
                if (!result?.isFinal && result?.isFinal !== undefined) {
                    return;
                }

                const alternatives = [];
                for (let index = 0; index < (result?.length || 0); index += 1) {
                    alternatives.push({
                        transcript: String(result[index].transcript || "").trim(),
                        confidence: Number.isFinite(result[index].confidence)
                            ? result[index].confidence
                            : null,
                    });
                }

                this.restartAttempts = 0;
                this.networkErrors = 0;
                this.otherErrors = 0;
                this.wantsListening = false;
                this.setState("processing");
                if (alternatives.length) {
                    Promise.resolve(this.onAlternatives?.(alternatives)).catch((error) => {
                        this.onFatalError?.(error);
                    });
                } else {
                    this.restartAttempts += 1;
                    this.wantsListening = true;
                }
            };

            recognition.onerror = (event) => {
                if (recognition !== this.recognition) {
                    return;
                }

                const code = event.error || "unknown";
                if (this.abortedRecognitions.has(recognition) || code === "aborted") {
                    this.abortedRecognitions.delete(recognition);
                    return;
                }

                if (code === "no-speech") {
                    this.restartAttempts += 1;
                    return;
                }

                if (code === "network") {
                    this.restartAttempts += 1;
                    this.networkErrors += 1;
                    if (this.networkErrors >= 3) {
                        this.fail("O reconhecimento de voz falhou repetidamente por erro de rede.");
                    }
                    return;
                }

                if (code === "phrases-not-supported" && !this.phraseHintsDisabled) {
                    this.phraseHintsDisabled = true;
                    this.restartAttempts += 1;
                    try {
                        recognition.phrases = [];
                    } catch (_error) {
                        // The next recognizer will simply omit contextual hints.
                    }
                    return;
                }

                if (code === "audio-capture") {
                    this.fail("Nenhum microfone disponível foi encontrado pelo navegador.");
                    return;
                }

                if (code === "not-allowed" || code === "service-not-allowed") {
                    this.fail("Permissão de microfone negada pelo navegador.");
                    return;
                }

                if (code === "language-not-supported") {
                    this.fail("O pacote de voz pt-BR não está disponível.");
                    return;
                }

                this.restartAttempts += 1;
                this.otherErrors += 1;
                if (this.otherErrors >= 3) {
                    this.fail(`O reconhecimento de voz foi interrompido pelo erro ${code}.`);
                }
            };

            recognition.onend = () => {
                if (recognition !== this.recognition) {
                    return;
                }
                this.abortedRecognitions.delete(recognition);
                this.recognitionStartPending = false;
                this.isRecognitionActive = false;
                if (this.enabled && this.wantsListening) {
                    this.scheduleRestart();
                }
            };

            this.recognition = recognition;
            this.applyPhraseHints();
        }

        fail(message) {
            this.enabled = false;
            this.wantsListening = false;
            this.onFatalError?.(new Error(message));
        }

        updatePhraseHints(phrases) {
            this.phraseHints = [...new Set((phrases || []).filter(Boolean))].slice(0, 200);
            if (!this.isRecognitionActive) {
                this.applyPhraseHints();
            }
        }

        applyPhraseHints() {
            if (this.phraseHintsDisabled || !this.recognition || !("phrases" in this.recognition)) {
                return;
            }
            const Phrase = globalThis.SpeechRecognitionPhrase;
            if (typeof Phrase !== "function") {
                return;
            }
            try {
                this.recognition.phrases = this.phraseHints.map((phrase) => new Phrase(phrase, 3));
            } catch (_error) {
                // Contextual biasing is progressive enhancement.
            }
        }

        startListening() {
            if (!this.enabled || !this.recognition) {
                return;
            }
            this.wantsListening = true;
            if (this.isRecognitionActive || this.recognitionStartPending || this.restartTimer) {
                return;
            }
            this.applyPhraseHints();
            this.recognitionStartPending = true;
            try {
                this.recognition.start();
            } catch (error) {
                if (!/already started|recognition has already started/i.test(String(error.message || error))) {
                    this.recognitionStartPending = false;
                    this.restartAttempts += 1;
                    this.scheduleRestart();
                }
            }
        }

        scheduleRestart() {
            if (!this.enabled || !this.wantsListening || this.restartTimer) {
                return;
            }
            const wait = Math.min(250 * (2 ** Math.min(this.restartAttempts, 4)), 4000);
            this.restartTimer = window.setTimeout(() => {
                this.restartTimer = null;
                this.startListening();
            }, wait);
        }

        stopRecognition(abort = true) {
            this.wantsListening = false;
            if (this.restartTimer) {
                window.clearTimeout(this.restartTimer);
                this.restartTimer = null;
            }
            if (this.recognition && (this.isRecognitionActive || this.recognitionStartPending)) {
                try {
                    if (abort) {
                        this.abortedRecognitions.add(this.recognition);
                    }
                    if (abort) {
                        this.recognition.abort();
                    } else {
                        this.recognition.stop();
                    }
                } catch (_error) {
                    // The recognizer may already be ending.
                }
            }
            this.recognitionStartPending = false;
        }

        chooseVoice() {
            const voices = globalThis.speechSynthesis?.getVoices?.() || [];
            return voices.find((voice) => voice.lang?.toLowerCase() === "pt-br" && voice.localService === true)
                || voices.find((voice) => voice.lang?.toLowerCase().startsWith("pt") && voice.localService === true)
                || voices.find((voice) => voice.localService === true)
                || null;
        }

        speak(text, { resume = true, allowWhenDisabled = false } = {}) {
            const message = String(text || "").trim();
            if (!this.enabled && !allowWhenDisabled) {
                return Promise.resolve();
            }
            if (message) {
                this.onOutput?.(message);
            }
            const voice = message ? this.chooseVoice() : null;
            if (!message || !voice || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
                if (resume && this.enabled) {
                    this.startListening();
                }
                return Promise.resolve();
            }

            const finishPreviousSpeech = this.activeSpeechFinish;
            const generation = ++this.speechGeneration;
            finishPreviousSpeech?.();
            this.stopRecognition(true);
            this.setState("speaking");
            globalThis.speechSynthesis.cancel();

            return new Promise((resolve) => {
                const utterance = new SpeechSynthesisUtterance(message);
                utterance.lang = LANGUAGE;
                utterance.rate = 1.08;
                utterance.pitch = 1;
                utterance.volume = 1;
                utterance.voice = voice;

                let finished = false;
                let timeoutId;
                const finish = (cancelSpeech = false) => {
                    if (finished) {
                        return;
                    }
                    finished = true;
                    window.clearTimeout(timeoutId);
                    if (cancelSpeech) {
                        globalThis.speechSynthesis.cancel();
                    }
                    if (this.activeSpeechFinish === finish) {
                        this.activeSpeechFinish = null;
                    }
                    if (generation === this.speechGeneration && resume && this.enabled) {
                        if (cancelSpeech) {
                            window.setTimeout(() => {
                                if (generation === this.speechGeneration && this.enabled) {
                                    this.startListening();
                                }
                            }, 150);
                        } else {
                            this.startListening();
                        }
                    } else if (generation === this.speechGeneration && !this.enabled) {
                        this.setState("disabled");
                    }
                    resolve();
                };
                timeoutId = window.setTimeout(() => finish(true), Math.max(6000, message.length * 140));
                this.activeSpeechFinish = finish;

                utterance.onend = () => finish(false);
                utterance.onerror = () => finish(true);
                try {
                    globalThis.speechSynthesis.speak(utterance);
                } catch (_error) {
                    finish(true);
                }
            });
        }

        disable({ cancelSpeech = true } = {}) {
            this.enabled = false;
            this.stopRecognition(true);
            this.recognition = null;
            this.recognitionStartPending = false;
            this.isRecognitionActive = false;
            this.restartAttempts = 0;
            this.speechGeneration += 1;
            const finishSpeech = this.activeSpeechFinish;
            this.activeSpeechFinish = null;
            if (cancelSpeech) {
                globalThis.speechSynthesis?.cancel?.();
            }
            finishSpeech?.();
            this.setState("disabled");
        }
    }

    class FreedomChessApp {
        constructor() {
            this.enabled = false;
            this.busy = false;
            this.currentState = null;
            this.lastAnnouncedMove = "";
            this.pendingConfirmation = null;
            this.mountTimer = null;
            this.queuedState = null;
            this.activationGeneration = 0;
            this.voiceState = "disabled";

            this.ui = new FreedomUi(() => this.toggle());
            this.bridge = new SiteBridge((state) => this.handleStateChanged(state));
            this.voice = new VoiceController({
                onAlternatives: (alternatives) => this.handleAlternatives(alternatives),
                onFatalError: (error) => this.handleFatalVoiceError(error),
                onState: (state) => {
                    this.voiceState = state;
                    this.ui.setState(state);
                    if (this.enabled) {
                        this.ui.setEnabled(true, state);
                    }
                },
                onOutput: (message) => this.ui.announceStatus(message),
            });

            this.handleRuntimeMessage = this.handleRuntimeMessage.bind(this);
            chrome.runtime?.onMessage?.addListener(this.handleRuntimeMessage);

            this.mountObserver = new MutationObserver(() => this.scheduleMount());
            this.mountObserver.observe(document.documentElement, { childList: true, subtree: true });
            this.scheduleMount();
        }

        handleRuntimeMessage(message) {
            if (message?.type === "freedomChess:audio:revoked") {
                this.disable({ announce: true, reason: "O microfone foi ativado em outra aba." });
            } else if (message?.type === "freedomChess:toolbar-toggle") {
                this.toggle();
            }
        }

        scheduleMount() {
            if (this.mountTimer) {
                return;
            }
            this.mountTimer = window.setTimeout(() => {
                this.mountTimer = null;
                const board = document.querySelector("wc-chess-board");
                const controls = document.querySelector(".board-layout-controls");
                if (board) {
                    let fallback = document.getElementById(FALLBACK_CONTROLS_ID);
                    if (!controls && !fallback) {
                        fallback = document.createElement("div");
                        fallback.id = FALLBACK_CONTROLS_ID;
                        fallback.setAttribute("role", "group");
                        fallback.setAttribute("aria-label", "Controles do Freedom Chess");
                        (document.body || document.documentElement).append(fallback);
                    }
                    const host = controls || fallback;
                    if (host) {
                        this.ui.mount(host);
                        this.ui.setEnabled(this.enabled, this.enabled ? this.voiceState : "disabled");
                    }
                    if (controls && fallback) {
                        fallback.remove();
                    }
                } else if (this.enabled && !board) {
                    this.disable({ announce: false });
                } else {
                    document.getElementById(FALLBACK_CONTROLS_ID)?.remove();
                }
            }, 120);
        }

        async toggle() {
            if (this.enabled) {
                await this.disable({ announce: true });
                return;
            }
            if (this.busy) {
                return;
            }
            await this.enable();
        }

        async enable() {
            if (this.enabled || this.busy) {
                return;
            }
            const generation = ++this.activationGeneration;
            const isCurrent = () => generation === this.activationGeneration;
            this.busy = true;
            this.voiceState = "preparing";
            this.ui.setState("preparing");

            try {
                const state = await this.bridge.getState();
                if (!isCurrent()) {
                    return;
                }
                this.assertUsableState(state);
                this.currentState = state;

                if (this.isNativeVoiceActive()) {
                    const continueAnyway = await this.ui.showConfirmation({
                        title: "Outro controle de voz está ativo",
                        message: "Desative o controle de voz nativo do Chess.com para evitar dois microfones ouvindo ao mesmo tempo. Deseja continuar mesmo assim?",
                        confirmLabel: "Continuar",
                        cancelLabel: "Cancelar",
                    });
                    if (!isCurrent() || !continueAnyway) {
                        return;
                    }
                }

                const localMode = await this.prepareRecognitionMode(isCurrent);
                if (!isCurrent() || localMode === null) {
                    return;
                }

                const claim = await sendRuntimeMessage({ type: "freedomChess:audio:claim" });
                if (!isCurrent()) {
                    return;
                }
                if (!claim?.ok) {
                    throw new Error(claim?.error || "Não foi possível reservar o microfone para esta aba.");
                }

                this.voice.activate({ localMode });
                this.enabled = true;
                this.lastAnnouncedMove = moveKey(state.lastMove);
                this.voiceState = "speaking";
                this.ui.setEnabled(true, "speaking");
                this.updatePhraseHints(state);
                await sendRuntimeMessage({ type: "freedomChess:audio:state", enabled: true });
                if (!isCurrent() || !this.enabled) {
                    return;
                }
                await this.voice.speak(
                    localMode
                        ? "Modo Freedom ativo com reconhecimento local. Diga seu lance."
                        : "Modo Freedom ativo com reconhecimento online. Diga seu lance.",
                    { resume: true },
                );
            } catch (error) {
                if (!isCurrent()) {
                    return;
                }
                this.enabled = false;
                this.voice.disable();
                this.ui.setEnabled(false);
                this.ui.announceStatus(safeErrorMessage(error));
                await this.ui.showNotice("Não foi possível ativar", safeErrorMessage(error));
                await sendRuntimeMessage({ type: "freedomChess:audio:release" });
            } finally {
                this.busy = false;
                if (!this.enabled) {
                    this.ui.setEnabled(false, "disabled");
                }
            }
        }

        assertUsableState(state) {
            if (!state?.available || !state?.boardConnected || !state?.fen) {
                throw new Error("Não foi possível ler uma posição confiável do tabuleiro atual.");
            }
            if (!Array.isArray(state.legalMoves)) {
                throw new Error("O Chess.com não forneceu a lista de lances legais.");
            }
        }

        isSessionCurrent(generation) {
            return this.enabled && this.activationGeneration === generation;
        }

        isNativeVoiceActive() {
            const nativeButton = document.querySelector(".voice-move-icon-button");
            if (!nativeButton) {
                return false;
            }
            const label = String(nativeButton.getAttribute("aria-label") || "").toLowerCase();
            return label.includes("disable voice")
                || label.includes("desativar")
                || nativeButton.getAttribute("aria-pressed") === "true";
        }

        async callAvailability(Recognition, localOnly) {
            const options = {
                langs: [LANGUAGE],
                processLocally: localOnly,
                quality: "command",
            };
            try {
                return await Recognition.available(options);
            } catch (_error) {
                delete options.quality;
                return Recognition.available(options);
            }
        }

        async installLanguagePack(Recognition) {
            const options = {
                langs: [LANGUAGE],
                processLocally: true,
                quality: "command",
            };
            try {
                return await Recognition.install(options);
            } catch (_error) {
                delete options.quality;
                delete options.processLocally;
                return Recognition.install(options);
            }
        }

        async offerOnlineFallback(message) {
            return this.ui.showConfirmation({
                title: "Usar reconhecimento online?",
                message: `${message} No modo online, o navegador pode enviar áudio e transcrição ao serviço de reconhecimento. Nenhuma API paga será usada.`,
                confirmLabel: "Usar online",
                cancelLabel: "Cancelar",
            });
        }

        async prepareRecognitionMode(isCurrent = () => true) {
            const Recognition = VoiceController.getRecognitionConstructor();
            if (!Recognition) {
                throw new Error("O navegador não oferece a Web Speech API.");
            }

            const supportsLocal = typeof Recognition.available === "function"
                && typeof Recognition.install === "function"
                && "processLocally" in new Recognition();

            if (!supportsLocal) {
                const online = await this.offerOnlineFallback("O reconhecimento local não está disponível neste navegador.");
                return isCurrent() && online ? false : null;
            }

            let availability;
            try {
                availability = await this.callAvailability(Recognition, true);
            } catch (error) {
                if (!isCurrent()) {
                    return null;
                }
                const online = await this.offerOnlineFallback(`Não foi possível consultar o pacote local: ${safeErrorMessage(error)}.`);
                return isCurrent() && online ? false : null;
            }

            if (!isCurrent()) {
                return null;
            }

            if (availability === "available") {
                return true;
            }

            if (availability === "downloadable" || availability === "downloading") {
                const install = await this.ui.showConfirmation({
                    title: "Baixar voz em português",
                    message: "O Chrome pode instalar gratuitamente o pacote pt-BR para reconhecer seus comandos no dispositivo, sem enviar o áudio para terceiros.",
                    confirmLabel: "Baixar pacote",
                    cancelLabel: "Cancelar",
                });
                if (!isCurrent() || !install) {
                    return null;
                }

                this.ui.setState("preparing");
                this.voiceState = "preparing";
                let installed = false;
                let installFailure = "A instalação do pacote local falhou.";
                try {
                    installed = await this.installLanguagePack(Recognition);
                } catch (error) {
                    installFailure = `A instalação do pacote local falhou: ${safeErrorMessage(error)}.`;
                }
                if (!isCurrent()) {
                    return null;
                }
                if (installed) {
                    return true;
                }

                const online = await this.offerOnlineFallback(installFailure);
                return isCurrent() && online ? false : null;
            }

            const online = await this.offerOnlineFallback("Não há um pacote local pt-BR disponível para este dispositivo.");
            return isCurrent() && online ? false : null;
        }

        async disable({ announce = false, reason = "O modo Freedom foi desativado." } = {}) {
            this.activationGeneration += 1;
            const wasEnabled = this.enabled;
            this.enabled = false;
            this.queuedState = null;
            this.pendingConfirmation?.finish(false);
            this.pendingConfirmation = null;
            this.voice.disable({ cancelSpeech: true });
            this.ui.closeDialog(false);
            this.ui.setEnabled(false, "disabled");
            this.ui.announceStatus(reason);
            await sendRuntimeMessage({ type: "freedomChess:audio:release" });
            await sendRuntimeMessage({ type: "freedomChess:audio:state", enabled: false });

            if (announce && wasEnabled) {
                await this.voice.speak(reason, { resume: false, allowWhenDisabled: true });
            }
        }

        handleFatalVoiceError(error) {
            const message = safeErrorMessage(error);
            this.disable({ announce: false });
            this.ui.showNotice("Erro no reconhecimento de voz", message);
            this.ui.announceStatus(message);
        }

        updatePhraseHints(state) {
            const base = [
                "desativar modo",
                "lances legais",
                "movimentos legais",
                "desistir",
                "abandonar",
                "sim",
                "não",
                "cancelar",
                "roque pequeno",
                "roque grande",
            ];
            const moves = (state?.legalMoves || []).map((move) => Core.verbalizeMove(move));
            this.voice.updatePhraseHints([...base, ...moves]);
        }

        async handleStateChanged(state) {
            if (!state || !state.available) {
                return;
            }
            this.currentState = state;
            this.updatePhraseHints(state);

            if (!this.enabled || !state.lastMove) {
                return;
            }

            const key = moveKey(state.lastMove);
            if (!key || key === this.lastAnnouncedMove) {
                return;
            }

            if (this.busy || this.pendingConfirmation) {
                this.queuedState = state;
                return;
            }

            this.lastAnnouncedMove = key;
            await this.voice.speak(`Lance realizado: ${Core.verbalizeMove(state.lastMove)}.`, { resume: true });
        }

        detectCommand(text) {
            const normalized = Core.normalizeSpeech(text);
            const compact = normalized.replace(/\s+/g, " ").trim();
            if (/^(desativar|desativar modo|desligar|desligar modo|parar|parar modo|parar de ouvir)$/.test(compact)) {
                return "disable";
            }
            if (/^(lances legais|movimentos legais|listar lances|quais os lances|quais sao os lances)$/.test(compact)) {
                return "legal-moves";
            }
            if (/^(desistir|abandonar|resignar|render|me render)$/.test(compact)) {
                return "resign";
            }
            if (/^(cancelar|cancela)$/.test(compact)) {
                return "cancel";
            }
            return null;
        }

        confirmationValue(alternative) {
            const normalized = Core.normalizeSpeech(alternative?.transcript).replace(/\s+/g, " ").trim();
            if (/^(sim|confirmar|confirmo|pode|pode fazer|ok)$/.test(normalized)) {
                return true;
            }
            if (/^(nao|cancelar|cancela|negativo)$/.test(normalized)) {
                return false;
            }
            return null;
        }

        detectConfirmation(alternatives) {
            const decisions = new Set(
                alternatives
                    .map((alternative) => this.confirmationValue(alternative))
                    .filter((decision) => decision !== null),
            );
            if (decisions.size !== 1) {
                return null;
            }
            const decision = [...decisions][0];
            if (decision === true && this.confirmationValue(alternatives[0]) !== true) {
                return null;
            }
            return decision;
        }

        async handleAlternatives(alternatives) {
            if (!this.enabled) {
                return;
            }
            const generation = this.activationGeneration;

            if (this.pendingConfirmation) {
                const decision = this.detectConfirmation(alternatives);
                if (decision === null) {
                    await this.voice.speak("Diga sim para confirmar ou não para cancelar.", { resume: true });
                } else {
                    this.pendingConfirmation.finish(decision);
                }
                return;
            }

            const primaryCommand = this.detectCommand(alternatives[0]?.transcript || "");
            if (primaryCommand) {
                await this.executeCommand(primaryCommand, generation);
                return;
            }

            this.busy = true;
            try {
                const state = await this.bridge.getState();
                if (!this.isSessionCurrent(generation)) {
                    return;
                }
                this.assertUsableState(state);
                this.currentState = state;

                const matches = [];
                let ambiguousCandidates = [];
                for (const alternative of alternatives) {
                    const intent = Core.parseMoveIntent(alternative.transcript);
                    const result = Core.matchMoveIntent(intent, state.legalMoves);
                    if (result.status === "matched") {
                        matches.push(result.move);
                    } else if (result.status === "ambiguous") {
                        ambiguousCandidates = [...ambiguousCandidates, ...result.candidates];
                    }
                }

                const uniqueMatches = uniqueBy(matches, moveKey);
                if (uniqueMatches.length === 1 && !ambiguousCandidates.length) {
                    await this.confirmAndMakeMove(uniqueMatches[0], generation);
                    return;
                }

                if (uniqueMatches.length > 1 || ambiguousCandidates.length) {
                    const candidates = uniqueBy([...uniqueMatches, ...ambiguousCandidates], moveKey).slice(0, 4);
                    const descriptions = candidates.map((move) => Core.verbalizeMove(move)).join("; ou ");
                    await this.voice.speak(
                        `O lance ficou ambíguo entre ${descriptions}. Informe também a casa de origem.`,
                        { resume: true },
                    );
                    return;
                }

                if (this.isSessionCurrent(generation)) {
                    await this.voice.speak("Não encontrei um lance legal correspondente. Tente novamente.", { resume: true });
                }
            } catch (error) {
                if (this.isSessionCurrent(generation)) {
                    await this.voice.speak(`Não consegui processar o lance. ${safeErrorMessage(error)}.`, { resume: true });
                }
            } finally {
                this.busy = false;
                if (this.isSessionCurrent(generation)) {
                    await this.flushQueuedState();
                }
            }
        }

        async executeCommand(command, generation = this.activationGeneration) {
            const isCurrent = () => this.isSessionCurrent(generation);
            if (!isCurrent()) {
                return;
            }
            if (command === "disable") {
                await this.disable({ announce: true });
                return;
            }

            if (command === "cancel") {
                if (isCurrent()) {
                    await this.voice.speak("Não há uma ação pendente para cancelar.", { resume: true });
                }
                return;
            }

            if (command === "legal-moves") {
                try {
                    const state = await this.bridge.getState();
                    if (!isCurrent()) {
                        return;
                    }
                    this.assertUsableState(state);
                    if (!state.legalMoves.length) {
                        await this.voice.speak("Não há lances legais nesta posição.", { resume: true });
                        return;
                    }
                    const moves = state.legalMoves.slice(0, 12).map((move) => Core.verbalizeMove(move));
                    const suffix = state.legalMoves.length > moves.length
                        ? `. Há mais ${state.legalMoves.length - moves.length} lances.`
                        : "";
                    await this.voice.speak(`Lances legais: ${moves.join("; ")}${suffix}`, { resume: true });
                } catch (error) {
                    if (isCurrent()) {
                        await this.voice.speak(safeErrorMessage(error), { resume: true });
                    }
                }
                return;
            }

            if (command === "resign") {
                const confirmed = await this.askConfirmation({
                    title: "Confirmar desistência",
                    message: "Desistir encerra a partida imediatamente. Confirma a desistência?",
                    spoken: "Confirma desistir da partida?",
                    danger: true,
                    confirmLabel: "Desistir",
                    cancelLabel: "Continuar jogando",
                });
                if (!isCurrent()) {
                    return;
                }
                if (!confirmed) {
                    await this.voice.speak("Desistência cancelada.", { resume: true });
                    return;
                }
                const resignButton = this.findResignButton();
                if (!resignButton) {
                    await this.voice.speak("Não encontrei o botão de desistência nesta tela.", { resume: true });
                    return;
                }
                resignButton.click();
                await this.voice.speak("Comando de desistência enviado.", { resume: true });
            }
        }

        findResignButton() {
            const isUsable = (element) => {
                if (!element || element.disabled || element.getAttribute("aria-disabled") === "true") {
                    return false;
                }
                const rect = element.getBoundingClientRect();
                const style = globalThis.getComputedStyle(element);
                return rect.width > 0
                    && rect.height > 0
                    && style.visibility !== "hidden"
                    && style.display !== "none";
            };
            const direct = document.querySelector([
                '[aria-label="Desistir"]',
                '[aria-label="Resign"]',
                'button[data-cy="resign-button"]',
                'button[data-test-element="resign-button"]',
            ].join(","));
            if (isUsable(direct)) {
                return direct;
            }
            return [...document.querySelectorAll("button")].find((button) => {
                const label = `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`.trim();
                return /^(desistir|resign)$/i.test(label) && isUsable(button);
            }) || null;
        }

        askConfirmation({ title, message, spoken, danger = false, confirmLabel, cancelLabel }) {
            if (this.pendingConfirmation) {
                return Promise.resolve(false);
            }

            const dialogPromise = this.ui.showConfirmation({
                title,
                message,
                danger,
                confirmLabel,
                cancelLabel,
            });

            let finished = false;
            let externalResolve;
            const resultPromise = new Promise((resolve) => {
                externalResolve = resolve;
            });

            const finish = (value) => {
                if (finished) {
                    return;
                }
                finished = true;
                this.voice.stopRecognition(true);
                this.ui.closeDialog(value);
                this.pendingConfirmation = null;
                externalResolve(Boolean(value));
            };

            this.pendingConfirmation = { finish };
            dialogPromise.then(finish);

            this.voice.speak(spoken, { resume: false }).then(() => {
                if (!finished && this.enabled) {
                    this.voiceState = "confirming";
                    this.ui.setState("confirming");
                    this.voice.startListening();
                }
            });

            return resultPromise;
        }

        async confirmAndMakeMove(move, generation = this.activationGeneration) {
            const isCurrent = () => this.isSessionCurrent(generation);
            if (!isCurrent()) {
                return;
            }
            const description = Core.verbalizeMove(move);
            const confirmed = await this.askConfirmation({
                title: "Confirmar lance",
                message: `Confirma ${description}?`,
                spoken: `Confirma ${description}?`,
                confirmLabel: "Fazer lance",
                cancelLabel: "Cancelar",
            });

            if (!isCurrent()) {
                return;
            }
            if (!confirmed) {
                await this.voice.speak("Lance cancelado.", { resume: true });
                return;
            }

            const freshState = await this.bridge.getState();
            if (!isCurrent()) {
                return;
            }
            this.assertUsableState(freshState);
            const stillLegal = freshState.legalMoves.find((candidate) => moveKey(candidate) === moveKey(move));
            if (!stillLegal) {
                await this.voice.speak("A posição mudou e esse lance não é mais legal.", { resume: true });
                return;
            }

            const previousFen = freshState.fen;
            this.performPointerMove(stillLegal);
            if (stillLegal.promotion) {
                await this.choosePromotion(stillLegal);
            }

            const resultingState = await this.waitForMove(stillLegal, previousFen);
            if (!isCurrent()) {
                return;
            }
            if (!resultingState) {
                await this.voice.speak(
                    "O Chess.com não confirmou o movimento. Verifique se há uma confirmação adicional na tela.",
                    { resume: true },
                );
                return;
            }

            this.currentState = resultingState;
            this.lastAnnouncedMove = moveKey(resultingState.lastMove || stillLegal);
            this.updatePhraseHints(resultingState);
            await this.voice.speak(`Lance realizado: ${Core.verbalizeMove(resultingState.lastMove || stillLegal)}.`, { resume: true });
        }

        performPointerMove(move) {
            const board = document.querySelector(ACTIVE_BOARD_SELECTOR);
            if (!board || !move.from || !move.to) {
                throw new Error("O tabuleiro validado ou as coordenadas do lance não foram encontrados.");
            }

            const rect = board.getBoundingClientRect();
            if (!rect.width || !rect.height) {
                throw new Error("O tabuleiro não está visível.");
            }

            const flipped = board.classList.contains("flipped");
            const squareSize = rect.width / 8;
            const pointFor = (square) => {
                const file = square.charCodeAt(0) - 97;
                const rank = Number(square[1]) - 1;
                const visualFile = flipped ? 7 - file : file;
                const visualRank = flipped ? rank : 7 - rank;
                return {
                    clientX: rect.left + ((visualFile + 0.5) * squareSize),
                    clientY: rect.top + ((visualRank + 0.5) * squareSize),
                };
            };

            const source = pointFor(move.from);
            const destination = pointFor(move.to);
            const common = {
                bubbles: true,
                cancelable: true,
                composed: true,
                pointerId: 1,
                pointerType: "mouse",
                isPrimary: true,
                button: 0,
            };

            board.dispatchEvent(new PointerEvent("pointerdown", {
                ...common,
                ...source,
                buttons: 1,
            }));
            document.documentElement.dispatchEvent(new PointerEvent("pointerup", {
                ...common,
                ...destination,
                buttons: 0,
            }));
        }

        async choosePromotion(move) {
            const colorPrefix = move.color === 2 || move.color === "b" ? "b" : "w";
            const piece = String(move.promotion || "q").toLowerCase();
            const selector = `.promotion-piece.${colorPrefix}${piece}`;
            const board = document.querySelector(ACTIVE_BOARD_SELECTOR);
            const deadline = Date.now() + 1800;
            while (Date.now() < deadline) {
                const candidates = [
                    ...(board ? board.querySelectorAll(selector) : []),
                    ...document.querySelectorAll(selector),
                ];
                const option = candidates.find((element) => {
                    const rect = element.getBoundingClientRect();
                    const style = globalThis.getComputedStyle(element);
                    return rect.width > 0
                        && rect.height > 0
                        && style.display !== "none"
                        && style.visibility !== "hidden";
                });
                if (option) {
                    const rect = option.getBoundingClientRect();
                    const eventOptions = {
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        clientX: rect.left + (rect.width / 2),
                        clientY: rect.top + (rect.height / 2),
                        button: 0,
                        pointerId: 2,
                        pointerType: "mouse",
                        isPrimary: true,
                    };
                    option.dispatchEvent(new PointerEvent("pointerdown", { ...eventOptions, buttons: 1 }));
                    option.dispatchEvent(new MouseEvent("mousedown", { ...eventOptions, buttons: 1 }));
                    option.dispatchEvent(new PointerEvent("pointerup", { ...eventOptions, buttons: 0 }));
                    option.dispatchEvent(new MouseEvent("mouseup", { ...eventOptions, buttons: 0 }));
                    option.dispatchEvent(new MouseEvent("click", { ...eventOptions, buttons: 0 }));
                    return true;
                }
                await delay(50);
            }
            return false;
        }

        async waitForMove(move, previousFen) {
            const deadline = Date.now() + MOVE_TIMEOUT_MS;
            while (Date.now() < deadline) {
                await delay(100);
                try {
                    const state = await this.bridge.getState(700, { minimal: true });
                    const lastMove = state?.lastMove;
                    const exactLastMove = lastMove?.from === move.from
                        && lastMove?.to === move.to
                        && (!move.promotion || lastMove?.promotion === move.promotion || lastMove?.san?.includes(`=${String(move.promotion).toUpperCase()}`));
                    if (state?.fen && state.fen !== previousFen && exactLastMove) {
                        return state;
                    }
                } catch (_error) {
                    // Retry while the board finishes its transition.
                }
            }
            return null;
        }

        async flushQueuedState() {
            if (!this.queuedState || !this.enabled || this.pendingConfirmation) {
                return;
            }
            const state = this.queuedState;
            this.queuedState = null;
            await this.handleStateChanged(state);
        }
    }

    globalThis.FreedomChessApp = new FreedomChessApp();
})();
