"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const core = require("../builtFunctions/core.js");

function move(from, to, piece, extra) {
    return Object.assign({ from, to, piece, flags: "n", san: to }, extra || {});
}

test("exports the same pure API in CommonJS and a browser global", () => {
    assert.deepEqual(Object.keys(core).sort(), [
        "formatSquare",
        "matchMoveIntent",
        "movePromotion",
        "normalizeSpeech",
        "parseMoveIntent",
        "rankMovesBySpeech",
        "spokenMoveVariants",
        "verbalizeMove"
    ]);

    const source = fs.readFileSync(path.join(__dirname, "../builtFunctions/core.js"), "utf8");
    const context = {};
    vm.runInNewContext(source, context);
    assert.equal(typeof context.FreedomChessCore.parseMoveIntent, "function");
});

test("normalizes destination squares, accents, spoken letters and ranks", () => {
    assert.equal(core.normalizeSpeech("e4"), "e4");
    assert.equal(core.normalizeSpeech("e quatro"), "e4");
    assert.equal(core.normalizeSpeech("é quatro"), "e4");
    assert.equal(core.normalizeSpeech("agá oito"), "h8");
    assert.equal(core.normalizeSpeech("cê sete"), "c7");

    for (const speech of ["e4", "e quatro", "é quatro"]) {
        assert.deepEqual(core.parseMoveIntent(speech), {
            normalized: "e4",
            castle: null,
            piece: "p",
            fromSquare: null,
            toSquare: "e4",
            originFile: null,
            originRank: null,
            capture: false,
            promotion: null
        });
    }
});

test("accepts robust spoken file names when the recognizer drops the vowel letter", () => {
    // A degraded recognizer returns "e4" as just "quatro" (the file letter is
    // clipped). Multi-syllable file names survive; the e-file gets the priority
    // set, including forms left when the mic clips their start.
    for (const speech of ["estrela quatro", "elefante quatro", "strela quatro", "peão estrela quatro"]) {
        assert.equal(core.parseMoveIntent(speech).toSquare, "e4", speech);
    }
    assert.equal(core.parseMoveIntent("ana quatro").toSquare, "a4");
    assert.equal(core.parseMoveIntent("gato três").toSquare, "g3");
    assert.equal(core.parseMoveIntent("hotel um").toSquare, "h1");
    const rook = core.parseMoveIntent("torre ana um");
    assert.equal(rook.piece, "r");
    assert.equal(rook.toSquare, "a1");

    // A file name outside a move stays harmless: no rank, no match.
    assert.equal(core.parseMoveIntent("estrela").reason, "invalid-move-syntax");
    // Normal moves are untouched by the alias step.
    assert.equal(core.parseMoveIntent("e4").toSquare, "e4");
    assert.equal(core.parseMoveIntent("cavalo f3").toSquare, "f3");
});

test("origin+destination coordinates identify the piece without naming it", () => {
    const legal = [
        move("e2", "e4", "p", { flags: 2, san: "e4" }),
        move("f2", "f3", "p", { flags: 0, san: "f3" }),
        move("g1", "f3", "n", { flags: 0, san: "Nf3" }),
        move("b1", "c3", "n", { flags: 0, san: "Nc3" })
    ];
    const played = (speech) => {
        const result = core.matchMoveIntent(core.parseMoveIntent(speech), legal);
        return result.status === "matched" ? result.move.from + result.move.to : result.status;
    };

    // A named origin square needs no piece word: it is whatever stands there.
    assert.equal(played("g1 f3"), "g1f3", "coordinate move finds the knight, not a pawn");
    assert.equal(played("e2 e4"), "e2e4");
    assert.equal(played("b1 c3"), "b1c3");

    // The mic clips the leading origin file; the surviving rank still recovers it.
    assert.equal(played("1 f3"), "g1f3", "origin rank alone recovers the knight");
    assert.equal(played("2 e4"), "e2e4");

    // A bare origin FILE with no rank is still SAN pawn notation, not coordinate.
    assert.equal(core.parseMoveIntent("c por dê quatro").piece, "p");
    // No origin at all defaults to a pawn.
    assert.equal(core.parseMoveIntent("e4").piece, "p");
    // A coordinate move carries no assumed piece.
    assert.equal(core.parseMoveIntent("g1 f3").piece, null);

    // A coordinate promotion still refuses to guess the piece, then accepts it.
    const promotions = ["q", "r", "b", "n"].map((promotion) =>
        move("e7", "e8", "p", { flags: "np", promotion, san: `e8=${promotion.toUpperCase()}` }));
    assert.equal(core.matchMoveIntent(core.parseMoveIntent("e7 e8"), promotions).status, "ambiguous");
    const named = core.matchMoveIntent(core.parseMoveIntent("e7 e8 dama"), promotions);
    assert.equal(named.status, "matched");
    assert.equal(named.move.promotion, "q");
});

