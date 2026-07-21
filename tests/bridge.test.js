"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BRIDGE_SOURCE = fs.readFileSync(
    path.join(__dirname, "../builtFunctions/mainWorldBridge.js"),
    "utf8"
);
const CHESS_ORIGIN = "https://www.chess.com";

class TestScheduler {
    constructor() {
        this.now = 0;
        this.nextId = 1;
        this.tasks = new Map();
    }

    setTimeout(callback, delay) {
        const id = this.nextId++;
        const safeDelay = Number.isFinite(delay) ? Math.max(0, delay) : 0;
        this.tasks.set(id, { callback, due: this.now + safeDelay });
        return id;
    }

    clearTimeout(id) {
        this.tasks.delete(id);
    }

    advance(milliseconds) {
        const target = this.now + Math.max(0, milliseconds);
        let executions = 0;

        while (true) {
            let nextId = null;
            let nextTask = null;

            for (const [id, task] of this.tasks) {
                if (task.due > target) {
                    continue;
                }

                if (!nextTask || task.due < nextTask.due || (task.due === nextTask.due && id < nextId)) {
                    nextId = id;
                    nextTask = task;
                }
            }

            if (!nextTask) {
                break;
            }

            this.tasks.delete(nextId);
            this.now = nextTask.due;
            nextTask.callback();
            executions += 1;

            if (executions > 1000) {
                throw new Error("Bridge test scheduler exceeded its execution limit");
            }
        }

        this.now = target;
    }
}

function createGame() {
    const positionInfo = {
        check: false,
        canCastle: { king: true, queen: false }
    };
    positionInfo.circularReference = positionInfo;

    const snapshot = {
        fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
        legalMoves: [
            {
                color: 1,
                from: "g1",
                to: "f3",
                piece: "n",
                flags: 1,
                san: "Nf3",
                internalHelper() {
                    return "must not cross the bridge";
                }
            }
        ],
        lastMove: {
            san: "e5",
            fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
            beforeFen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
            from: "e7",
            to: "e5",
            piece: "p",
            flags: 4,
            ply: 2,
            wholeMoveNumber: 1,
            color: 2,
            privateMethod() {
                return "must not cross the bridge";
            }
        },
        historySAN: ["e4", "e5"],
        turn: 2,
        positionInfo,
        mode: "analysis",
        version: "2026.7.11"
    };
    const handlers = new Map();

    const game = {
        snapshot,
        handlers,
        getFEN() {
            return snapshot.fen;
        },
        getLegalMoves() {
            return snapshot.legalMoves;
        },
        getLastMove() {
            return snapshot.lastMove;
        },
        getHistorySANs() {
            return snapshot.historySAN;
        },
        getTurn() {
            return snapshot.turn;
        },
        getPositionInfo() {
            return snapshot.positionInfo;
        },
        getMode() {
            return {
                name: snapshot.mode,
                internalHelper() {
                    return "must not cross the bridge";
                }
            };
        },
        getVersion() {
            return snapshot.version;
        },
        on(eventName, handler) {
            if (!handlers.has(eventName)) {
                handlers.set(eventName, new Set());
            }
            handlers.get(eventName).add(handler);
        },
        off(eventName, handler) {
            const eventHandlers = handlers.get(eventName);
            if (eventHandlers) {
                eventHandlers.delete(handler);
            }
        },
        emit(eventName) {
            for (const handler of handlers.get(eventName) || []) {
                handler();
            }
        }
    };

    return game;
}

function createBoard(game) {
    const listeners = new Map();
    const attributes = new Map();

    return {
        nodeType: 1,
        isConnected: true,
        game,
        getBoundingClientRect() {
            return { width: 640, height: 640 };
        },
        matches(selector) {
            return selector === "wc-chess-board";
        },
        querySelector() {
            return null;
        },
        contains() {
            return false;
        },
        getAttribute(name) {
            return attributes.get(name) || null;
        },
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        removeAttribute(name) {
            attributes.delete(name);
        },
        addEventListener(eventName, handler) {
            if (!listeners.has(eventName)) {
                listeners.set(eventName, new Set());
            }
            listeners.get(eventName).add(handler);
        },
        removeEventListener(eventName, handler) {
            const eventListeners = listeners.get(eventName);
            if (eventListeners) {
                eventListeners.delete(handler);
            }
        }
    };
}

