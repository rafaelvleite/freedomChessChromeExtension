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
    const MISSING_BOARD_TOLERANCE = 3;
    // How long a recognizer may go silent after the utterance ended before the
    // session is declared hung.
    const STALL_TIMEOUT_MS = 3000;

    // Without a console channel the extension had no way to tell its own author
    // what it was doing. Warnings are always emitted; this only adds the
    // step-by-step trace: localStorage.freedomChessDebug = "1"
    const DEBUG = (() => {
        try {
            return globalThis.localStorage?.getItem?.("freedomChessDebug") === "1";
        } catch (_error) {
            return false;
        }
    })();

    // SpeechRecognitionPhrase is the newest and least stable part of the stack:
    // Chrome raised "phrases-not-supported" for online recognition even after
    // accepting the assignment. Contextual biasing is a nice-to-have, so it is
    // opt-in: localStorage.freedomChessPhraseHints = "1"
    const PHRASE_HINTS_ENABLED = (() => {
        try {
            return globalThis.localStorage?.getItem?.("freedomChessPhraseHints") === "1";
        } catch (_error) {
            return false;
        }
    })();

    function debug(...args) {
        if (DEBUG) {
            globalThis.console?.log?.("%c[FreedomChess]", "color:#81b64c;font-weight:bold", ...args);
        }
    }

    function warn(...args) {
        globalThis.console?.warn?.("[FreedomChess]", ...args);
    }

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
            this.statusTimer = null;
            this.ensureStatusRegion();
        }

        ensureStatusRegion() {
            let status = document.getElementById(STATUS_ID);
            if (!status) {
                status = document.createElement("div");
                status.id = STATUS_ID;
                status.className = "freedom-chess-status";
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
            debug("status:", message);
            window.clearTimeout(this.statusTimer);
            this.status.textContent = "";
            window.setTimeout(() => {
                if (this.status) {
                    this.status.textContent = message;
                    this.status.dataset.visible = "true";
                }
            }, 10);
            this.statusTimer = window.setTimeout(() => {
                if (this.status) {
                    this.status.dataset.visible = "false";
                }
            }, 6000);
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
        constructor({ onAlternatives, onFatalError, onState, onOutput, onLocalModeUnusable }) {
            this.onAlternatives = onAlternatives;
            this.onFatalError = onFatalError;
            this.onState = onState;
            this.onOutput = onOutput;
            this.onLocalModeUnusable = onLocalModeUnusable;
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
            this.stallTimer = null;
            this.sawSpeechThisSession = false;
            this.deliveredResultThisSession = false;
            this.stalledSessions = 0;
            this.primeVoices();
        }

        static getRecognitionConstructor() {
            return globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
        }

        setState(state) {
            this.onState?.(state);
        }

        clearStallWatchdog() {
            if (this.stallTimer) {
                window.clearTimeout(this.stallTimer);
                this.stallTimer = null;
            }
        }

        /**
         * Chrome's on-device recognizer can swallow an utterance whole: it fires
         * audiostart/soundstart/speechstart/speechend/audioend and then never
         * delivers a result, an error, or even `end`. The session hangs, so
         * `isRecognitionActive` stays true and every later startListening() is a
         * no-op — the extension goes permanently deaf after one sentence.
         */
        armStallWatchdog(recognition) {
            this.clearStallWatchdog();
            this.stallTimer = window.setTimeout(() => {
                this.stallTimer = null;
                if (recognition !== this.recognition || !this.enabled) {
                    return;
                }
                warn("sessão travada: fala capturada, nenhum resultado e nenhum fim de sessão");
                this.noteUnproductiveSession(recognition, { hung: true });
            }, STALL_TIMEOUT_MS);
        }

        restartWithFreshRecognizer() {
            this.createRecognition();
            this.wantsListening = true;
            this.startListening();
        }

        /**
         * Called when a session captured speech but produced no transcript,
         * either by hanging outright (`hung`) or by ending empty-handed.
         * Escalates one step at a time, cheapest first.
         */
        noteUnproductiveSession(recognition, { hung }) {
            this.stalledSessions += 1;
            this.clearStallWatchdog();
            // Consume the evidence. Aborting a hung session fires `end` on the
            // way out, which used to re-enter here and escalate a second time
            // for the very same utterance.
            this.sawSpeechThisSession = false;

            if (hung) {
                // A hung session never ends on its own, so it has to be replaced
                // rather than waited on.
                this.abortedRecognitions.add(recognition);
                try {
                    recognition.abort();
                } catch (_error) {
                    // A wedged recognizer may refuse to abort; the replacement
                    // below is what actually restores service.
                }
                this.isRecognitionActive = false;
                this.recognitionStartPending = false;
            }

            if (!this.enabled) {
                return;
            }

            // A single empty session is ordinary; a hang never is.
            const escalate = hung || this.stalledSessions >= 2;

            if (!escalate) {
                if (this.wantsListening) {
                    this.scheduleRestart();
                }
                return;
            }

            // Contextual phrase hints are progressive enhancement and the newest
            // moving part in the stack, so they are the first thing dropped —
            // but only when they were actually in play.
            if (PHRASE_HINTS_ENABLED && !this.phraseHintsDisabled) {
                warn("desligando as dicas contextuais e tentando de novo");
                this.phraseHintsDisabled = true;
                this.setState("preparing");
                this.restartWithFreshRecognizer();
                return;
            }

            // Online is the last thing left to try, and it costs a consent
            // dialog, so it comes last.
            if (this.localMode) {
                warn("o reconhecimento no dispositivo não transcreve; pedindo troca para online");
                this.onLocalModeUnusable?.();
                return;
            }

            // Seen in practice on a profile whose speech service had gone bad:
            // the audio pipeline kept working while every recognition session
            // hung, and a browser restart fixed it outright.
            this.fail(
                "O Chrome captura seu áudio mas nunca devolve a transcrição. Reinicie o navegador — "
                + "isso costuma resolver. Se voltar a acontecer, confira em chrome://settings/languages "
                + "se português (Brasil) está instalado.",
            );
        }

        useOnlineRecognition() {
            debug("trocando para reconhecimento online");
            this.localMode = false;
            // Hints stay off: if they were dropped because a session hung, the
            // new mode is not a reason to trust them again.
            this.stalledSessions = 0;
            this.clearStallWatchdog();
            this.createRecognition();
            // The caller announces the switch; speak({ resume: true }) is what
            // reopens the microphone, so starting it here would only race.
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
            this.stalledSessions = 0;
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

            debug("reconhecedor criado", {
                lang: recognition.lang,
                continuous: recognition.continuous,
                interimResults: recognition.interimResults,
                maxAlternatives: recognition.maxAlternatives,
                processLocally: "processLocally" in recognition ? recognition.processLocally : "não suportado",
                suportaPhrases: "phrases" in recognition,
                SpeechRecognitionPhrase: typeof globalThis.SpeechRecognitionPhrase,
            });

            // Full audio pipeline tracing. These events answer the only question
            // that matters when the microphone is open but nothing is recognized:
            // audiostart without soundstart  -> capturing silence (wrong input device)
            // soundstart without speechstart -> sound arrives but is not speech
            // speechstart without result     -> speech heard, transcription failed
            for (const eventName of ["audiostart", "soundstart", "speechstart", "speechend", "soundend", "audioend", "nomatch"]) {
                recognition.addEventListener?.(eventName, () => {
                    debug("evento de áudio:", eventName);

                    if (eventName === "speechstart") {
                        this.sawSpeechThisSession = true;
                    }

                    // Once the utterance is over, a working recognizer owes us a
                    // result, an error or `end` within a couple of seconds.
                    if ((eventName === "speechend" || eventName === "audioend") && this.sawSpeechThisSession) {
                        this.armStallWatchdog(recognition);
                    }
                });
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
                this.sawSpeechThisSession = false;
                this.deliveredResultThisSession = false;
                // A session that actually opens clears the backoff. Otherwise a
                // run of no-speech events pushed the restart delay to 4s of
                // dead microphone while the button still read "listening".
                this.restartAttempts = 0;
                this.setState("listening");
            };

            recognition.onresult = (event) => {
                debug("onresult", {
                    resultIndex: event.resultIndex,
                    total: event.results?.length,
                    reconhecedorAtual: recognition === this.recognition,
                    enabled: this.enabled,
                });
                if (recognition !== this.recognition || !this.enabled) {
                    warn("resultado descartado: reconhecedor superado ou desativado");
                    return;
                }

                const result = event.results[event.resultIndex];
                if (!result?.isFinal && result?.isFinal !== undefined) {
                    debug("resultado parcial ignorado");
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

                debug("alternativas reconhecidas:", alternatives);

                this.clearStallWatchdog();
                this.deliveredResultThisSession = true;
                this.stalledSessions = 0;
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
                debug("erro do reconhecedor:", code);
                this.clearStallWatchdog();
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
                debug("onend", {
                    reconhecedorAtual: recognition === this.recognition,
                    enabled: this.enabled,
                    wantsListening: this.wantsListening,
                    restartAttempts: this.restartAttempts,
                });
                if (recognition !== this.recognition) {
                    return;
                }
                this.clearStallWatchdog();
                const wasAborted = this.abortedRecognitions.has(recognition);
                this.abortedRecognitions.delete(recognition);
                this.recognitionStartPending = false;
                this.isRecognitionActive = false;

                // Speech went in, nothing came out. Ending cleanly is better
                // than hanging, but it is still a failure worth escalating.
                // A session we aborted ourselves does not count.
                if (this.enabled
                    && this.sawSpeechThisSession
                    && !this.deliveredResultThisSession
                    && !wasAborted) {
                    warn("sessão encerrada com fala capturada mas sem transcrição");
                    this.noteUnproductiveSession(recognition, { hung: false });
                    return;
                }

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
            if (!PHRASE_HINTS_ENABLED || this.phraseHintsDisabled || !this.recognition || !("phrases" in this.recognition)) {
                return;
            }
            const Phrase = globalThis.SpeechRecognitionPhrase;
            if (typeof Phrase !== "function") {
                return;
            }
            try {
                this.recognition.phrases = this.phraseHints.map((phrase) => new Phrase(phrase, 3));
                debug("dicas contextuais aplicadas:", this.phraseHints.length);
            } catch (error) {
                // Contextual biasing is progressive enhancement.
                warn("dicas contextuais recusadas:", safeErrorMessage(error));
            }
        }

        startListening() {
            if (!this.enabled || !this.recognition) {
                debug("startListening ignorado", { enabled: this.enabled, temReconhecedor: Boolean(this.recognition) });
                return;
            }
            this.wantsListening = true;
            if (this.isRecognitionActive || this.recognitionStartPending || this.restartTimer) {
                debug("startListening já em andamento", {
                    isRecognitionActive: this.isRecognitionActive,
                    recognitionStartPending: this.recognitionStartPending,
                    restartTimer: Boolean(this.restartTimer),
                });
                return;
            }
            this.applyPhraseHints();
            this.recognitionStartPending = true;
            debug("chamando recognition.start()");
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
            this.clearStallWatchdog();
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

        primeVoices() {
            const synthesis = globalThis.speechSynthesis;
            if (!synthesis?.getVoices) {
                return;
            }
            // Chrome fills the voice list asynchronously; the first call in a
            // fresh renderer usually returns []. Without this the very first
            // announcement — including "Modo Freedom ativo" — was always mute.
            synthesis.getVoices();
            synthesis.addEventListener?.("voiceschanged", () => {
                debug("voiceschanged", synthesis.getVoices().length, "vozes disponíveis");
            }, { once: true });
        }

        chooseVoice() {
            const voices = globalThis.speechSynthesis?.getVoices?.() || [];
            const isPortuguese = (voice) => Boolean(voice.lang?.toLowerCase().startsWith("pt"));
            // A local voice is preferred for privacy, but a remote Portuguese
            // voice beats silence. A non-Portuguese voice is never used: leaving
            // utterance.voice unset lets Chrome honour utterance.lang instead.
            return voices.find((voice) => voice.lang?.toLowerCase() === "pt-br" && voice.localService === true)
                || voices.find((voice) => isPortuguese(voice) && voice.localService === true)
                || voices.find((voice) => voice.lang?.toLowerCase() === "pt-br")
                || voices.find(isPortuguese)
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
            if (message && !voice) {
                debug("nenhuma voz pt disponível; usando utterance.lang para", message);
            }
            if (!message || !globalThis.speechSynthesis || !globalThis.SpeechSynthesisUtterance) {
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
                if (voice) {
                    utterance.voice = voice;
                }

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
                // Two-stage watchdog. If synthesis never even starts, give the
                // microphone back in two seconds instead of holding it closed
                // for the full estimated duration of speech that never happened.
                timeoutId = window.setTimeout(() => {
                    debug("síntese não iniciou em 2s; devolvendo o microfone");
                    finish(true);
                }, 2000);
                this.activeSpeechFinish = finish;

                utterance.onstart = () => {
                    window.clearTimeout(timeoutId);
                    timeoutId = window.setTimeout(
                        () => finish(true),
                        Math.min(Math.max(4000, message.length * 110), 15000),
                    );
                };
                utterance.onend = () => finish(false);
                utterance.onerror = () => finish(true);
                try {
                    // cancel() immediately followed by speak() in the same task
                    // makes Chromium drop the utterance. One tick apart is enough.
                    window.setTimeout(() => {
                        if (finished) {
                            return;
                        }
                        try {
                            globalThis.speechSynthesis.speak(utterance);
                        } catch (_error) {
                            finish(true);
                        }
                    }, 0);
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
            this.switchingRecognitionMode = false;
            this.boardMisses = 0;

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
                onLocalModeUnusable: () => this.handleLocalModeUnusable(),
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
                    this.boardMisses = 0;
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
                    // A single tick without a board is normal while Chess.com
                    // re-renders. Killing the session on the first miss shut the
                    // extension down mid-game without a word.
                    this.boardMisses = (this.boardMisses || 0) + 1;
                    if (this.boardMisses >= MISSING_BOARD_TOLERANCE) {
                        this.boardMisses = 0;
                        warn("tabuleiro ausente por", MISSING_BOARD_TOLERANCE, "verificações; desativando");
                        this.disable({
                            announce: true,
                            reason: "O tabuleiro saiu da tela. Modo Freedom desativado.",
                        });
                    }
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

                debug("ativando com reconhecimento", localMode ? "local (no dispositivo)" : "online (servidor do navegador)");
                this.voice.activate({ localMode });
                this.enabled = true;
                this.lastAnnouncedMove = moveKey(state.lastMove);
                this.voiceState = "speaking";
                this.ui.setEnabled(true, "speaking");
                this.updatePhraseHints(state);
                await sendRuntimeMessage({ type: "freedomChess:audio:state", enabled: true });
                if (!isCurrent() || !this.enabled) {
                    warn("ativação abortada após reservar o microfone; enabled =", this.enabled);
                    this.ui.announceStatus("A ativação foi interrompida. Clique novamente para tentar de novo.");
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

            // Availability is only a claim: it reported "available" on a profile
            // where recognition then hung forever until the browser restarted.
            debug("disponibilidade do pacote pt-BR local:", availability);

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

        /**
         * The on-device recognizer reported the pt-BR pack as available but is
         * not transcribing. Online recognition is the only remaining option, and
         * it sends audio to the browser vendor — so it needs consent, exactly
         * like the consent asked for at activation time.
         */
        async handleLocalModeUnusable() {
            if (this.switchingRecognitionMode || !this.enabled) {
                return;
            }
            this.switchingRecognitionMode = true;
            const generation = this.activationGeneration;

            try {
                this.voice.stopRecognition(true);
                this.ui.announceStatus("O reconhecimento local não devolveu nenhuma transcrição.");

                const useOnline = await this.ui.showConfirmation({
                    title: "O reconhecimento local não está funcionando",
                    message: "O Chrome capturou sua fala mas não devolveu nenhuma transcrição usando o pacote pt-BR no dispositivo. Deseja mudar para o reconhecimento online? Nesse modo o navegador pode enviar o áudio ao serviço de reconhecimento dele. Nenhuma API paga será usada.",
                    confirmLabel: "Usar online",
                    cancelLabel: "Desativar",
                });

                if (!this.isSessionCurrent(generation)) {
                    return;
                }

                if (!useOnline) {
                    await this.disable({
                        announce: true,
                        reason: "Modo Freedom desativado. O reconhecimento local não está transcrevendo neste dispositivo.",
                    });
                    return;
                }

                this.voice.useOnlineRecognition();
                await this.voice.speak("Mudando para reconhecimento online. Diga seu lance.", { resume: true });
            } finally {
                this.switchingRecognitionMode = false;
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
            // Hints must be what a player says ("cavalo f3"), not what the
            // synthesizer reads back ("Cavalo de gê um para efe três"). The old
            // form biased the recognizer away from every real command.
            const moves = (state?.legalMoves || []).flatMap((move) => Core.spokenMoveVariants(move));
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

                debug("transcrições", alternatives.map((alternative) => alternative.transcript));

                const matches = [];
                let ambiguousCandidates = [];
                for (const alternative of alternatives) {
                    const intent = Core.parseMoveIntent(alternative.transcript);
                    const result = Core.matchMoveIntent(intent, state.legalMoves);
                    debug("intenção", alternative.transcript, "->", intent.normalized, intent.reason || "", "=>", result.status);
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

                if (!this.isSessionCurrent(generation)) {
                    return;
                }

                const heard = alternatives[0]?.transcript || "";
                this.ui.announceStatus(
                    `Ouvi "${heard}" (interpretado como "${Core.normalizeSpeech(heard)}") — nenhum lance legal corresponde.`,
                );
                warn("nenhum lance legal para", alternatives.map((alternative) => alternative.transcript));

                // Exact matching alone has no graceful degradation: a single
                // misheard syllable used to fail outright. Offer the closest
                // legal move instead — never silently, always confirmed first.
                const suggestions = alternatives
                    .flatMap((alternative) => Core.rankMovesBySpeech(alternative.transcript, state.legalMoves, { limit: 1 }))
                    .sort((left, right) => right.score - left.score);
                const suggestion = suggestions[0];
                if (suggestion) {
                    debug("sugestão aproximada", Core.verbalizeMove(suggestion.move), suggestion.score);
                    await this.confirmAndMakeMove(suggestion.move, generation, { approximate: heard });
                    return;
                }

                await this.voice.speak(
                    `Não encontrei um lance legal para ${heard}. Tente novamente.`,
                    { resume: true },
                );
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

        async confirmAndMakeMove(move, generation = this.activationGeneration, { approximate = "" } = {}) {
            const isCurrent = () => this.isSessionCurrent(generation);
            if (!isCurrent()) {
                return;
            }
            const description = Core.verbalizeMove(move);
            const question = approximate
                ? `Não entendi "${approximate}" com certeza. Você quis dizer ${description}?`
                : `Confirma ${description}?`;
            const confirmed = await this.askConfirmation({
                title: approximate ? "Confirmar lance aproximado" : "Confirmar lance",
                message: question,
                spoken: question,
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
