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

    // Robust spoken names for the files. The single-vowel letter names ("é" for
    // e, "á" for a) are so short that a degraded recognizer drops or confuses
    // them ("e4" came back as just "quatro", or as "a4"). These multi-syllable
    // words survive, and each was checked not to collide with any piece / number
    // / castle / request / syntax word the parser already handles. "e" gets
    // estrela/elefante rather than "eva" because a word that also LEADS with the
    // weak vowel reproduces the very bug. Said before a rank, e.g. "estrela
    // quatro" -> e4; the letter it maps to then flows through the normal rules.
    var FILE_ALIAS_TO_FILE = {
        ana: "a", alfa: "a", amor: "a",
        bravo: "b", bruno: "b", bandeira: "b",
        carlos: "c", cadeira: "c",
        daniel: "d", dado: "d",
        estrela: "e", elefante: "e",
        // Forms left when the mic clips the start of the e-file words.
        strela: "e", trela: "e", lefante: "e", elefant: "e",
        ferro: "f", felipe: "f",
        gato: "g", gustavo: "g",
        hotel: "h", hugo: "h", harpa: "h"
    };

    var FILE_ALIAS_PATTERN = new RegExp(
        "\\b(" + Object.keys(FILE_ALIAS_TO_FILE).join("|") + ")\\b",
        "g"
    );

    var PROMOTION_PIECES = { Q: "q", R: "r", B: "b", N: "n" };

    // A king only ever travels two files by castling, so a coordinate move off
    // its home square to g/c is unambiguously a castle. Lets "e1 g1" cast when
    // the recognizer mangles the word "roque" beyond repair.
    var CASTLE_BY_KING_TRAVEL = {
        e1g1: "king", e8g8: "king",
        e1c1: "queen", e8c8: "queen"
    };

    // Chess.com's board engine ships its OWN numeric bitmask, and it is NOT
    // chess.js's. Verified verbatim in two independent live client bundles:
    //   {CAPTURE:1,BIG_PAWN:2,EP_CAPTURE:4,ANY_CAPTURE:5,PROMOTION:8,
    //    KSIDE_CASTLE:16,QSIDE_CASTLE:32,KQSIDE_CASTLE:48,DROP:64}
    // Reading those numbers as chess.js BITS made every double pawn push
    // (BIG_PAWN 2 vs CAPTURE 2) announce "captura" and every long castle
    // (QSIDE 32 vs KSIDE 32) announce "Roque curto".
    // chess.js's public API never emits numbers at all — make_pretty converts
    // BITS to the letter form — so a numeric `flags` can only come from
    // Chess.com. They are nevertheless consulted LAST: every decision below
    // prefers evidence that does not depend on a vendor encoding.
    var FLAG_BITS = {
        capture: 1,
        bigPawn: 2,
        epCapture: 4,
        promotion: 8,
        kingsideCastle: 16,
        queensideCastle: 32,
        drop: 64
    };

    var SQUARE_PATTERN = /^[a-h][1-8]$/;

    // The alphabet chess.js builds its letter flags from. Any other string is
    // an unknown vocabulary and must not be mined for stray characters.
    var LETTER_FLAG_PATTERN = /^[nbcepkq]+$/;

    var SAN_PATTERN = /^(?:O-O(?:-O)?|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?)[+#]?$/;

    function numericFlags(move) {
        var flags = move && move.flags;
        return typeof flags === "number" && isFinite(flags) ? flags : 0;
    }

    function letterFlags(move) {
        return move && typeof move.flags === "string" ? move.flags : "";
    }

    // Only a well-formed SAN is trustworthy enough to overrule a flag.
    function canonicalSan(move) {
        var san = String(move && move.san || "").replace(/0/g, "O");
        return SAN_PATTERN.test(san) ? san : "";
    }

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

        // The lookahead must require a real square. Chrome capitalizes the first
        // word of every transcript, so a loose lookahead turns "Rei g1" into the
        // rook symbol and "Peão e4" into a stray pawn symbol.
        return value.replace(/(^|[\s=])([KQRBNP])(?=[a-h]?[1-8]?x?[a-h][1-8]|\s|=|$)/g, function (_, prefix, piece) {
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

        var value = String(input).trim();
        if (!value) {
            return "";
        }

        if (typeof value.normalize === "function") {
            value = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        }

        // Piece symbols are protected after accent folding but before lowercasing.
        // Doing it on the raw transcript destroyed every capitalized Portuguese
        // piece name the recognizer produces ("Rei", "Rainha", "Pe\u00e3o").
        value = protectWrittenPieceSymbols(value);
        value = value.toLowerCase();

        // A pt-BR recognizer running in a degraded/foreign mode transcribes
        // "roque" (/ˈʁɔ.ki/) as the English "rock" and its neighbours. Folding
        // them back to "roque" lets the castling logic below do its job. "rook"
        // is deliberately absent: that is the English word for a rook (torre).
        value = value.replace(/\b(?:rock|rocky|rockie|roque|roqui|roquy|rok|roc|hoque|hoqui|hock|rogue)\b/g, "roque");

        // Robust file names -> the file letter, before the piece / number /
        // castle rules run. None of the aliases is a castle word, so order with
        // the block below does not matter; doing it early just keeps the letter
        // available for the "<file><rank>" rule. A bare letter with no rank
        // simply fails to match later, so an alias in non-move speech degrades
        // to no-match, never a wrong move.
        value = value.replace(FILE_ALIAS_PATTERN, function (_, alias) {
            return " " + FILE_ALIAS_TO_FILE[alias] + " ";
        });

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
            // Only a standalone "x" is a capture marker. Without the word
            // boundaries this rewrote "xeque" as "x eque" and "exato" as "e x ato".
            .replace(/\s*\bx\b\s*/g, " x ")
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

        var explicitPiece = pieceFromToken(match[1]);
        var originFile = match[2] || null;
        var originRank = match[3] || null;
        // An origin RANK identifies the piece by whatever stands on that square,
        // so no piece word is needed: "g1 f3" is the knight, not a (non-existent)
        // pawn, and it still works as "1 f3" when the mic clips the origin file.
        // A bare origin FILE with no rank stays a PAWN — that is SAN pawn-capture
        // notation ("cxd4" is a c-file pawn), not a coordinate. No origin at all
        // is also a pawn, the SAN convention for "e4".
        var movingPiece = explicitPiece || (originRank ? null : "p");
        var inlinePromotion = promotionFromToken(match[6]);
        if (inlinePromotion && extractedPromotion && inlinePromotion !== extractedPromotion) {
            return setIntentError(intent, "conflicting-promotion");
        }

        intent.piece = movingPiece;
        intent.originFile = originFile;
        intent.originRank = originRank;
        intent.fromSquare = intent.originFile && intent.originRank
            ? intent.originFile + intent.originRank
            : null;
        intent.toSquare = match[5];
        intent.capture = Boolean(match[4]);
        intent.promotion = inlinePromotion || extractedPromotion || null;

        // Only reject a promotion when a NON-pawn piece was explicitly named; an
        // unconstrained coordinate move ("e7 e8 dama") is fine because the legal
        // move list still requires a pawn there.
        if (intent.promotion && intent.piece && intent.piece !== "p") {
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

        var parsed = parseCompactMove(tokens.join(""), intent, extractedPromotion);

        // A fully-specified coordinate move off a king's home square, two files
        // sideways, is a castle whatever piece word (if any) was spoken -- a
        // king only travels two files by castling. This is what lets "e1 g1"
        // or "rei e1 g1" work when the recognizer garbles "roque". A coordinate
        // move parses with a null piece now, so that counts too; only an
        // explicit NON-king piece is excluded.
        if (!parsed.reason && !parsed.castle && parsed.fromSquare
                && parsed.piece !== "n" && parsed.piece !== "b"
                && parsed.piece !== "r" && parsed.piece !== "q") {
            var side = CASTLE_BY_KING_TRAVEL[parsed.fromSquare + parsed.toSquare];
            if (side) {
                parsed.castle = side;
                parsed.piece = "k";
                parsed.capture = false;
                parsed.promotion = null;
            }
        }

        return parsed;
    }

    /**
     * Encoding-independent evidence first: SAN, then chess.js letter flags,
     * then king geometry. The numeric bitmask is consulted only when nothing
     * else can answer, because a stray bit here does not merely mislabel a
     * move -- matchMoveIntent drops every castle-flagged move from the normal
     * candidate list, making it unplayable by voice.
     */
    function moveCastleSide(move) {
        if (!move || typeof move !== "object") { return null; }

        var san = canonicalSan(move).replace(/[+#]+$/g, "");
        if (san === "O-O-O") { return "queen"; }
        if (san === "O-O") { return "king"; }

        var from = String(move.from || "").toLowerCase();
        var to = String(move.to || "").toLowerCase();
        var piece = String(move.piece || "").toLowerCase();

        // A move that names a non-king piece, or that already produced a
        // well-formed non-castling SAN, is definitively not a castle.
        if ((piece && piece !== "k") || san) { return null; }

        var flags = letterFlags(move);
        if (LETTER_FLAG_PATTERN.test(flags)) {
            if (flags.indexOf("q") !== -1) { return "queen"; }
            if (flags.indexOf("k") !== -1) { return "king"; }
        }

        if (piece === "k" && (from === "e1" || from === "e8")) {
            if (to === "c1" || to === "c8") { return "queen"; }
            if (to === "g1" || to === "g8") { return "king"; }
        }

        var bits = numericFlags(move);
        if (bits & FLAG_BITS.queensideCastle) { return "queen"; }
        if (bits & FLAG_BITS.kingsideCastle) { return "king"; }
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

    /**
     * Ordered ladder: the first trustworthy signal answers, in BOTH directions.
     * The previous version was four OR-ed positive tests over a guessed
     * bitmask, so a correct `san` could never overrule a misread flag.
     */
    function isCapture(move) {
        if (!move || typeof move !== "object") { return false; }

        var piece = String(move.piece || "").toLowerCase();
        var from = String(move.from || "").toLowerCase();
        var to = String(move.to || "").toLowerCase();

        // A rule of chess, so it outranks every vendor-supplied field: a pawn
        // changes file if and only if it captures (en passant included).
        if (piece === "p" && SQUARE_PATTERN.test(from) && SQUARE_PATTERN.test(to)) {
            return from.charAt(0) !== to.charAt(0);
        }

        // A captured piece identifier is direct positive evidence. Only a
        // truthy primitive counts: an object survives the bridge clone as a
        // truthy `{}` and would fabricate captures.
        var captured = move.captured;
        if (typeof captured === "string" ? captured !== "" : typeof captured === "number" && captured !== 0) {
            return true;
        }

        // Well-formed SAN is decisive both ways: "x" appears in no other token.
        var san = canonicalSan(move);
        if (san) { return san.indexOf("x") !== -1; }

        var flags = letterFlags(move);
        if (LETTER_FLAG_PATTERN.test(flags)) { return /[ce]/.test(flags); }

        return (numericFlags(move) & (FLAG_BITS.capture | FLAG_BITS.epCapture)) !== 0;
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
            if (!intent.toSquare) {
                return { status: "no-match", reason: "invalid-intent" };
            }

            candidates = moves.filter(function (move) {
                if (!move || moveCastleSide(move)) { return false; }
                // A null piece is an unconstrained coordinate move: the origin
                // square (or rank) below is what identifies the piece.
                if (intent.piece && String(move.piece || "").toLowerCase() !== intent.piece) { return false; }
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

    /**
     * Default output is the spelled-out pronunciation ("é sete"), which is what
     * the synthesizer and the recognizer hints need. `{ plain: true }` returns
     * the algebraic form ("e7") for anything a human reads on screen -- the
     * letter names are pronunciation aids, not Portuguese.
     */
    function formatSquare(square, options) {
        var normalized = String(square || "").toLowerCase();
        if (!SQUARE_PATTERN.test(normalized)) {
            return "";
        }
        if (options && options.plain) {
            return normalized;
        }
        return FILE_WORDS[normalized.charAt(0)] + " " + RANK_WORDS[normalized.charAt(1)];
    }

    function moveCheckSuffix(move) {
        var san = String(move && move.san || "");
        if (/#$/.test(san)) { return ", xeque-mate"; }
        if (/\+$/.test(san)) { return ", xeque"; }
        return "";
    }

    function verbalizeMove(move, options) {
        if (!move || typeof move !== "object") {
            return "";
        }

        var castle = moveCastleSide(move);
        if (castle) {
            return (castle === "queen" ? "Roque longo" : "Roque curto") + moveCheckSuffix(move);
        }

        var piece = String(move.piece || "").toLowerCase();
        var destination = formatSquare(move.to, options);
        if (!PIECE_WORDS[piece] || !destination) {
            return "";
        }

        var origin = formatSquare(move.from, options);
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

    /**
     * The phrases a Brazilian player actually says for a move. These are the
     * strings worth feeding to the recognizer as contextual hints, and the ones
     * to compare a garbled transcript against. `verbalizeMove` output is not:
     * nobody says "Cavalo de gê um para efe três".
     */
    function spokenMoveVariants(move) {
        if (!move || typeof move !== "object") {
            return [];
        }

        var castle = moveCastleSide(move);
        if (castle) {
            return castle === "queen"
                ? ["roque longo", "roque grande"]
                : ["roque curto", "roque pequeno"];
        }

        var piece = String(move.piece || "").toLowerCase();
        var to = String(move.to || "").toLowerCase();
        var from = String(move.from || "").toLowerCase();
        if (!PIECE_WORDS[piece] || !/^[a-h][1-8]$/.test(to)) {
            return [];
        }

        var pieceWord = piece === "p" ? "" : PIECE_WORDS[piece].toLowerCase() + " ";
        var spelled = formatSquare(to);
        var link = isCapture(move) ? "captura " : "";
        var variants = [
            pieceWord + link + to,
            pieceWord + link + spelled
        ];

        if (/^[a-h][1-8]$/.test(from)) {
            variants.push(pieceWord + "de " + from + " para " + to);
            variants.push(pieceWord + "de " + formatSquare(from) + " para " + spelled);
            // Bare origin+destination coordinates, the instructed form ("e2 e4",
            // "é dois é quatro"), so the recognizer expects and returns them.
            variants.push(from + " " + to);
            variants.push(formatSquare(from) + " " + spelled);
        }

        var promotion = movePromotion(move);
        if (promotion && PIECE_WORDS[promotion]) {
            var promotionWord = " promoção " + PIECE_WORDS[promotion].toLowerCase();
            variants = variants.map(function (variant) {
                return variant + promotionWord;
            });
        }

        return variants;
    }

    function foldText(value) {
        var folded = String(value === null || value === undefined ? "" : value);
        if (typeof folded.normalize === "function") {
            folded = folded.normalize("NFD").replace(/[̀-ͯ]/g, "");
        }
        return folded
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function levenshtein(left, right) {
        if (left === right) { return 0; }
        if (!left.length) { return right.length; }
        if (!right.length) { return left.length; }

        var previous = new Array(right.length + 1);
        for (var column = 0; column <= right.length; column += 1) {
            previous[column] = column;
        }

        for (var row = 1; row <= left.length; row += 1) {
            var current = [row];
            for (var index = 1; index <= right.length; index += 1) {
                var cost = left.charAt(row - 1) === right.charAt(index - 1) ? 0 : 1;
                current[index] = Math.min(
                    current[index - 1] + 1,
                    previous[index] + 1,
                    previous[index - 1] + cost
                );
            }
            previous = current;
        }

        return previous[right.length];
    }

    function similarity(left, right) {
        var longest = Math.max(left.length, right.length);
        if (!longest) { return 0; }
        return (longest - levenshtein(left, right)) / longest;
    }

    /**
     * Best-effort rescue for a transcript that matched no legal move exactly.
     * It never decides anything on its own: callers must confirm the suggestion
     * with the player before touching the board.
     */
    function rankMovesBySpeech(transcript, moves, options) {
        var settings = options || {};
        var minimumScore = typeof settings.minimumScore === "number" ? settings.minimumScore : 0.6;
        var limit = typeof settings.limit === "number" ? settings.limit : 3;

        var spokenRaw = foldText(transcript);
        var spokenNormalized = foldText(normalizeSpeech(transcript));
        if (!spokenRaw || !Array.isArray(moves)) {
            return [];
        }

        var ranked = [];
        for (var index = 0; index < moves.length; index += 1) {
            var move = moves[index];
            var variants = spokenMoveVariants(move);
            var best = 0;

            for (var variant = 0; variant < variants.length; variant += 1) {
                var candidateRaw = foldText(variants[variant]);
                var candidateNormalized = foldText(normalizeSpeech(variants[variant]));
                if (candidateRaw) {
                    best = Math.max(best, similarity(spokenRaw, candidateRaw));
                }
                if (candidateNormalized && spokenNormalized) {
                    best = Math.max(best, similarity(spokenNormalized, candidateNormalized));
                }
            }

            if (best >= minimumScore) {
                ranked.push({ move: move, score: best });
            }
        }

        ranked.sort(function (left, right) {
            return right.score - left.score;
        });
        return ranked.slice(0, Math.max(1, limit));
    }

    return {
        normalizeSpeech: normalizeSpeech,
        parseMoveIntent: parseMoveIntent,
        matchMoveIntent: matchMoveIntent,
        verbalizeMove: verbalizeMove,
        formatSquare: formatSquare,
        spokenMoveVariants: spokenMoveVariants,
        rankMovesBySpeech: rankMovesBySpeech,
        movePromotion: movePromotion
    };
}));
