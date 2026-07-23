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
    const HELP_ID = "freedom-chess-help";
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

    // Contextual biasing steers the on-device recognizer toward the legal moves
    // and the "confirma"/"muda" answers, which is the main lever against a
    // mishearing like "confirma" -> "comfirma". It was opt-in while online
    // recognition raised "phrases-not-supported"; on-device recognition (the
    // only mode now) supports it, and onerror still disables it gracefully if a
    // profile refuses. Opt OUT with localStorage.freedomChessPhraseHints = "0".
    const PHRASE_HINTS_ENABLED = (() => {
        try {
            return globalThis.localStorage?.getItem?.("freedomChessPhraseHints") !== "0";
        } catch (_error) {
            return true;
        }
    })();

    // A move recognised with AT LEAST this confidence, whose TOP alternative is
    // exactly that move, is played without asking. Anything below it — or a move
    // that only showed up as a secondary alternative, or one with no confidence
    // score at all — is confirmed by voice first. This is the "convicção alta"
    // fast path; the guard against the dropped-word bug ("Cavalo f3" heard as
    // "f3") is that a mishearing usually is NOT the confident top alternative.
    // The bar is deliberately HIGH: this recognizer sometimes hears one legal
    // move as another with full confidence ("e7 e5" -> "g7 g5"), so only a near
    // certain top guess is trusted to skip the "confirma ou muda" check.
    //   localStorage.freedomChessAutoplay = "off"  -> confirm every move
    //   localStorage.freedomChessAutoplay = "0.85" -> lower the bar
    const AUTOPLAY_CONFIDENCE = (() => {
        try {
            const raw = globalThis.localStorage?.getItem?.("freedomChessAutoplay");
            if (raw === "off") {
                return Infinity;
            }
            const value = Number(raw);
            return Number.isFinite(value) && value > 0 && value <= 1 ? value : 0.97;
        } catch (_error) {
            return 0.97;
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

    // A deliberately dumb fold, for yes/no answers only. Core.normalizeSpeech is
    // a CHESS normalizer: it deletes "faz " and "joga ", and rewrites "uma" to
    // "1". It must never be the thing that reads an answer.
    function speechWords(text) {
        return String(text || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .trim()
            .split(" ")
            .filter(Boolean);
    }

    // How people actually answer out loud. Matching whole sentences against
    // seven words is what made the player say "sim" four times in a row.
    const AFFIRMATIVE_WORDS = new Set([
        "sim", "confirma", "confirmar", "confirmo", "confirmado", "pode", "podes",
        "fazer", "faz", "faca", "manda", "mandar", "vai", "vamos", "joga", "jogar",
        "jogue", "isso", "isto", "positivo", "certo", "correto", "certeza", "exato",
        "exatamente", "afirmativo", "claro", "beleza", "blz", "ok", "okay", "oquei",
        "ta", "aham", "uhum", "perfeito", "bora",
    ]);

    // "muda" / "mudar" is the word the player is told to say to reject a move
    // and dictate a different one; the rest are ordinary refusals.
    const NEGATIVE_WORDS = new Set([
        "muda", "mudar", "mude", "mudo", "troca", "trocar", "troco", "outro", "outra",
        "nao", "nada", "cancela", "cancelar", "cancele", "cancelado", "negativo",
        "errado", "erro", "espera", "espere", "esquece", "esquecer", "nunca",
        "jamais", "deixa",
    ]);

    // Only a refusal when it is the WHOLE answer: "para" is also the connector
    // in "torre a1 para a8".
    const NEGATIVE_ALONE_WORDS = new Set(["para", "pare", "parar", "pera", "perai", "chega"]);

    // What pt-BR recognition returns for a short, sharp "sim". Accepted only as
    // a whole answer: "cem" inside a longer phrase is a number.
    const AFFIRMATIVE_HOMOPHONES = new Set(["cem", "sem", "si", "assim", "sin"]);

    // Carry no decision of their own; dropped before an answer is classified.
    const ANSWER_FILLER_WORDS = new Set([
        "e", "eh", "ah", "oh", "ai", "la", "ali", "entao", "mesmo", "bom", "bem",
        "com", "por", "favor", "ver", "ser", "so", "ja", "agora", "pra", "pro",
        "tudo", "que", "o", "a",
    ]);

    // The recognizer mangles even the two words it is told to expect: "confirma"
    // comes back as "comfirma"/"confia", "muda" as "mula"/"muta". Exact-set
    // matching alone made the player repeat the answer several times. So an
    // answer word also counts if it starts with a distinctive stem, or is a
    // near-miss (small edit distance) of a canonical answer word.
    const AFFIRMATIVE_STEMS = ["confirm", "afirmativ", "positiv"];
    const NEGATIVE_STEMS = ["mud", "troc", "cancel", "negativ", "outr"];
    const AFFIRMATIVE_CANON = ["confirma", "confirmo", "confirmar", "positivo", "afirmativo"];
    const NEGATIVE_CANON = ["muda", "mudar", "troca", "cancela", "negativo", "outro"];

    function editDistance(a, b) {
        if (a === b) { return 0; }
        if (!a.length) { return b.length; }
        if (!b.length) { return a.length; }
        let previous = [];
        for (let column = 0; column <= b.length; column += 1) { previous[column] = column; }
        for (let row = 1; row <= a.length; row += 1) {
            const current = [row];
            for (let column = 1; column <= b.length; column += 1) {
                const cost = a.charAt(row - 1) === b.charAt(column - 1) ? 0 : 1;
                current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + cost);
            }
            previous = current;
        }
        return previous[b.length];
    }

    function nearAnyWord(word, targets) {
        // One edit for a short word, two for a longer one. Short words share too
        // many neighbours to allow two edits without false matches.
        const tolerance = word.length <= 4 ? 1 : 2;
        return targets.some((target) => editDistance(word, target) <= tolerance);
    }

    /**
     * Classifies one spoken word as "yes", "no", or null. EXACT membership and
     * stems always win over fuzzy: "manda" is an affirmative even though it is
     * two edits from "muda", so a fuzzy negative must never override it. Fuzzy
     * is the last resort, and only for confirming when the word is long enough
     * that a near-miss cannot be some unrelated word.
     */
    function classifyAnswerWord(word) {
        const affirmative = AFFIRMATIVE_WORDS.has(word)
            || AFFIRMATIVE_STEMS.some((stem) => word.startsWith(stem));
        const negative = NEGATIVE_WORDS.has(word)
            || NEGATIVE_STEMS.some((stem) => word.startsWith(stem));
        if (affirmative !== negative) {
            return affirmative ? "yes" : "no";
        }
        if (affirmative && negative) {
            return null;
        }

        const negativeFuzzy = nearAnyWord(word, NEGATIVE_CANON);
        const affirmativeFuzzy = word.length >= 6 && nearAnyWord(word, AFFIRMATIVE_CANON);
        if (affirmativeFuzzy !== negativeFuzzy) {
            return affirmativeFuzzy ? "yes" : "no";
        }
        return null;
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
            this.help = null;
            this.dialog = null;
            this.dialogBody = null;
            this.dialogHint = null;
            this.dialogResolver = null;
            this.dialogPreviousFocus = null;
            this.dialogKeyHandler = null;
            this.statusTimer = null;
            // announceStatus() defers its text by one tick to re-trigger the live
            // region. That handle was never kept, so a reveal already in flight
            // could not be cancelled — the pill popped back up under the panel,
            // and two announcements less than 10ms apart left the STALE one
            // pending, which then overwrote the new text in the aria-live region.
            this.statusShowTimer = null;
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

        // A persistent, off-board how-to card. It sits in the bottom-right
        // corner (over the sidebar, never the board) and is only shown while the
        // mode is active, so a first-time player sees the exact phrasing.
        ensureHelpCard() {
            if (this.help) {
                return;
            }
            const help = document.createElement("div");
            help.id = HELP_ID;
            help.className = "freedom-chess-help";
            help.setAttribute("role", "note");
            help.hidden = true;
            help.innerHTML = [
                '<strong class="freedom-chess-help-title">Como falar o lance</strong>',
                '<span>Casa de origem e casa de destino: <b>e2 e4</b>, <b>g1 f3</b>.</span>',
                '<span>Se ele errar a coluna, use o nome: <b>estrela quatro</b> = coluna e.</span>',
                '<span>Roque: <b>roque</b> ou <b>roque grande</b>. Promoção: diga a peça.</span>',
                '<span>Depois de cada lance: <b>confirma</b> ou <b>muda</b>.</span>',
            ].join("");
            (document.body || document.documentElement).append(help);
            this.help = help;
        }

        setEnabled(enabled, state = enabled ? "listening" : "disabled") {
            this.ensureHelpCard();
            if (this.help) {
                this.help.hidden = !enabled;
            }
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
            const text = String(message ?? "");

            window.clearTimeout(this.statusTimer);
            window.clearTimeout(this.statusShowTimer);

            /*
             * The pill sits bottom-left and the panel now runs along the same
             * bottom edge, so only one of them may speak at a time. While a
             * panel is mounted it takes the status line.
             *
             * `isConnected` rather than a bare null check: if a teardown were
             * ever missed, the text must degrade to the pill, never into a node
             * that was removed from the document.
             */
            if (this.dialogHint?.isConnected) {
                if (this.status) {
                    this.status.dataset.visible = "false";
                }
                // askConfirmation feeds the dialog's own body text through
                // speak({ display }), which lands right here. Echoing it under
                // the question is noise; only genuinely new lines are kept.
                const duplicate = text === (this.dialogBody?.textContent || "");
                this.dialogHint.textContent = duplicate ? "" : text;
                return;
            }

            this.status.textContent = "";
            this.statusShowTimer = window.setTimeout(() => {
                this.statusShowTimer = null;
                if (this.status) {
                    this.status.textContent = text;
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
            /*
             * alertdialog stays: it carries the accessible name and description
             * and is announced when focus lands inside.
             *
             * aria-modal goes, and not as attribute tidying. It tells assistive
             * tech to hide everything outside this element. The board is now
             * visible and clickable, so keeping it would mean a sighted user
             * could click a square while a screen-reader user was told the board
             * no longer exists — exactly while they need it to answer. It also
             * hid the role="status" pill, a sibling of this overlay, from AT.
             */
            dialog.setAttribute("role", "alertdialog");
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

            // Live region for status text that arrives while a dialog is open
            // (the rare resign / download prompts — move confirmation is
            // voice-only and opens no dialog). It belongs next to the question,
            // not in a pill competing for the same corner of the screen. It is
            // never toggled with `hidden`: a display:none live region is out of
            // the accessibility tree and would not be announced. CSS hides it
            // with :empty instead.
            const hint = document.createElement("p");
            hint.id = `${DIALOG_ID}-hint`;
            hint.className = "freedom-chess-dialog-hint";
            hint.setAttribute("role", "status");
            hint.setAttribute("aria-live", "polite");

            dialog.append(heading, body, hint, actions);
            overlay.append(dialog);
            (document.body || document.documentElement).append(overlay);
            this.dialog = overlay;
            this.dialogBody = body;
            this.dialogHint = hint;

            // Park the pill for the life of the panel. Clearing the 10ms reveal
            // matters: enable()'s error path announces and THEN opens a dialog
            // in the same task, so an unparked reveal would fire on top of the
            // panel a moment later.
            window.clearTimeout(this.statusTimer);
            window.clearTimeout(this.statusShowTimer);
            this.statusTimer = null;
            this.statusShowTimer = null;
            if (this.status) {
                this.status.dataset.visible = "false";
            }

            /*
             * The Tab wrap-around trap is gone on purpose. A hard trap in a
             * panel that is deliberately non-modal would mean a keyboard user
             * could never reach the board while a question is pending — the very
             * thing this layout exists to fix.
             *
             * Escape therefore has to work from outside the panel too, so the
             * listener lives on the document in the capture phase rather than on
             * the overlay. stopPropagation preserves today's behaviour of not
             * leaking Escape into Chess.com. It is attached only while a panel
             * is mounted, and closeDialog() detaches it.
             */
            this.dialogKeyHandler = (event) => {
                if (!this.dialog || event.key !== "Escape") {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                this.closeDialog(false);
            };
            document.addEventListener("keydown", this.dialogKeyHandler, true);

            const promise = new Promise((resolve) => {
                this.dialogResolver = resolve;
            });

            window.setTimeout(() => (danger && cancelButton ? cancelButton : confirmButton).focus(), 0);
            return promise;
        }

        closeDialog(value = false) {
            const resolver = this.dialogResolver;
            const previousFocus = this.dialogPreviousFocus;
            // Only reclaim focus if it is still inside the panel being removed.
            // The board is reachable now, so a player who deliberately tabbed to
            // a square must not have focus yanked back out of it.
            const hadFocusInside = Boolean(this.dialog?.contains(document.activeElement));
            if (this.dialogKeyHandler) {
                document.removeEventListener("keydown", this.dialogKeyHandler, true);
            }
            this.dialogResolver = null;
            this.dialogPreviousFocus = null;
            this.dialogKeyHandler = null;
            this.dialog?.remove();
            this.dialog = null;
            // Must be released, or every later announceStatus() writes into a
            // node that is no longer in the document and the pill goes mute for
            // the rest of the page's life — disable() and handleFatalVoiceError
            // both announce AFTER closing a dialog.
            this.dialogBody = null;
            this.dialogHint = null;
            if (hadFocusInside && previousFocus?.isConnected && typeof previousFocus.focus === "function") {
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
            // Recognition is on-device only. There is no online/cloud fallback
            // and no mid-session mode switching: a recognizer that hears nothing
            // (the player thinking) or hangs is quietly retried, never announced.
            this.localMode = true;
            this.hungSessions = 0;
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
                // A silent player who made a little noise looks exactly like
                // this, so it is routine, not a warning worth the Errors panel.
                debug("sessão sem transcrição (travada); recriando o reconhecedor");
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
         * either by ending empty-handed or by hanging outright (`hung`).
         *
         * There is NO escalation to online recognition and NOTHING is spoken:
         * a player who is thinking, or a bit of background noise, must never
         * make the extension start talking or switch how it listens. An empty
         * session just restarts. A hang replaces the wedged recognizer quietly.
         * Only a recognizer that hangs over and over — never a silent player,
         * which produces empty sessions, not hangs — is a real fault worth a
         * one-time notice.
         */
        noteUnproductiveSession(recognition, { hung }) {
            this.stalledSessions += 1;
            this.clearStallWatchdog();
            // Consume the evidence. Aborting a hung session fires `end` on the
            // way out, which used to re-enter here for the very same utterance.
            this.sawSpeechThisSession = false;

            if (!hung) {
                // Ordinary: the microphone opened and heard nothing usable.
                if (this.enabled && this.wantsListening) {
                    this.scheduleRestart();
                }
                return;
            }

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

            if (!this.enabled) {
                return;
            }

            this.hungSessions += 1;

            // A run of hangs means the speech service itself is broken, not that
            // the player went quiet. Seen in practice on a profile whose service
            // had gone bad: every session hung and a browser restart fixed it.
            if (this.hungSessions >= 4) {
                this.fail(
                    "O reconhecimento de voz no dispositivo parou de responder. Reinicie o navegador — "
                    + "isso costuma resolver. Se voltar a acontecer, confira em chrome://settings/languages "
                    + "se português (Brasil) está instalado.",
                );
                return;
            }

            this.restartWithFreshRecognizer();
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
            this.hungSessions = 0;
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
                // A real transcript proves the recognizer works, so isolated
                // hangs earlier in the game must not accumulate toward fail().
                this.hungSessions = 0;
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

                // Speech went in, nothing came out. This is what a player
                // thinking out loud, or background noise, produces — routine,
                // and handled by a quiet restart, not a warning worth surfacing
                // in the Errors panel. A session we aborted ourselves does not
                // count.
                if (this.enabled
                    && this.sawSpeechThisSession
                    && !this.deliveredResultThisSession
                    && !wasAborted) {
                    debug("sessão encerrada sem transcrição; ouvindo de novo");
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
                // Contextual biasing is progressive enhancement, not an error.
                debug("dicas contextuais recusadas:", safeErrorMessage(error));
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

        speak(text, { resume = true, allowWhenDisabled = false, display } = {}) {
            const message = String(text || "").trim();
            if (!this.enabled && !allowWhenDisabled) {
                return Promise.resolve();
            }
            if (message) {
                // The status pill and the console show what a human reads;
                // `message` keeps the spelled-out squares the synthesizer needs.
                this.onOutput?.(String(display ?? message).trim() || message);
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

                // Resolves to true on success, null if superseded, or throws
                // with an actionable message. There is no online mode.
                const ready = await this.prepareRecognitionMode(isCurrent);
                if (!isCurrent() || ready === null) {
                    return;
                }

                const claim = await sendRuntimeMessage({ type: "freedomChess:audio:claim" });
                if (!isCurrent()) {
                    return;
                }
                if (!claim?.ok) {
                    throw new Error(claim?.error || "Não foi possível reservar o microfone para esta aba.");
                }

                debug("ativando com reconhecimento de voz no dispositivo");
                this.voice.activate({ localMode: true });
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
                    "Modo Freedom ativo. Diga o lance como casa de origem e casa de destino. "
                    + "Por exemplo, e2 e4. Para promover um peão, diga também a peça.",
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

        /**
         * Recognition is on-device only. There is no online/cloud fallback: if
         * the browser cannot recognise pt-BR locally, activation fails with a
         * clear one-time message instead of quietly sending audio off-device.
         * Always returns `true` (local) when it succeeds, `null` when the
         * activation was superseded, and throws with an actionable message when
         * local recognition genuinely is not available.
         */
        async prepareRecognitionMode(isCurrent = () => true) {
            const Recognition = VoiceController.getRecognitionConstructor();
            if (!Recognition) {
                throw new Error("O navegador não oferece a Web Speech API.");
            }

            const supportsLocal = typeof Recognition.available === "function"
                && typeof Recognition.install === "function"
                && "processLocally" in new Recognition();

            if (!supportsLocal) {
                throw new Error("Este navegador não oferece reconhecimento de voz no dispositivo. Use o Chrome mais recente no computador.");
            }

            let availability;
            try {
                availability = await this.callAvailability(Recognition, true);
            } catch (error) {
                if (!isCurrent()) {
                    return null;
                }
                throw new Error(`Não foi possível consultar o pacote de voz local: ${safeErrorMessage(error)}.`);
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
                if (!isCurrent()) {
                    return null;
                }
                if (!install) {
                    // Respect the refusal, but never end an activation in
                    // silence — that is a click that appears to do nothing.
                    this.ui.announceStatus("Ativação cancelada: o pacote de voz não foi baixado.");
                    return null;
                }

                this.ui.setState("preparing");
                this.voiceState = "preparing";
                let installed = false;
                let installFailure = "A instalação do pacote de voz falhou.";
                try {
                    installed = await this.installLanguagePack(Recognition);
                } catch (error) {
                    installFailure = `A instalação do pacote de voz falhou: ${safeErrorMessage(error)}.`;
                }
                if (!isCurrent()) {
                    return null;
                }
                if (installed) {
                    return true;
                }

                throw new Error(installFailure);
            }

            throw new Error("Não há um pacote de voz pt-BR disponível para este dispositivo.");
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
                "confirma",
                "confirmar",
                "muda",
                "mudar",
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
            await this.voice.speak(`Lance realizado: ${Core.verbalizeMove(state.lastMove)}.`, {
                resume: true,
                display: `Lance realizado: ${Core.verbalizeMove(state.lastMove, { plain: true })}.`,
            });
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

        /**
         * Asymmetric on purpose: a "yes" plays an irreversible move, a "no"
         * costs one repetition.
         *
         * NO wins whenever a refusal word appears anywhere ("não pode",
         * "cancela isso", "não é isso"). YES requires the whole utterance to be
         * made of affirmatives, which is also what stops a restated move from
         * being read as agreement — "faz torre a1 a8" and "cavalo f3 vai"
         * contain an affirmative but are not answers.
         */
        confirmationValue(alternative) {
            const raw = speechWords(alternative?.transcript);
            if (!raw.length) {
                return null;
            }
            if (raw.length === 1 && NEGATIVE_ALONE_WORDS.has(raw[0])) {
                return false;
            }
            const labels = raw.map((word) => classifyAnswerWord(word));
            if (labels.includes("no")) {
                return false;
            }
            // "cem" alone is a snapped "sim"; inside a phrase it is a number.
            if (raw.length === 1 && AFFIRMATIVE_HOMOPHONES.has(raw[0])) {
                return true;
            }
            const meaningful = raw.filter((word) => !ANSWER_FILLER_WORDS.has(word));
            if (!meaningful.length) {
                return null;
            }
            return meaningful.every((word) => classifyAnswerWord(word) === "yes") ? true : null;
        }

        detectConfirmation(alternatives) {
            const decisions = new Set(
                (alternatives || [])
                    .map((alternative) => this.confirmationValue(alternative))
                    .filter((decision) => decision !== null),
            );
            if (decisions.size !== 1) {
                return null;
            }
            // The old rule additionally required alternatives[0] to be
            // affirmative. That rule WAS the reported bug: pt-BR recognition
            // routinely ranks "cem" ahead of "sim", so a perfectly clear answer
            // was thrown away and the player said it again, and again. What
            // protects the player is that a yes must be uncontradicted across
            // all five alternatives and must be a whole answer — not that it
            // happened to rank first.
            return [...decisions][0];
        }

        async handleAlternatives(alternatives) {
            if (!this.enabled) {
                return;
            }
            const generation = this.activationGeneration;

            if (this.pendingConfirmation) {
                const decision = this.detectConfirmation(alternatives);
                if (decision !== null) {
                    this.pendingConfirmation.finish(decision);
                    return;
                }
                // Re-prompting forever is how a player ends up shouting at the
                // screen. Three unreadable answers cancel, which is the safe
                // outcome: the move is simply not played and the microphone
                // goes back to listening for a fresh command.
                this.pendingConfirmation.misses = (this.pendingConfirmation.misses || 0) + 1;
                if (this.pendingConfirmation.misses >= 3) {
                    this.pendingConfirmation.finish(false);
                    return;
                }
                await this.voice.speak("Diga confirma ou muda.", { resume: true });
                return;
            }

            const primaryCommand = this.detectCommand(alternatives[0]?.transcript || "");
            if (primaryCommand) {
                await this.executeCommand(primaryCommand, generation);
                return;
            }

            /*
             * The confirmation dialog was what serialized moves. With an exact
             * match played immediately, `busy` is the only "a move is on the
             * board" signal — and it is already the one handleStateChanged and
             * flushQueuedState read, so there is exactly one source of truth.
             * Placed below command detection so "desativar" still gets through
             * while a move is in flight.
             *
             * announceStatus rather than speak(): speak() would cancel the
             * in-flight move's own announcement and reopen the microphone over
             * our own voice. This branch cannot strand the recognizer — a
             * transcript only arrives if the microphone was open, and the move
             * already in flight ends with speak({ resume: true }).
             */
            if (this.busy) {
                this.ui.announceStatus("Ainda estou executando o lance anterior.");
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
                // The TOP alternative's own match and confidence decide whether
                // this move is trusted enough to play without asking.
                let topMove = null;
                let topConfidence = null;
                alternatives.forEach((alternative, index) => {
                    const intent = Core.parseMoveIntent(alternative.transcript);
                    const result = Core.matchMoveIntent(intent, state.legalMoves);
                    debug("intenção", alternative.transcript, "->", intent.normalized, intent.reason || "", "=>", result.status);
                    if (result.status === "matched") {
                        matches.push(result.move);
                        if (index === 0) { topMove = result.move; }
                    } else if (result.status === "ambiguous") {
                        ambiguousCandidates = [...ambiguousCandidates, ...result.candidates];
                    }
                    if (index === 0) {
                        topConfidence = typeof alternative.confidence === "number" ? alternative.confidence : null;
                    }
                });

                /*
                 * An exact, unique match is played straight away only when the
                 * recognizer was confident AND that move was its top guess. Any
                 * doubt — a lower confidence, no confidence score, or a move that
                 * only appeared as a secondary alternative — falls back to a
                 * voice confirmation, because the recognizer can DROP a word and
                 * still land on a legal move ("Cavalo f3" heard as "f3" plays the
                 * pawn), and only a confident top guess is unlikely to be that.
                 *
                 * A promotion cannot reach here without its piece named.
                 * Core.matchMoveIntent refuses to guess one: with the four
                 * promotion moves Chess.com emits it returns "ambiguous", which
                 * the `!ambiguousCandidates.length` guard below already excludes.
                 */
                const uniqueMatches = uniqueBy(matches, moveKey);
                if (uniqueMatches.length === 1 && !ambiguousCandidates.length) {
                    const winner = uniqueMatches[0];
                    const topIsWinner = topMove && moveKey(topMove) === moveKey(winner);
                    const confident = Boolean(topIsWinner)
                        && topConfidence !== null
                        && topConfidence >= AUTOPLAY_CONFIDENCE;
                    debug("convicção do lance", { confident, topConfidence, limiar: AUTOPLAY_CONFIDENCE });
                    if (confident) {
                        await this.executeMove(winner, generation);
                    } else {
                        await this.confirmAndMakeMove(winner, generation);
                    }
                    return;
                }

                if (uniqueMatches.length > 1 || ambiguousCandidates.length) {
                    const candidates = uniqueBy([...uniqueMatches, ...ambiguousCandidates], moveKey).slice(0, 4);
                    const describe = (options) =>
                        candidates.map((move) => Core.verbalizeMove(move, options)).join("; ou ");
                    // An unnamed promotion arrives here as four candidates that
                    // share from/to and differ only in the promoted piece.
                    // Telling that player to state the origin square is advice
                    // that cannot possibly disambiguate, so they loop forever.
                    const onlyPromotionDiffers = candidates.length > 1
                        && candidates.every((move) => move.from === candidates[0].from
                            && move.to === candidates[0].to
                            && Boolean(Core.movePromotion(move)));
                    const advice = onlyPromotionDiffers
                        ? "Diga também a peça da promoção."
                        : "Informe também a casa de origem.";
                    await this.voice.speak(
                        `O lance ficou ambíguo entre ${describe()}. ${advice}`,
                        {
                            resume: true,
                            display: `O lance ficou ambíguo entre ${describe({ plain: true })}. ${advice}`,
                        },
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
                // The player already gets the announceStatus above, so a missed
                // move is not an error worth surfacing in the Errors panel.
                debug("nenhum lance legal para", alternatives.map((alternative) => alternative.transcript));

                // When the microphone opens late it clips the file letter and
                // returns just the rank ("e4" -> "quatro"). A bare rank matches
                // EVERY file's pawn on that rank equally, so the fuzzy rescue
                // would pick one at random ("quatro" -> a4). That is a phantom,
                // not a suggestion: drop any alternative that carries no column.
                const namesAColumn = (transcript) => {
                    const compact = Core.normalizeSpeech(transcript).replace(/\s+/g, "");
                    return Boolean(compact) && !/^\d+$/.test(compact);
                };
                const heardOnlyRank = alternatives.length > 0
                    && !alternatives.some((alternative) => namesAColumn(alternative.transcript));
                if (heardOnlyRank) {
                    await this.voice.speak(
                        "Ouvi só a fileira, não a coluna. Diga a coluna e a fileira — por exemplo, "
                        + "peão e quatro, ou estrela quatro para a coluna e.",
                        { resume: true },
                    );
                    return;
                }

                // Exact matching alone has no graceful degradation: a single
                // misheard syllable used to fail outright. Offer the closest
                // legal move instead — never silently, always confirmed first.
                const suggestions = alternatives
                    .filter((alternative) => namesAColumn(alternative.transcript))
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
                    const listed = state.legalMoves.slice(0, 12);
                    const moves = listed.map((move) => Core.verbalizeMove(move));
                    const plainMoves = listed.map((move) => Core.verbalizeMove(move, { plain: true }));
                    const suffix = state.legalMoves.length > moves.length
                        ? `. Há mais ${state.legalMoves.length - moves.length} lances.`
                        : "";
                    await this.voice.speak(`Lances legais: ${moves.join("; ")}${suffix}`, {
                        resume: true,
                        display: `Lances legais: ${plainMoves.join("; ")}${suffix}`,
                    });
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

            this.pendingConfirmation = { finish, misses: 0 };
            dialogPromise.then(finish);

            this.voice.speak(spoken, { resume: false, display: message }).then(() => {
                if (!finished && this.enabled) {
                    this.voiceState = "confirming";
                    this.ui.setState("confirming");
                    this.voice.startListening();
                }
            });

            return resultPromise;
        }

        /**
         * Every move is confirmed by voice before it is played, because the
         * recognizer can drop a word and still land on a legal move ("Cavalo
         * f3" heard as "f3" would otherwise play the pawn). `approximate` is set
         * when the move came from the fuzzy rescue rather than an exact match.
         */
        async confirmAndMakeMove(move, generation = this.activationGeneration, { approximate = "" } = {}) {
            const isCurrent = () => this.isSessionCurrent(generation);
            if (!isCurrent()) {
                return;
            }
            // Confirmation is voice-only: no panel is ever placed in front of
            // the board. The player hears the move read back and says "confirma"
            // to play it or "muda" to reject it and dictate another. Spoken form
            // keeps the letter names the synthesizer pronounces ("é sete");
            // the status pill gets real algebraic squares ("e7").
            const spelled = Core.verbalizeMove(move);
            const written = Core.verbalizeMove(move, { plain: true });
            const spoken = approximate
                ? `Acho que você disse ${spelled}. Confirma ou muda?`
                : `${spelled}. Confirma ou muda?`;
            const display = approximate
                ? `Entendi ${written}. Diga "confirma" ou "muda".`
                : `${written}. Diga "confirma" ou "muda".`;

            const confirmed = await this.askVoiceConfirmation({ spoken, display });

            if (!isCurrent()) {
                return;
            }
            if (!confirmed) {
                await this.voice.speak("Diga o lance.", { resume: true });
                return;
            }

            await this.executeMove(move, generation);
        }

        /**
         * Voice-only confirmation. Unlike askConfirmation() it opens NO dialog
         * and draws nothing over the board: it speaks the question, then listens
         * for a "confirma"/"muda" answer routed through handleAlternatives, and
         * resolves true or false. Any status text lands in the corner pill, not
         * on the board.
         */
        askVoiceConfirmation({ spoken, display }) {
            if (this.pendingConfirmation) {
                return Promise.resolve(false);
            }

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
                this.pendingConfirmation = null;
                externalResolve(Boolean(value));
            };

            this.pendingConfirmation = { finish, misses: 0 };

            this.voice.speak(spoken, { resume: false, display }).then(() => {
                if (!finished && this.enabled) {
                    this.voiceState = "confirming";
                    this.ui.setState("confirming");
                    this.voice.startListening();
                }
            });

            return resultPromise;
        }

        /**
         * The execution half, shared by the confirmed and the immediate paths:
         * re-read the position, prove the move is still legal, play it, click
         * the promotion piece the player named, announce the result. Nothing
         * here asks a question, so it must never be reached with a move the
         * player did not fully specify — see the promotion guard in
         * Core.matchMoveIntent.
         *
         * `this.busy` is owned by handleAlternatives and spans this whole
         * method, which is what keeps handleStateChanged from announcing the
         * opponent's reply in the middle of a pointer move.
         */
        async executeMove(move, generation = this.activationGeneration) {
            const isCurrent = () => this.isSessionCurrent(generation);
            if (!isCurrent()) {
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

            // The only echo before the board moves, and deliberately written
            // rather than spoken: speak() shuts the microphone and resolves only
            // at the end of the utterance, so an awaited spoken acknowledgement
            // would add a full second to every move — the exact cost this change
            // exists to remove. waitForMove normally lands in 200-400ms and the
            // spoken "Seu lance" below is the real acknowledgement. It still
            // reaches a screen reader instantly, via the role="status" region.
            this.ui.announceStatus(`Executando ${Core.verbalizeMove(stillLegal, { plain: true })}.`);

            const previousFen = freshState.fen;
            // Chess.com's verbose moves do not always carry a `promotion`
            // field; the SAN suffix is then the only evidence. Core matches on
            // both, so the executor has to click on both — otherwise a spoken
            // "=N" silently promoted to a queen, which no one confirms now.
            const promotion = Core.movePromotion(stillLegal);
            this.performPointerMove(stillLegal);
            if (promotion) {
                await this.choosePromotion(stillLegal, promotion);
            }

            const resultingState = await this.waitForMove(stillLegal, previousFen);
            if (!isCurrent()) {
                return;
            }
            if (!resultingState) {
                // The one outcome where the player would otherwise never learn
                // what the extension understood, so it names the move.
                await this.voice.speak(
                    `Não consegui completar ${Core.verbalizeMove(stillLegal)}. O Chess.com não confirmou o movimento. `
                    + "Verifique se há uma confirmação adicional na tela.",
                    {
                        resume: true,
                        display: `Não consegui completar ${Core.verbalizeMove(stillLegal, { plain: true })}. `
                            + "O Chess.com não confirmou o movimento.",
                    },
                );
                return;
            }

            this.currentState = resultingState;
            this.lastAnnouncedMove = moveKey(resultingState.lastMove || stillLegal);
            this.updatePhraseHints(resultingState);
            const played = resultingState.lastMove || stillLegal;
            // "Seu lance" rather than "Lance realizado": with the question gone,
            // the player's own move and the opponent's reply would otherwise be
            // the same sentence twice in a row.
            await this.voice.speak(`Seu lance: ${Core.verbalizeMove(played)}.`, {
                resume: true,
                display: `Seu lance: ${Core.verbalizeMove(played, { plain: true })}.`,
            });
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

        async choosePromotion(move, promotion = Core.movePromotion(move)) {
            const colorPrefix = move.color === 2 || move.color === "b" ? "b" : "w";
            // Defaulting to a queen when `move.promotion` is absent is exactly
            // the bug: a move carrying only san "e8=N" would promote a queen.
            const piece = String(promotion || "q").toLowerCase();
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
                        && (!Core.movePromotion(move) || Core.movePromotion(lastMove) === Core.movePromotion(move));
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
