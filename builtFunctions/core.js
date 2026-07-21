/*
 * Pure speech-to-chess helpers.
 *
 * This file deliberately has no DOM, Web Speech or chess.js dependency.  It is
 * exposed as `FreedomChessCore` in a browser and as a CommonJS module in Node.
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.FreedomChessCore = factory();
    }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    var PIECE_WORDS = {
        p: "Peão",
        n: "Cavalo",
        b: "Bispo",
        r: "Torre",
        q: "Dama",
        k: "Rei"
    };

    var FILE_WORDS = {
        a: "a",
        b: "bê",
        c: "cê",
        d: "dê",
        e: "é",
        f: "efe",
        g: "gê",
        h: "agá"
    };

    var RANK_WORDS = {
        "1": "um",
        "2": "dois",
        "3": "três",
        "4": "quatro",
        "5": "cinco",
        "6": "seis",
        "7": "sete",
        "8": "oito"
    };

    var SPOKEN_FILE_TO_FILE = {
        a: "a",
        be: "b",
        b: "b",
        ce: "c",
        c: "c",
        de: "d",
        d: "d",
        e: "e",
        efe: "f",
        f: "f",
        ge: "g",
        g: "g",
        aga: "h",
        h: "h"
    };

    var PROMOTION_PIECES = { Q: "q", R: "r", B: "b", N: "n" };

    function replaceWords(value, words, replacement) {
        var expression = new RegExp("\\b(?:" + words.join("|") + ")\\b", "g");
        return value.replace(expression, replacement);
    }

    function protectWrittenPieceSymbols(value) {
        var placeholders = {
            K: "__piece_k__",
            Q: "__piece_q__",
            R: "__piece_r__",
            B: "__piece_b__",
            N: "__piece_n__",
            P: "__piece_p__"
        };

        return value.replace(/(^|[\s=])([KQRBNP])(?=[a-h1-8x\s=]|$)/g, function (_, prefix, piece) {
            return prefix + placeholders[piece] + " ";
        });
    }

    /**
     * Converts common Brazilian Portuguese chess speech into a small canonical
     * notation.  It only performs lexical normalization; it never substitutes
     * one chess piece or move type for another based on similarity.
     */
    function normalizeSpeech(input) {
        if (input === null || input === undefined) {
            return "";
        }

        var value = protectWrittenPieceSymbols(String(input).trim());
        if (!value) {
            return "";
        }

        if (typeof value.normalize === "function") {
            value = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        }
        value = value.toLowerCase();

        // Protect castling before punctuation and hyphens are discarded.
        value = value
            .replace(/\b(?:o|zero)\s+(?:o|zero)\s+(?:o|zero)\b/g, " __castle_queen__ ")
            .replace(/\b(?:o|zero)\s+(?:o|zero)\b/g, " __castle_king__ ")
            .replace(/\b(?:o|0)\s*-\s*(?:o|0)\s*-\s*(?:o|0)\b/g, " __castle_queen__ ")
            .replace(/\b(?:o|0)\s*-\s*(?:o|0)\b/g, " __castle_king__ ")
            .replace(/\broque\s+para\s+o\s+lado\s+da\s+dama\b/g, " __castle_queen__ ")
            .replace(/\broque\s+(?:do\s+)?lado\s+da\s+dama\b/g, " __castle_queen__ ")
            .replace(/\broque\s+(?:grande|longo)\b/g, " __castle_queen__ ")
            .replace(/\b(?:grande|longo)\s+roque\b/g, " __castle_queen__ ")
            .replace(/\broque\s+para\s+o\s+lado\s+do\s+rei\b/g, " __castle_king__ ")
            .replace(/\broque\s+(?:do\s+)?lado\s+do\s+rei\b/g, " __castle_king__ ")
            .replace(/\broque\s+(?:pequeno|curto)\b/g, " __castle_king__ ")
            .replace(/\b(?:pequeno|curto)\s+roque\b/g, " __castle_king__ ")
            .replace(/\broque\b/g, " __castle_king__ ");

        // Remove harmless request words. They do not carry move semantics.
        value = value
            .replace(/\bpor\s+favor\b/g, " ")
            .replace(/\b(?:jogue|joga|jogar|mova|move|mover|faca|faz|fazer)\s+(?:o|a)?\b/g, " ")
            .replace(/\beu\s+quero\b/g, " ")
            .replace(/\bquero\b/g, " ")
            .replace(/\b(?:para|ate)\s+a\s+(?:casa\s+)?(?=[a-h](?:\s*[1-8]|\s+(?:um|dois|tres|quatro|cinco|seis|sete|oito))\b)/g, " para ")
            .replace(/\b(?:na|no)\s+casa\b/g, " ");

        // Promotion markers are canonicalized before piece names.
        value = value
            .replace(/\b(?:promocao|promover|promova|promove|promovendo|promovido)\s*(?:a|para|em)?\b/g, " = ")
            .replace(/\b(?:vira|virar|virando)\s+(?:uma?\s+)?/g, " = ")
            .replace(/\bigual\s+a\b/g, " = ");

        value = replaceWords(value, ["peao"], " P ");
        value = replaceWords(value, ["cavalo"], " N ");
        value = replaceWords(value, ["bispo"], " B ");
        value = replaceWords(value, ["torre"], " R ");
        value = replaceWords(value, ["dama", "rainha"], " Q ");
        value = replaceWords(value, ["rei"], " K ");

        value = value
            .replace(/__piece_k__/g, " K ")
            .replace(/__piece_q__/g, " Q ")
            .replace(/__piece_r__/g, " R ")
            .replace(/__piece_b__/g, " B ")
            .replace(/__piece_n__/g, " N ")
            .replace(/__piece_p__/g, " P ");

        value = value
            .replace(/\buma?\b/g, "1")
            .replace(/\b(?:dois|duas)\b/g, "2")
            .replace(/\btres\b/g, "3")
            .replace(/\bquatro\b/g, "4")
            .replace(/\bcinco\b/g, "5")
            .replace(/\bseis\b/g, "6")
            .replace(/\bsete\b/g, "7")
            .replace(/\boito\b/g, "8");

        // "dê" and "é" lose their accents above. They are treated as file
        // names only when followed by a rank, which avoids rewriting ordinary
        // Portuguese prepositions and conjunctions.
        value = value.replace(/\b(a|be|b|ce|c|de|d|e|efe|f|ge|g|aga|h)\s*([1-8])\b/g,
            function (_, spokenFile, rank) {
                return SPOKEN_FILE_TO_FILE[spokenFile] + rank;
            });

        value = value.replace(/\bcoluna\s+(a|be|b|ce|c|de|d|e|efe|f|ge|g|aga|h)\b/g,
            function (_, spokenFile) {
                return "coluna " + SPOKEN_FILE_TO_FILE[spokenFile];
            });

        // In "g1 a f3", the isolated "a" is a connector. Keep it intact in
        // "torre a d1", where it disambiguates the origin file.
        value = value.replace(/\b([a-h][1-8])\s+a\s+([a-h][1-8])\b/g, "$1 para $2");

        // These letter names are unambiguous even without an adjacent rank.
        value = value.replace(/\b(be|ce|efe|ge|aga)\b/g, function (_, spokenFile) {
            return SPOKEN_FILE_TO_FILE[spokenFile];
        });

        value = value
            .replace(/\b(?:captura|capturar|capture|capturando|toma|tomar|tome|come|xis|vezes|por)\b/g, " x ")
            .replace(/[×]/g, " x ")
            .replace(/[,+#!?;:()[\]{}'\"./\\]/g, " ")
            .replace(/-/g, " ")
            .replace(/\s*x\s*/g, " x ")
            .replace(/\s*=\s*/g, " = ")
            .replace(/__castle_queen__/g, " O-O-O ")
            .replace(/__castle_king__/g, " O-O ")
            .replace(/\s+/g, " ")
            .trim();

        return value;
    }

    function emptyIntent(normalized) {
        return {
            normalized: normalized,
            castle: null,
            piece: null,
            fromSquare: null,
            toSquare: null,
            originFile: null,
            originRank: null,
            capture: false,
            promotion: null
        };
    }

    function pieceFromToken(token) {
        if (token === "K" || token === "k") { return "k"; }
        if (token === "Q" || token === "q") { return "q"; }
        if (token === "R" || token === "r") { return "r"; }
        if (token === "B") { return "b"; }
        if (token === "N" || token === "n") { return "n"; }
        if (token === "P" || token === "p") { return "p"; }
        return null;
    }

    function promotionFromToken(token) {
        if (!token) { return null; }
        return PROMOTION_PIECES[String(token).toUpperCase()] || null;
    }

    function setIntentError(intent, reason) {
        intent.reason = reason;
        return intent;
    }

    function parseCompactMove(compact, intent, extractedPromotion) {
        // Lowercase b is intentionally not a piece symbol here: in SAN, bxc3
        // is a pawn from the b-file, while Bxc3 is a bishop capture.
        var match = compact.match(/^([KQRBNP]|[kqrnp])?([a-h])?([1-8])?(x)?([a-h][1-8])(?:=([QRBNqrbn]))?$/);
        if (!match) {
            return setIntentError(intent, "invalid-move-syntax");
        }

        var movingPiece = pieceFromToken(match[1]) || "p";
        var inlinePromotion = promotionFromToken(match[6]);
        if (inlinePromotion && extractedPromotion && inlinePromotion !== extractedPromotion) {
            return setIntentError(intent, "conflicting-promotion");
        }

        intent.piece = movingPiece;
        intent.originFile = match[2] || null;
        intent.originRank = match[3] || null;
        intent.fromSquare = intent.originFile && intent.originRank
            ? intent.originFile + intent.originRank
            : null;
        intent.toSquare = match[5];
        intent.capture = Boolean(match[4]);
        intent.promotion = inlinePromotion || extractedPromotion || null;

        if (intent.promotion && intent.piece !== "p") {
            return setIntentError(intent, "only-pawns-promote");
        }
        if (intent.fromSquare && intent.fromSquare === intent.toSquare) {
            return setIntentError(intent, "origin-equals-destination");
        }

        return intent;
    }

    /**
     * Parses normalized speech into structural chess constraints. Invalid input
     * still returns the complete intent shape and includes a machine-readable
     * `reason`; callers can pass it directly to matchMoveIntent.
     */
    function parseMoveIntent(input) {
        var normalized = normalizeSpeech(input);
        var intent = emptyIntent(normalized);

        if (!normalized) {
            return setIntentError(intent, "empty-input");
        }

        if (normalized === "O-O") {
            intent.castle = "king";
            intent.piece = "k";
            return intent;
        }
        if (normalized === "O-O-O") {
            intent.castle = "queen";
            intent.piece = "k";
            return intent;
        }

        var syntaxWords = {
            de: true,
            da: true,
            do: true,
            das: true,
            dos: true,
            para: true,
            ate: true,
            em: true,
            na: true,
            no: true,
            nas: true,
            nos: true,
            casa: true,
            coluna: true,
            fileira: true,
            linha: true,
            origem: true,
            destino: true,
            desde: true,
            pra: true,
            pro: true
        };
        var tokens = normalized.split(/\s+/).filter(function (token) {
            return token && !syntaxWords[token];
        });

        var equalsIndexes = [];
        tokens.forEach(function (token, index) {
            if (token === "=") { equalsIndexes.push(index); }
        });
        if (equalsIndexes.length > 1) {
            return setIntentError(intent, "invalid-promotion");
        }

        var extractedPromotion = null;
        if (equalsIndexes.length === 1) {
            var equalsIndex = equalsIndexes[0];
            extractedPromotion = promotionFromToken(tokens[equalsIndex + 1]);
            if (!extractedPromotion || equalsIndex + 2 !== tokens.length) {
                return setIntentError(intent, "invalid-promotion");
            }
            tokens.splice(equalsIndex, 2);
        } else if (tokens.length > 1) {
            // "e oito dama" is a natural spoken promotion even without the
            // explicit word "promoção".
            var trailingPromotion = promotionFromToken(tokens[tokens.length - 1]);
            if (trailingPromotion && /^[QRBN]$/.test(tokens[tokens.length - 1])) {
                extractedPromotion = trailingPromotion;
                tokens.pop();
            }
        }

        if (!tokens.length) {
            return setIntentError(intent, "missing-destination");
        }

        return parseCompactMove(tokens.join(""), intent, extractedPromotion);
    }

    function moveCastleSide(move) {
        if (!move || typeof move !== "object") { return null; }
        var flags = String(move.flags || "");
        if (flags.indexOf("q") !== -1) { return "queen"; }
        if (flags.indexOf("k") !== -1) { return "king"; }

        var san = String(move.san || "").replace(/[+#]+$/g, "").replace(/0/g, "O");
        if (san === "O-O-O") { return "queen"; }
        if (san === "O-O") { return "king"; }

        var from = String(move.from || "").toLowerCase();
        var to = String(move.to || "").toLowerCase();
        var piece = String(move.piece || "").toLowerCase();
        if (piece === "k" && (from === "e1" || from === "e8")) {
            if (to === "c1" || to === "c8") { return "queen"; }
            if (to === "g1" || to === "g8") { return "king"; }
        }
        return null;
    }

    function movePromotion(move) {
        if (move && move.promotion) {
            return String(move.promotion).toLowerCase();
        }
        var san = String(move && move.san || "");
        var match = san.match(/=([QRBN])/i);
        return match ? match[1].toLowerCase() : null;
    }

    function isCapture(move) {
        if (!move) { return false; }
        return Boolean(move.captured) || /[ce]/.test(String(move.flags || "")) || String(move.san || "").indexOf("x") !== -1;
    }

    /**
     * Matches an intent only against legal verbose moves. There is no fuzzy
     * scoring: a semantic field is either equal or the move is rejected.
     */
    function matchMoveIntent(intent, moves) {
        if (!intent || typeof intent !== "object" || intent.reason) {
            return { status: "no-match", reason: intent && intent.reason || "invalid-intent" };
        }
        if (!Array.isArray(moves)) {
            return { status: "no-match", reason: "invalid-moves" };
        }

        var candidates;
        if (intent.castle) {
            candidates = moves.filter(function (move) {
                return moveCastleSide(move) === intent.castle;
            });
        } else {
            if (!intent.toSquare || !intent.piece) {
                return { status: "no-match", reason: "invalid-intent" };
            }

            candidates = moves.filter(function (move) {
                if (!move || moveCastleSide(move)) { return false; }
                if (String(move.piece || "").toLowerCase() !== intent.piece) { return false; }
                if (String(move.to || "").toLowerCase() !== intent.toSquare) { return false; }

                var from = String(move.from || "").toLowerCase();
                if (intent.fromSquare && from !== intent.fromSquare) { return false; }
                if (intent.originFile && from.charAt(0) !== intent.originFile) { return false; }
                if (intent.originRank && from.charAt(1) !== intent.originRank) { return false; }
                if (intent.capture && !isCapture(move)) { return false; }

                var promotion = movePromotion(move);
                if (intent.promotion && promotion !== intent.promotion) { return false; }
                return true;
            });
        }

        if (!candidates.length) {
            return {
                status: "no-match",
                reason: intent.castle ? "castle-not-legal" : "no-legal-move"
            };
        }

        // Never silently choose a promotion type. A normal legal position has
        // four such candidates, but this also remains safe with partial inputs.
        if (!intent.castle && !intent.promotion && candidates.some(function (move) {
            return Boolean(movePromotion(move));
        })) {
            return candidates.length > 1
                ? { status: "ambiguous", candidates: candidates }
                : { status: "no-match", reason: "promotion-required" };
        }

        if (candidates.length === 1) {
            return { status: "matched", move: candidates[0] };
        }
        return { status: "ambiguous", candidates: candidates };
    }

    function formatSquare(square) {
        var normalized = String(square || "").toLowerCase();
        if (!/^[a-h][1-8]$/.test(normalized)) {
            return "";
        }
        return FILE_WORDS[normalized.charAt(0)] + " " + RANK_WORDS[normalized.charAt(1)];
    }

    function moveCheckSuffix(move) {
        var san = String(move && move.san || "");
        if (/#$/.test(san)) { return ", xeque-mate"; }
        if (/\+$/.test(san)) { return ", xeque"; }
        return "";
    }

    function verbalizeMove(move) {
        if (!move || typeof move !== "object") {
            return "";
        }

        var castle = moveCastleSide(move);
        if (castle) {
            return (castle === "queen" ? "Roque longo" : "Roque curto") + moveCheckSuffix(move);
        }

        var piece = String(move.piece || "").toLowerCase();
        var destination = formatSquare(move.to);
        if (!PIECE_WORDS[piece] || !destination) {
            return "";
        }

        var origin = formatSquare(move.from);
        var phrase = PIECE_WORDS[piece];
        if (origin) {
            phrase += " de " + origin;
        }
        phrase += isCapture(move) ? " captura " : " para ";
        phrase += destination;

        var promotion = movePromotion(move);
        if (promotion && PIECE_WORDS[promotion]) {
            phrase += ", promovendo a " + PIECE_WORDS[promotion].toLowerCase();
        }
        return phrase + moveCheckSuffix(move);
    }

    return {
        normalizeSpeech: normalizeSpeech,
        parseMoveIntent: parseMoveIntent,
        matchMoveIntent: matchMoveIntent,
        verbalizeMove: verbalizeMove,
        formatSquare: formatSquare
    };
}));