test("parses every Portuguese piece name without semantic fuzziness", () => {
    const cases = [
        ["peão é quatro", "p", "e4"],
        ["cavalo efe três", "n", "f3"],
        ["bispo cê quatro", "b", "c4"],
        ["torre a um", "r", "a1"],
        ["dama agá cinco", "q", "h5"],
        ["rainha d um", "q", "d1"],
        ["rei gê um", "k", "g1"]
    ];

    for (const [speech, piece, destination] of cases) {
        const intent = core.parseMoveIntent(speech);
        assert.equal(intent.reason, undefined, speech);
        assert.equal(intent.piece, piece, speech);
        assert.equal(intent.toSquare, destination, speech);
    }
});

test("parses captures, full origins and file/rank disambiguation", () => {
    assert.deepEqual(core.parseMoveIntent("c por dê quatro"), {
        normalized: "c x d4",
        castle: null,
        piece: "p",
        fromSquare: null,
        toSquare: "d4",
        originFile: "c",
        originRank: null,
        capture: true,
        promotion: null
    });

    const fullOrigin = core.parseMoveIntent("cavalo de bê um para dê dois");
    assert.equal(fullOrigin.piece, "n");
    assert.equal(fullOrigin.fromSquare, "b1");
    assert.equal(fullOrigin.originFile, "b");
    assert.equal(fullOrigin.originRank, "1");
    assert.equal(fullOrigin.toSquare, "d2");

    const shortConnector = core.parseMoveIntent("cavalo de gê um a efe três");
    assert.equal(shortConnector.fromSquare, "g1");
    assert.equal(shortConnector.toSquare, "f3");

    const colloquialConnector = core.parseMoveIntent("cavalo do gê um pro efe três");
    assert.equal(colloquialConnector.fromSquare, "g1");
    assert.equal(colloquialConnector.toSquare, "f3");

    const originAFile = core.parseMoveIntent("torre da coluna a para dê um");
    assert.equal(originAFile.originFile, "a");
    assert.equal(originAFile.toSquare, "d1");

    const compactOriginAFile = core.parseMoveIntent("torre a dê um");
    assert.equal(compactOriginAFile.originFile, "a");
    assert.equal(compactOriginAFile.toSquare, "d1");

    const fileOrigin = core.parseMoveIntent("cavalo da coluna bê para dê dois");
    assert.equal(fileOrigin.fromSquare, null);
    assert.equal(fileOrigin.originFile, "b");
    assert.equal(fileOrigin.originRank, null);

    const rankOrigin = core.parseMoveIntent("cavalo da linha um para dê dois");
    assert.equal(rankOrigin.originFile, null);
    assert.equal(rankOrigin.originRank, "1");
});