function createHarness(options = {}) {
    const scheduler = new TestScheduler();
    const windowListeners = new Map();
    const messages = [];
    const boards = options.board ? [options.board] : [];
    let observerCallback = null;

    class TestMutationObserver {
        constructor(callback) {
            observerCallback = callback;
        }

        observe() {}

        disconnect() {
            observerCallback = null;
        }
    }

    const sandbox = {
        Node: { ELEMENT_NODE: 1 },
        MutationObserver: TestMutationObserver,
        document: {
            querySelectorAll(selector) {
                return selector === "wc-chess-board" ? boards.slice() : [];
            }
        },
        location: { origin: CHESS_ORIGIN },
        setTimeout: scheduler.setTimeout.bind(scheduler),
        clearTimeout: scheduler.clearTimeout.bind(scheduler),
        addEventListener(eventName, handler) {
            if (!windowListeners.has(eventName)) {
                windowListeners.set(eventName, new Set());
            }
            windowListeners.get(eventName).add(handler);
        },
        removeEventListener(eventName, handler) {
            const listeners = windowListeners.get(eventName);
            if (listeners) {
                listeners.delete(handler);
            }
        },
        postMessage(message, targetOrigin) {
            messages.push({ message: structuredClone(message), targetOrigin });
        }
    };
    sandbox.window = sandbox;

    const context = vm.createContext(sandbox);
    vm.runInContext(BRIDGE_SOURCE, context, { filename: "mainWorldBridge.js" });
    const pageWindow = vm.runInContext("window", context);

    function dispatchWindowEvent(eventName, event) {
        for (const handler of windowListeners.get(eventName) || []) {
            handler(event);
        }
    }

    function request(dataOverrides = {}, eventOverrides = {}) {
        dispatchWindowEvent("message", {
            source: pageWindow,
            origin: CHESS_ORIGIN,
            data: {
                source: "freedom-chess-extension",
                type: "FREEDOM_CHESS_GET_STATE",
                requestId: "request-1",
                token: "valid-token",
                ...dataOverrides
            },
            ...eventOverrides
        });
    }

    function clearMessages() {
        messages.length = 0;
    }

    function stop() {
        dispatchWindowEvent("beforeunload", {});
    }

    scheduler.advance(0);

    return {
        boards,
        clearMessages,
        messages,
        mutate(records) {
            if (observerCallback) {
                observerCallback(records);
            }
        },
        request,
        scheduler,
        stop
    };
}

function responseMessages(harness) {
    return harness.messages
        .map((entry) => entry.message)
        .filter((message) => message.type === "FREEDOM_CHESS_STATE");
}

function assertContainsNoFunctions(value, seen = new Set()) {
    if (value === null || typeof value !== "object" || seen.has(value)) {
        return;
    }

    seen.add(value);
    for (const key of Object.keys(value)) {
        assert.notEqual(typeof value[key], "function", `function leaked at ${key}`);
        assertContainsNoFunctions(value[key], seen);
    }
}

test("returns a complete, serializable game state and echoes request correlation", (t) => {
    const game = createGame();
    const harness = createHarness({ board: createBoard(game) });
    t.after(() => harness.stop());
    harness.clearMessages();

    harness.request({ requestId: "state-request", token: "correlation-token" });

    const responses = responseMessages(harness);
    assert.equal(responses.length, 1);
    const response = responses[0];
    assert.equal(response.source, "freedom-chess-page");
    assert.equal(response.requestId, "state-request");
    assert.equal(response.token, "correlation-token");
    assert.equal(response.ok, true);
    assert.equal(response.error, null);
    assert.deepEqual(Object.keys(response.state), [
        "available",
        "boardConnected",
        "fen",
        "legalMoves",
        "lastMove",
        "historySAN",
        "turn",
        "positionInfo",
        "mode",
        "version"
    ]);
    assert.equal(response.state.available, true);
    assert.equal(response.state.boardConnected, true);
    assert.equal(response.state.fen, game.snapshot.fen);
    assert.deepEqual(response.state.legalMoves, [{
        color: 1,
        from: "g1",
        to: "f3",
        piece: "n",
        flags: 1,
        san: "Nf3"
    }]);
    assert.equal(response.state.lastMove.san, "e5");
    assert.equal(response.state.lastMove.privateMethod, undefined);
    assert.deepEqual(response.state.historySAN, ["e4", "e5"]);
    assert.equal(response.state.turn, 2);
    assert.deepEqual(response.state.positionInfo.canCastle, { king: true, queen: false });
    assert.equal(response.state.positionInfo.circularReference, null);
    assert.equal(response.state.mode, "analysis");
    assert.equal(response.state.version, "2026.7.11");
    assert.equal(harness.boards[0].getAttribute("data-freedom-chess-active-board"), "true");
    assertContainsNoFunctions(response.state);
    assert.doesNotThrow(() => structuredClone(response.state));
    assert.equal(harness.messages.at(-1).targetOrigin, CHESS_ORIGIN);
});

