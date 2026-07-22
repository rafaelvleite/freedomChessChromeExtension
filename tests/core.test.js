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
});

test("understands the capitalized transcripts Chrome actually produces", () => {
    // Chrome capitalizes the first word of every recognition result. Protecting
    // SAN symbols before case folding turned "Rei g1" into the rook symbol and
    // broke every spoken piece name; the whole suite used to be lowercase only.
    const legalMoves = [
        move("e1", "f1", "k", { san: "Kf1" }),
        move("d1", "h5", "q", { san: "Qh5" }),
        move("e2", "e4", "p", { flags: 4, san: "e4" }),
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

test("reads the numeric move flags Chess.com sends, not only chess.js letters", () => {
    assert.equal(core.verbalizeMove({ from: "e1", to: "g1", piece: "k", flags: 32 }), "Roque curto");
    assert.equal(core.verbalizeMove({ from: "e1", to: "c1", piece: "k", flags: 64 }), "Roque longo");

    // Capture detection used to depend entirely on `san` containing an "x".
    assert.equal(
        core.verbalizeMove({ from: "f3", to: "e5", piece: "n", flags: 2 }),
        "Cavalo de efe três captura é cinco"
    );
    assert.equal(
        core.verbalizeMove({ from: "d5", to: "e6", piece: "p", flags: 8 }),
        "Peão de dê cinco captura é seis"
    );

    const numericCapture = { from: "f3", to: "e5", piece: "n", flags: 2 };
    const result = core.matchMoveIntent(core.parseMoveIntent("cavalo captura é cinco"), [numericCapture]);
    assert.equal(result.status, "matched");

    // A quiet numeric move must not be mistaken for a capture.
    assert.equal(
        core.matchMoveIntent(core.parseMoveIntent("cavalo captura é cinco"), [
            { from: "f3", to: "e5", piece: "n", flags: 1 }
        ]).status,
        "no-match"
    );
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
    const castle = move("e1", "g1", "k", { flags: 32, san: "O-O" });
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
        "cavalo de gê um para efe três"
    ]);

    // Pawns are named by their square alone, the way players speak.
    assert.deepEqual(core.spokenMoveVariants(move("e2", "e4", "p", { flags: 4, san: "e4" })), [
        "e4",
        "é quatro",
        "de e2 para e4",
        "de é dois para é quatro"
    ]);

    assert.deepEqual(
        core.spokenMoveVariants(move("e1", "c1", "k", { flags: 64, san: "O-O-O" })),
        ["roque longo", "roque grande"]
    );

    assert.ok(
        core.spokenMoveVariants(move("f3", "e5", "n", { flags: 2, san: "Nxe5" }))
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