test("matches only the exact piece and capture semantics requested", () => {
    const legalMoves = [
        move("c3", "d4", "p", { flags: "c", captured: "p", san: "cxd4" }),
        move("f3", "d4", "n", { flags: "c", captured: "p", san: "Nxd4" }),
        move("f3", "e5", "n", { san: "Ne5" })
    ];

    let result = core.matchMoveIntent(core.parseMoveIntent("c por dê quatro"), legalMoves);
    assert.equal(result.status, "matched");
    assert.equal(result.move.san, "cxd4");

    result = core.matchMoveIntent(core.parseMoveIntent("cavalo captura dê quatro"), legalMoves);
    assert.equal(result.status, "matched");
    assert.equal(result.move.san, "Nxd4");

    result = core.matchMoveIntent(core.parseMoveIntent("cavalo é cinco"), legalMoves);
    assert.equal(result.status, "matched");
    assert.equal(result.move.san, "Ne5");

    result = core.matchMoveIntent(core.parseMoveIntent("cavalo captura é cinco"), legalMoves);
    assert.deepEqual(result, { status: "no-match", reason: "no-legal-move" });
});

test("never resolves a tied knight move by array order", () => {
    const first = move("b1", "d2", "n", { san: "Nbd2" });
    const second = move("f3", "d2", "n", { san: "Nfd2" });
    const legalMoves = [first, second];

    const ambiguous = core.matchMoveIntent(core.parseMoveIntent("cavalo dê dois"), legalMoves);
    assert.equal(ambiguous.status, "ambiguous");
    assert.deepEqual(ambiguous.candidates, legalMoves);

    const byFile = core.matchMoveIntent(
        core.parseMoveIntent("cavalo da coluna bê para dê dois"),
        legalMoves
    );
    assert.equal(byFile.status, "matched");
    assert.equal(byFile.move, first);

    const bySquare = core.matchMoveIntent(
        core.parseMoveIntent("cavalo de efe três para dê dois"),
        legalMoves
    );
    assert.equal(bySquare.status, "matched");
    assert.equal(bySquare.move, second);
});

test("keeps kingside and queenside castling strictly separate", () => {
    const shortCastle = move("e1", "g1", "k", { flags: "k", san: "O-O" });
    const longCastle = move("e1", "c1", "k", { flags: "q", san: "O-O-O" });
    const legalMoves = [shortCastle, longCastle];

    for (const speech of ["roque", "roque curto", "pequeno roque", "O-O", "o o", "zero zero", "roque para o lado do rei"]) {
        const intent = core.parseMoveIntent(speech);
        assert.equal(intent.castle, "king", speech);
        const result = core.matchMoveIntent(intent, legalMoves);
        assert.equal(result.status, "matched", speech);
        assert.equal(result.move, shortCastle, speech);
    }

    for (const speech of ["roque longo", "grande roque", "roque do lado da dama", "O-O-O", "o o o", "zero zero zero", "roque para o lado da dama"]) {
        const intent = core.parseMoveIntent(speech);
        assert.equal(intent.castle, "queen", speech);
        const result = core.matchMoveIntent(intent, legalMoves);
        assert.equal(result.status, "matched", speech);
        assert.equal(result.move, longCastle, speech);
    }

    assert.deepEqual(
        core.matchMoveIntent(core.parseMoveIntent("grande roque"), [shortCastle]),
        { status: "no-match", reason: "castle-not-legal" }
    );

    // A pt-BR recognizer in a degraded mode returns the English "rock" for
    // "roque". Every homophone must still castle, kingside by default.
    for (const speech of ["rock", "rocky", "rogue", "hoque", "rock curto"]) {
        const intent = core.parseMoveIntent(speech);
        assert.equal(intent.castle, "king", speech);
        assert.equal(core.matchMoveIntent(intent, legalMoves).move, shortCastle, speech);
    }
    for (const speech of ["grande rock", "rock grande", "rock longo"]) {
        const intent = core.parseMoveIntent(speech);
        assert.equal(intent.castle, "queen", speech);
        assert.equal(core.matchMoveIntent(intent, legalMoves).move, longCastle, speech);
    }

    // The king only ever travels two files by castling, so a bare coordinate
    // move off its home square is a castle even with no piece word.
    for (const speech of ["e1 g1", "e um g um", "rei e1 g1"]) {
        const intent = core.parseMoveIntent(speech);
        assert.equal(intent.castle, "king", speech);
        assert.equal(core.matchMoveIntent(intent, legalMoves).move, shortCastle, speech);
    }
    assert.equal(core.parseMoveIntent("e1 c1").castle, "queen");
    assert.equal(core.parseMoveIntent("e8 g8").castle, "king");

    // A normal one- or two-square move must NOT be mistaken for a castle.
    assert.equal(core.parseMoveIntent("e2 e4").castle, null);
    assert.equal(core.parseMoveIntent("e1 e2").castle, null);
});