test("keeps optional metadata failures from disabling essential move state", (t) => {
    const game = createGame();
    game.getHistorySANs = () => { throw new Error("not supported"); };
    game.getPositionInfo = () => { throw new Error("not supported"); };
    game.getVersion = undefined;
    const harness = createHarness({ board: createBoard(game) });
    t.after(() => harness.stop());
    harness.clearMessages();

    harness.request({ requestId: "optional", token: "valid-token" });

    const response = responseMessages(harness)[0];
    assert.equal(response.ok, true);
    assert.equal(response.state.available, true);
    assert.equal(response.state.fen, game.snapshot.fen);
    assert.equal(response.state.legalMoves.length, 1);
    assert.deepEqual(response.state.historySAN, []);
    assert.equal(response.state.positionInfo, null);
    assert.equal(response.state.version, null);
});

test("minimal snapshots avoid legal-move and metadata work while verifying a move", (t) => {
    const game = createGame();
    let legalMoveReads = 0;
    let historyReads = 0;
    game.getLegalMoves = () => { legalMoveReads += 1; return game.snapshot.legalMoves; };
    game.getHistorySANs = () => { historyReads += 1; return game.snapshot.historySAN; };
    const harness = createHarness({ board: createBoard(game) });
    t.after(() => harness.stop());
    harness.clearMessages();
    legalMoveReads = 0;
    historyReads = 0;

    harness.request({ requestId: "minimal", token: "valid-token", minimal: true });

    const response = responseMessages(harness)[0];
    assert.equal(response.ok, true);
    assert.equal(response.state.available, true);
    assert.equal(response.state.fen, game.snapshot.fen);
    assert.equal(response.state.lastMove.san, "e5");
    assert.deepEqual(response.state.legalMoves, []);
    assert.equal(legalMoveReads, 0);
    assert.equal(historyReads, 0);
});

test("ignores requests with an invalid origin or token", (t) => {
    const harness = createHarness({ board: createBoard(createGame()) });
    t.after(() => harness.stop());
    harness.clearMessages();

    harness.request({ token: "token with spaces" });
    harness.request({ token: "" });
    harness.request({}, { origin: "https://attacker.example" });
    harness.request({}, { source: {} });
    harness.request({ source: "not-freedom-chess", token: "valid-token" });

    assert.equal(responseMessages(harness).length, 0);

    harness.request({ requestId: "accepted", token: "valid-token" });
    assert.equal(responseMessages(harness).length, 1);
    assert.equal(responseMessages(harness)[0].requestId, "accepted");
});

test("emits a debounced STATE_CHANGED message after a supported game event", (t) => {
    const game = createGame();
    const harness = createHarness({ board: createBoard(game) });
    t.after(() => harness.stop());
    harness.clearMessages();

    game.snapshot.fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2";
    game.snapshot.historySAN.push("Nf3");
    game.emit("Move");

    harness.scheduler.advance(24);
    assert.equal(harness.messages.length, 0);
    harness.scheduler.advance(1);

    assert.equal(harness.messages.length, 1);
    const event = harness.messages[0];
    assert.equal(event.targetOrigin, CHESS_ORIGIN);
    assert.equal(event.message.source, "freedom-chess-page");
    assert.equal(event.message.type, "FREEDOM_CHESS_STATE_CHANGED");
    assert.equal(event.message.state.fen, game.snapshot.fen);
    assert.deepEqual(event.message.state.historySAN, ["e4", "e5", "Nf3"]);
    assert.equal(Object.prototype.hasOwnProperty.call(event.message, "token"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(event.message, "requestId"), false);
});

test("returns a stable unavailable state when no board game exists", (t) => {
    const harness = createHarness();
    t.after(() => harness.stop());
    harness.clearMessages();

    harness.request({ requestId: "unavailable", token: "valid-token" });

    const responses = responseMessages(harness);
    assert.equal(responses.length, 1);
    assert.equal(responses[0].ok, false);
    assert.deepEqual(responses[0].error, {
        code: "BOARD_UNAVAILABLE",
        message: "Chess.com game state is not available."
    });
    assert.deepEqual(responses[0].state, {
        available: false,
        boardConnected: false,
        fen: null,
        legalMoves: [],
        lastMove: null,
        historySAN: [],
        turn: null,
        positionInfo: null,
        mode: null,
        version: null
    });
});
