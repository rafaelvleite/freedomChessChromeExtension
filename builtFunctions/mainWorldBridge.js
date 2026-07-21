(function freedomChessMainWorldBridge() {
    'use strict';

    const EXTENSION_SOURCE = 'freedom-chess-extension';
    const PAGE_SOURCE = 'freedom-chess-page';
    const REQUEST_TYPE = 'FREEDOM_CHESS_GET_STATE';
    const RESPONSE_TYPE = 'FREEDOM_CHESS_STATE';
    const STATE_CHANGED_TYPE = 'FREEDOM_CHESS_STATE_CHANGED';
    const BOARD_SELECTOR = 'wc-chess-board';
    const ACTIVE_BOARD_ATTRIBUTE = 'data-freedom-chess-active-board';
    const GAME_EVENTS = [
        'Move',
        'Undo',
        'Load',
        'Reload',
        'SelectNode',
        'CreateGame'
    ];
    const TARGET_ORIGIN = window.location.origin;
    const MAX_STRING_LENGTH = 8192;
    const MAX_ARRAY_LENGTH = 2048;
    const MAX_OBJECT_KEYS = 256;
    const MAX_SERIALIZED_VALUES = 12000;
    const MAX_SERIALIZATION_DEPTH = 8;

    let activeBoard = null;
    let activeGame = null;
    let listenerDisposers = [];
    let refreshTimer = null;
    let refreshMustSearch = false;
    let stateChangedTimer = null;
    let mutationObserver = null;
    let stopped = false;

    function isObjectLike(value) {
        return value !== null && (typeof value === 'object' || typeof value === 'function');
    }

    function safeBoardGame(board) {
        if (!board || !board.isConnected) {
            return null;
        }

        try {
            return isObjectLike(board.game) ? board.game : null;
        } catch (_error) {
            return null;
        }
    }

    function safeBoardArea(board) {
        try {
            const rectangle = board.getBoundingClientRect();
            if (!rectangle || rectangle.width <= 0 || rectangle.height <= 0) {
                return 0;
            }

            return Math.min(rectangle.width * rectangle.height, 1000000);
        } catch (_error) {
            return 0;
        }
    }

    function gameApiScore(game) {
        if (!game) {
            return 0;
        }

        const methodNames = [
            'getFEN',
            'getLegalMoves',
            'getLastMove',
            'getHistorySANs',
            'getTurn',
            'getPositionInfo',
            'getMode',
            'getVersion'
        ];
        let score = 0;

        for (const methodName of methodNames) {
            try {
                if (typeof game[methodName] === 'function') {
                    score += 1;
                }
            } catch (_error) {
                // An inaccessible method simply does not contribute to the score.
            }
        }

        return score;
    }

    function findBestBoard() {
        let boards;

        try {
            boards = Array.from(document.querySelectorAll(BOARD_SELECTOR));
        } catch (_error) {
            return null;
        }

        let bestBoard = null;
        let bestScore = -1;

        for (const board of boards) {
            if (!board || !board.isConnected) {
                continue;
            }

            const game = safeBoardGame(board);
            const apiScore = gameApiScore(game);
            const visibleArea = safeBoardArea(board);
            const score = (game ? 100000000 : 0) + (apiScore * 1000000) + visibleArea;

            if (score > bestScore || (score === bestScore && board === activeBoard)) {
                bestBoard = board;
                bestScore = score;
            }
        }

        return bestBoard;
    }

    function addEmitterListener(target, eventName, handler) {
        if (!isObjectLike(target)) {
            return false;
        }

        try {
            if (typeof target.on === 'function') {
                const possibleDisposer = target.on(eventName, handler);
                listenerDisposers.push(function removeEmitterListener() {
                    try {
                        if (typeof possibleDisposer === 'function') {
                            possibleDisposer();
                        } else if (typeof target.off === 'function') {
                            target.off(eventName, handler);
                        } else if (typeof target.removeListener === 'function') {
                            target.removeListener(eventName, handler);
                        }
                    } catch (_error) {
                        // The old Chess.com game instance may already be disposed.
                    }
                });
                return true;
            }
        } catch (_error) {
            // Fall through to EventTarget-style listeners.
        }

        try {
            if (typeof target.addEventListener === 'function') {
                target.addEventListener(eventName, handler);
                listenerDisposers.push(function removeEventTargetListener() {
                    try {
                        target.removeEventListener(eventName, handler);
                    } catch (_error) {
                        // The old target may already be disposed.
                    }
                });
                return true;
            }
        } catch (_error) {
            // Unsupported events are tolerated; the DOM observer remains a fallback.
        }

        return false;
    }

    function detachGameListeners() {
        const disposers = listenerDisposers;
        listenerDisposers = [];

        for (const dispose of disposers) {
            try {
                dispose();
            } catch (_error) {
                // Every listener is best-effort so one failure cannot leak the others.
            }
        }
    }

    function handleGameEvent(eventName) {
        return function onGameStateChanged() {
            if (eventName === 'CreateGame') {
                scheduleBoardRefresh(true, 0);
            } else if (activeBoard && safeBoardGame(activeBoard) !== activeGame) {
                scheduleBoardRefresh(false, 0);
            }

            scheduleStateChanged(25);
        };
    }

    function attachGameListeners(board, game) {
        for (const eventName of GAME_EVENTS) {
            const handler = handleGameEvent(eventName);
            const attachedToGame = addEmitterListener(game, eventName, handler);

            // Some Chess.com surfaces forward game events through the web component.
            // Use it only as a fallback to avoid processing every event twice.
            if (!attachedToGame && board && board !== game) {
                addEmitterListener(board, eventName, handler);
            }
        }

        // CreateGame can be dispatched by the component before board.game changes.
        if (game && board && board !== game) {
            addEmitterListener(board, 'CreateGame', handleGameEvent('CreateGame'));
        }
    }

    function refreshBoardBinding(forceSearch) {
        if (stopped) {
            return;
        }

        let nextBoard = activeBoard;
        let nextGame = safeBoardGame(nextBoard);

        if (forceSearch || !nextBoard || !nextBoard.isConnected || !nextGame) {
            nextBoard = findBestBoard();
            nextGame = safeBoardGame(nextBoard);
        }

        if (nextBoard === activeBoard && nextGame === activeGame) {
            if (activeBoard) {
                try {
                    activeBoard.setAttribute(ACTIVE_BOARD_ATTRIBUTE, 'true');
                } catch (_error) {
                    // The board can still be read even if DOM marking is unavailable.
                }
            }
            return;
        }

        detachGameListeners();
        if (activeBoard && activeBoard !== nextBoard) {
            try {
                activeBoard.removeAttribute(ACTIVE_BOARD_ATTRIBUTE);
            } catch (_error) {
                // The detached component may no longer expose DOM methods.
            }
        }
        activeBoard = nextBoard;
        activeGame = nextGame;
        if (activeBoard) {
            try {
                activeBoard.setAttribute(ACTIVE_BOARD_ATTRIBUTE, 'true');
            } catch (_error) {
                // State remains readable even if the marker cannot be applied.
            }
        }
        attachGameListeners(activeBoard, activeGame);
        scheduleStateChanged(0);
    }

    function scheduleBoardRefresh(forceSearch, delay) {
        if (stopped) {
            return;
        }

        refreshMustSearch = refreshMustSearch || Boolean(forceSearch);

        if (refreshTimer !== null) {
            window.clearTimeout(refreshTimer);
        }

        refreshTimer = window.setTimeout(function runScheduledBoardRefresh() {
            const mustSearch = refreshMustSearch;
            refreshTimer = null;
            refreshMustSearch = false;
            refreshBoardBinding(mustSearch);
        }, typeof delay === 'number' ? Math.max(0, delay) : 50);
    }

    function nodeContainsBoard(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }

        try {
            return node.matches(BOARD_SELECTOR) || Boolean(node.querySelector(BOARD_SELECTOR));
        } catch (_error) {
            return false;
        }
    }

    function observeBoardLifecycle() {
        if (typeof MutationObserver !== 'function') {
            return;
        }

        mutationObserver = new MutationObserver(function onDocumentMutations(records) {
            let shouldRefresh = !activeBoard || !activeBoard.isConnected;
            let mustSearch = shouldRefresh;

            for (const record of records) {
                if (mustSearch) {
                    break;
                }

                for (const node of record.addedNodes) {
                    if (nodeContainsBoard(node)) {
                        shouldRefresh = true;
                        mustSearch = true;
                        break;
                    }
                }

                if (mustSearch) {
                    break;
                }

                for (const node of record.removedNodes) {
                    if (nodeContainsBoard(node) || node === activeBoard) {
                        shouldRefresh = true;
                        mustSearch = true;
                        break;
                    }
                }

                if (!shouldRefresh && activeBoard) {
                    try {
                        shouldRefresh = record.target === activeBoard || activeBoard.contains(record.target);
                    } catch (_error) {
                        shouldRefresh = true;
                    }
                }
            }

            if (shouldRefresh) {
                scheduleBoardRefresh(mustSearch, 50);
            }
        });

        try {
            mutationObserver.observe(document, { childList: true, subtree: true });
        } catch (_error) {
            mutationObserver = null;
        }
    }

    function makeEmptyState(board) {
        return {
            available: false,
            boardConnected: Boolean(board && board.isConnected),
            fen: null,
            legalMoves: [],
            lastMove: null,
            historySAN: [],
            turn: null,
            positionInfo: null,
            mode: null,
            version: null
        };
    }

    function cloneSerializable(value, context, depth) {
        if (value === null) {
            return null;
        }

        const valueType = typeof value;

        if (valueType === 'string') {
            return value.slice(0, MAX_STRING_LENGTH);
        }

        if (valueType === 'boolean') {
            return value;
        }

        if (valueType === 'number') {
            return Number.isFinite(value) ? value : null;
        }

        if (valueType === 'bigint') {
            return value.toString();
        }

        if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol') {
            return undefined;
        }

        if (depth >= MAX_SERIALIZATION_DEPTH || context.remaining <= 0) {
            return null;
        }

        context.remaining -= 1;

        if (context.seen.has(value)) {
            return null;
        }

        context.seen.add(value);

        try {
            if (Array.isArray(value)) {
                const result = [];
                const length = Math.min(value.length, MAX_ARRAY_LENGTH);

                for (let index = 0; index < length; index += 1) {
                    let entry;

                    try {
                        entry = value[index];
                    } catch (_error) {
                        entry = null;
                    }

                    const clonedEntry = cloneSerializable(entry, context, depth + 1);
                    result.push(clonedEntry === undefined ? null : clonedEntry);
                }

                return result;
            }

            if (value instanceof Date) {
                const timestamp = value.getTime();
                return Number.isFinite(timestamp) ? value.toISOString() : null;
            }

            if (ArrayBuffer.isView(value)) {
                const values = Array.from(value).slice(0, MAX_ARRAY_LENGTH);
                return values.map(function cloneTypedArrayEntry(entry) {
                    return cloneSerializable(entry, context, depth + 1);
                });
            }

            const result = {};
            let descriptors;

            try {
                descriptors = Object.getOwnPropertyDescriptors(value);
            } catch (_error) {
                return null;
            }

            const keys = Object.keys(descriptors).slice(0, MAX_OBJECT_KEYS);

            for (const key of keys) {
                if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
                    continue;
                }

                const descriptor = descriptors[key];
                if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
                    continue;
                }

                const clonedValue = cloneSerializable(descriptor.value, context, depth + 1);
                if (clonedValue !== undefined) {
                    result[key.slice(0, 128)] = clonedValue;
                }
            }

            return result;
        } finally {
            context.seen.delete(value);
        }
    }

    function toSerializable(value) {
        return cloneSerializable(value, {
            seen: new WeakSet(),
            remaining: MAX_SERIALIZED_VALUES
        }, 0);
    }

    function invokeGameMethod(game, methodName) {
        let method;

        try {
            method = game[methodName];
        } catch (_error) {
            throw new Error('METHOD_INACCESSIBLE');
        }

        if (typeof method !== 'function') {
            throw new Error('METHOD_UNAVAILABLE');
        }

        let value;

        try {
            value = Reflect.apply(method, game, []);
        } catch (_error) {
            throw new Error('METHOD_FAILED');
        }

        if (isObjectLike(value)) {
            try {
                if (typeof value.then === 'function') {
                    throw new Error('ASYNC_METHOD_UNSUPPORTED');
                }
            } catch (_error) {
                throw new Error('INVALID_METHOD_RESULT');
            }
        }

        return value;
    }

    function readMode(game) {
        const rawMode = invokeGameMethod(game, 'getMode');

        if (rawMode === null || rawMode === undefined) {
            return null;
        }

        if (typeof rawMode === 'string' || typeof rawMode === 'number') {
            return toSerializable(rawMode);
        }

        let name;

        try {
            name = rawMode.name;
        } catch (_error) {
            throw new Error('INVALID_MODE');
        }

        if (typeof name !== 'string' && typeof name !== 'number') {
            throw new Error('INVALID_MODE');
        }

        return toSerializable(name);
    }

    function validateStateValue(field, value) {
        switch (field) {
            case 'fen':
                return typeof value === 'string' && value.length > 0;
            case 'legalMoves':
            case 'historySAN':
                return Array.isArray(value);
            case 'lastMove':
            case 'positionInfo':
                return value === null || value === undefined || isObjectLike(value) || typeof value === 'string';
            case 'turn':
            case 'version':
                return value !== undefined && typeof value !== 'function' && typeof value !== 'symbol';
            case 'mode':
                return value === null || typeof value === 'string' || typeof value === 'number';
            default:
                return false;
        }
    }

    function collectState(minimal) {
        refreshBoardBinding(false);

        const board = activeBoard && activeBoard.isConnected ? activeBoard : findBestBoard();
        const game = board === activeBoard ? activeGame : safeBoardGame(board);
        const state = makeEmptyState(board);

        if (!game) {
            return {
                ok: false,
                state: state,
                error: {
                    code: 'BOARD_UNAVAILABLE',
                    message: 'Chess.com game state is not available.'
                }
            };
        }

        const requiredFailures = [];
        const readers = minimal ? [
            ['fen', 'getFEN', true],
            ['lastMove', 'getLastMove', false]
        ] : [
            ['fen', 'getFEN', true],
            ['legalMoves', 'getLegalMoves', true],
            ['lastMove', 'getLastMove', false],
            ['historySAN', 'getHistorySANs', false],
            ['turn', 'getTurn', false],
            ['positionInfo', 'getPositionInfo', false],
            ['mode', 'getMode', false],
            ['version', 'getVersion', false]
        ];

        for (const entry of readers) {
            const field = entry[0];
            const methodName = entry[1];
            const required = entry[2];

            try {
                let rawValue = field === 'mode' ? readMode(game) : invokeGameMethod(game, methodName);
                if (field === 'lastMove' && rawValue === undefined) {
                    rawValue = null;
                }
                if (!validateStateValue(field, rawValue)) {
                    throw new Error('INVALID_METHOD_RESULT');
                }

                const serializedValue = field === 'mode' ? rawValue : toSerializable(rawValue);
                if (serializedValue === undefined) {
                    throw new Error('UNSERIALIZABLE_METHOD_RESULT');
                }

                state[field] = serializedValue;
            } catch (_error) {
                if (required) {
                    requiredFailures.push(field);
                }
            }
        }

        if (requiredFailures.length > 0) {
            state.available = false;
            return {
                ok: false,
                state: state,
                error: {
                    code: 'STATE_READ_FAILED',
                    message: 'Unable to read the essential Chess.com game state.',
                    fields: requiredFailures
                }
            };
        }

        state.available = true;
        return { ok: true, state: state, error: null };
    }

    function postToExtension(message) {
        if (stopped || typeof TARGET_ORIGIN !== 'string' || TARGET_ORIGIN === 'null') {
            return false;
        }

        try {
            window.postMessage(message, TARGET_ORIGIN);
            return true;
        } catch (_error) {
            return false;
        }
    }

    function scheduleStateChanged(delay) {
        if (stopped) {
            return;
        }

        if (stateChangedTimer !== null) {
            window.clearTimeout(stateChangedTimer);
        }

        stateChangedTimer = window.setTimeout(function emitStateChanged() {
            stateChangedTimer = null;

            let result;
            try {
                result = collectState();
            } catch (_error) {
                result = { state: makeEmptyState(activeBoard) };
            }

            postToExtension({
                source: PAGE_SOURCE,
                type: STATE_CHANGED_TYPE,
                state: result.state
            });
        }, typeof delay === 'number' ? Math.max(0, delay) : 25);
    }

    function isValidRequestId(requestId) {
        if (typeof requestId === 'string') {
            return requestId.length > 0 && requestId.length <= 128 && !/[\u0000-\u001f\u007f]/.test(requestId);
        }

        return typeof requestId === 'number' && Number.isSafeInteger(requestId) && requestId >= 0;
    }

    function isValidToken(token) {
        return typeof token === 'string' &&
            token.length > 0 &&
            token.length <= 512 &&
            !/[\s\u0000-\u001f\u007f]/.test(token);
    }

    function parseRequest(event) {
        if (!event || event.source !== window || event.origin !== TARGET_ORIGIN) {
            return null;
        }

        let data;
        try {
            data = event.data;
        } catch (_error) {
            return null;
        }

        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return null;
        }

        try {
            if (data.source !== EXTENSION_SOURCE || data.type !== REQUEST_TYPE) {
                return null;
            }

            if (!isValidRequestId(data.requestId) || !isValidToken(data.token)) {
                return null;
            }

            return {
                requestId: data.requestId,
                token: data.token,
                minimal: data.minimal === true
            };
        } catch (_error) {
            return null;
        }
    }

    function handleMessage(event) {
        const request = parseRequest(event);
        if (!request) {
            return;
        }

        let result;
        try {
            result = collectState(request.minimal);
        } catch (_error) {
            result = {
                ok: false,
                state: makeEmptyState(activeBoard),
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Unable to read Chess.com game state.'
                }
            };
        }

        postToExtension({
            source: PAGE_SOURCE,
            type: RESPONSE_TYPE,
            requestId: request.requestId,
            token: request.token,
            ok: result.ok,
            state: result.state,
            error: result.error
        });
    }

    function stop() {
        if (stopped) {
            return;
        }

        stopped = true;
        window.removeEventListener('message', handleMessage);
        detachGameListeners();

        if (activeBoard) {
            try {
                activeBoard.removeAttribute(ACTIVE_BOARD_ATTRIBUTE);
            } catch (_error) {
                // The document is unloading.
            }
        }

        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }

        if (refreshTimer !== null) {
            window.clearTimeout(refreshTimer);
            refreshTimer = null;
        }

        if (stateChangedTimer !== null) {
            window.clearTimeout(stateChangedTimer);
            stateChangedTimer = null;
        }

        activeBoard = null;
        activeGame = null;
    }

    window.addEventListener('message', handleMessage);
    window.addEventListener('beforeunload', stop, { once: true });
    observeBoardLifecycle();
    scheduleBoardRefresh(true, 0);

    // A board can be connected before its custom element class and game property are ready.
    // These are bounded retries, not a permanent polling loop.
    for (const delay of [100, 500, 1500, 5000]) {
        window.setTimeout(function retryInitialBinding() {
            if (!activeGame) {
                scheduleBoardRefresh(true, 0);
            }
        }, delay);
    }

    try {
        if (window.customElements && typeof window.customElements.whenDefined === 'function') {
            window.customElements.whenDefined(BOARD_SELECTOR).then(function onBoardElementDefined() {
                scheduleBoardRefresh(true, 0);
            }).catch(function ignoreDefinitionFailure() {
                // Mutation observation and bounded retries remain available.
            });
        }
    } catch (_error) {
        // Older or restricted environments can still use the other discovery paths.
    }
}());