test("requires and exactly matches the requested promotion piece", () => {
    const promotions = ["q", "r", "b", "n"].map((promotion) =>
        move("e7", "e8", "p", {
            flags: "np",
            promotion,
            san: `e8=${promotion.toUpperCase()}`
        })
    );

    const missingPiece = core.matchMoveIntent(core.parseMoveIntent("é oito"), promotions);
    assert.equal(missingPiece.status, "ambiguous");
    assert.equal(missingPiece.candidates.length, 4);

    // Load-bearing string: the single-candidate promotion guard. Renaming it
    // must fail here, not silently downgrade a promotion to a queen.
    assert.deepEqual(
        core.matchMoveIntent(core.parseMoveIntent("é oito"), [promotions[0]]),
        { status: "no-match", reason: "promotion-required" }
    );
    // SAN is the only promotion evidence Chess.com sometimes sends.
    assert.equal(core.movePromotion({ from: "e7", to: "e8", san: "e8=N" }), "n");
    assert.equal(core.movePromotion({ from: "e7", to: "e8", promotion: "Q" }), "q");
    assert.equal(core.movePromotion({ from: "g1", to: "f3", san: "Nf3" }), null);

    for (const [speech, promotion] of [
        ["é oito promoção dama", "q"],
        ["é oito torre", "r"],
        ["é oito promovendo a bispo", "b"],
        ["é oito vira cavalo", "n"]
    ]) {
        const intent = core.parseMoveIntent(speech);
        assert.equal(intent.promotion, promotion, speech);
        const result = core.matchMoveIntent(intent, promotions);
        assert.equal(result.status, "matched", speech);
        assert.equal(result.move.promotion, promotion, speech);
    }

    const capturePromotions = ["q", "r", "b", "n"].map((promotion) =>
        move("d7", "e8", "p", {
            flags: "cp",
            captured: "r",
            promotion,
            san: `dxe8=${promotion.toUpperCase()}`
        })
    );
    const captureKnight = core.matchMoveIntent(
        core.parseMoveIntent("d por é oito promoção cavalo"),
        capturePromotions
    );
    assert.equal(captureKnight.status, "matched");
    assert.equal(captureKnight.move.promotion, "n");
});

test("verbalizes squares and verbose moves in Brazilian Portuguese", () => {
    assert.equal(core.formatSquare("a1"), "a um");
    assert.equal(core.formatSquare("e4"), "é quatro");
    assert.equal(core.formatSquare("H8"), "agá oito");
    assert.equal(core.formatSquare("z9"), "");

    assert.equal(
        core.verbalizeMove(move("g1", "f3", "n", { san: "Nf3" })),
        "Cavalo de gê um para efe três"
    );
    assert.equal(
        core.verbalizeMove(move("c4", "f7", "b", { flags: "c", captured: "p", san: "Bxf7+" })),
        "Bispo de cê quatro captura efe sete, xeque"
    );
    assert.equal(
        core.verbalizeMove(move("e7", "e8", "p", { flags: "np", promotion: "q", san: "e8=Q#" })),
        "Peão de é sete para é oito, promovendo a dama, xeque-mate"
    );
    assert.equal(
        core.verbalizeMove(move("e1", "c1", "k", { flags: "q", san: "O-O-O" })),
        "Roque longo"
    );

    // The screen gets real algebraic squares; the synthesizer keeps the
    // spelled-out letter names it needs to pronounce them correctly.
    assert.equal(core.formatSquare("a1", { plain: true }), "a1");
    assert.equal(core.formatSquare("H8", { plain: true }), "h8");
    assert.equal(core.formatSquare("z9", { plain: true }), "");
    assert.equal(
        core.verbalizeMove(move("g1", "f3", "n", { san: "Nf3" }), { plain: true }),
        "Cavalo de g1 para f3"
    );
    assert.equal(
        core.verbalizeMove(move("c4", "f7", "b", { flags: "c", captured: "p", san: "Bxf7+" }), { plain: true }),
        "Bispo de c4 captura f7, xeque"
    );
    assert.equal(
        core.verbalizeMove(move("e1", "c1", "k", { flags: "q", san: "O-O-O" }), { plain: true }),
        "Roque longo"
    );
});

test("understands the capitalized transcripts Chrome actually produces", () => {
    // Chrome capitalizes the first word of every recognition result. Protecting
    // SAN symbols before case folding turned "Rei g1" into the rook symbol and
    // broke every spoken piece name; the whole suite used to be lowercase only.
    const legalMoves = [
        move("e1", "f1", "k", { san: "Kf1" }),
        move("d1", "h5", "q", { san: "Qh5" }),
        move("e2", "e4", "p", { flags: 2, san: "e4" }),
        move("f1", "b5", "b", { san: "Bb5" }),
        move("a3", "b4", "p", { san: "b4" }),
        move("g1", "f3", "n", { san: "Nf3" })
    ];

    const cases = [
        ["Rei f1", "Kf1"],
        ["Rainha h5", "Qh5"],
        ["Peão e4", "e4"],
        ["Peão para e quatro", "e4"],
        ["Bispo B5", "Bb5"],
        ["B4", "b4"],
        ["Cavalo efe três", "Nf3"],
        ["Cavalo F3", "Nf3"]
    ];

    for (const [speech, san] of cases) {
        const result = core.matchMoveIntent(core.parseMoveIntent(speech), legalMoves);
        assert.equal(result.status, "matched", speech);
        assert.equal(result.move.san, san, speech);
    }

    // Written SAN, including rank/file disambiguation, must keep working.
    for (const [speech, san] of [["Nf3", "Nf3"], ["Qh5", "Qh5"], ["Bb5", "Bb5"]]) {
        const result = core.matchMoveIntent(core.parseMoveIntent(speech), legalMoves);
        assert.equal(result.status, "matched", speech);
        assert.equal(result.move.san, san, speech);
    }
});

test("reads the numeric move flags Chess.com sends, not chess.js's", () => {
    // Chess.com's own enum, verified in its live client bundles:
    // CAPTURE 1, BIG_PAWN 2, EP_CAPTURE 4, PROMOTION 8, KSIDE 16, QSIDE 32, DROP 64.
    assert.equal(core.verbalizeMove({ from: "e1", to: "g1", piece: "k", flags: 16 }), "Roque curto");
    assert.equal(core.verbalizeMove({ from: "e1", to: "c1", piece: "k", flags: 32 }), "Roque longo");

    // Capture detection used to depend entirely on `san` containing an "x".
    assert.equal(
        core.verbalizeMove({ from: "f3", to: "e5", piece: "n", flags: 1 }),
        "Cavalo de efe três captura é cinco"
    );
    assert.equal(
        core.verbalizeMove({ from: "d5", to: "e6", piece: "p", flags: 4 }),
        "Peão de dê cinco captura é seis"
    );

    // The reported bug: a double pawn push carries BIG_PAWN, not CAPTURE.
    assert.equal(
        core.verbalizeMove({ color: 2, from: "e7", to: "e5", piece: "p", flags: 2, san: "e5" }),
        "Peão de é sete para é cinco"
    );
    // A quiet promotion carries PROMOTION, which is not a capture either.
    assert.equal(
        core.verbalizeMove({ from: "e7", to: "e8", piece: "p", flags: 8, promotion: "q", san: "e8=Q" }),
        "Peão de é sete para é oito, promovendo a dama"
    );

    const numericCapture = { from: "f3", to: "e5", piece: "n", flags: 1 };
    const result = core.matchMoveIntent(core.parseMoveIntent("cavalo captura é cinco"), [numericCapture]);
    assert.equal(result.status, "matched");

    // A quiet numeric move must not be mistaken for a capture.
    assert.equal(
        core.matchMoveIntent(core.parseMoveIntent("cavalo captura é cinco"), [
            { from: "f3", to: "e5", piece: "n", flags: 0 }
        ]).status,
        "no-match"
    );

    // A queenside castle must never be announced or matched as a short castle.
    const castles = [
        { from: "e1", to: "g1", piece: "k", flags: 16, san: "O-O" },
        { from: "e1", to: "c1", piece: "k", flags: 32, san: "O-O-O" }
    ];
    assert.equal(core.matchMoveIntent(core.parseMoveIntent("roque longo"), castles).move, castles[1]);
    assert.equal(core.matchMoveIntent(core.parseMoveIntent("roque curto"), castles).move, castles[0]);
});

test("treats x as a capture marker only when it stands alone", () => {
    assert.equal(core.normalizeSpeech("xeque"), "xeque");
    assert.equal(core.normalizeSpeech("proximo"), "proximo");
    assert.equal(core.normalizeSpeech("exato"), "exato");
    assert.equal(core.normalizeSpeech("cavalo x e5"), "N x e5");
});

test("suggests the closest legal move for a garbled transcript, never silently", () => {
    const knight = move("g1", "f3", "n", { san: "Nf3" });
    const bishop = move("f1", "c4", "b", { san: "Bc4" });
    const castle = move("e1", "g1", "k", { flags: 16, san: "O-O" });
    const legalMoves = [knight, bishop, castle];

    for (const [speech, expected] of [
        ["cavalo éfi três", knight],
        ["cavalo efe treis", knight],
        ["bispo cê quatru", bishop],
        ["roqui curto", castle]
    ]) {
        const ranked = core.rankMovesBySpeech(speech, legalMoves);
        assert.ok(ranked.length > 0, speech);
        assert.equal(ranked[0].move, expected, speech);
        assert.ok(ranked[0].score >= 0.6, speech);
    }

    // Unrelated speech must not produce a suggestion at all.
    assert.deepEqual(core.rankMovesBySpeech("qual é o placar do jogo", legalMoves), []);
    assert.deepEqual(core.rankMovesBySpeech("", legalMoves), []);
    assert.deepEqual(core.rankMovesBySpeech("cavalo f3", null), []);
});

test("hints the recognizer with phrases a player says, not synthesizer output", () => {
    assert.deepEqual(core.spokenMoveVariants(move("g1", "f3", "n", { san: "Nf3" })), [
        "cavalo f3",
        "cavalo efe três",
        "cavalo de g1 para f3",
        "cavalo de gê um para efe três",
        "g1 f3",
        "gê um efe três"
    ]);

    // Pawns are named by their square alone, the way players speak.
    assert.deepEqual(core.spokenMoveVariants(move("e2", "e4", "p", { flags: 2, san: "e4" })), [
        "e4",
        "é quatro",
        "de e2 para e4",
        "de é dois para é quatro",
        "e2 e4",
        "é dois é quatro"
    ]);

    assert.deepEqual(
        core.spokenMoveVariants(move("e1", "c1", "k", { flags: 32, san: "O-O-O" })),
        ["roque longo", "roque grande"]
    );

    assert.ok(
        core.spokenMoveVariants(move("f3", "e5", "n", { flags: 1, san: "Nxe5" }))
            .includes("cavalo captura e5")
    );
    assert.deepEqual(core.spokenMoveVariants(null), []);
});

test("returns stable no-match results for malformed or absent input", () => {
    assert.deepEqual(core.matchMoveIntent(core.parseMoveIntent(""), []), {
        status: "no-match",
        reason: "empty-input"
    });
    assert.deepEqual(core.matchMoveIntent(core.parseMoveIntent("cavalo talvez banana"), []), {
        status: "no-match",
        reason: "invalid-move-syntax"
    });
    assert.deepEqual(core.matchMoveIntent(core.parseMoveIntent("e4"), null), {
        status: "no-match",
        reason: "invalid-moves"
    });
});
