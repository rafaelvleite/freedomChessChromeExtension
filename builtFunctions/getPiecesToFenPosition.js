function getPiecesToFEN() {
    var fenPosition = "";

    for (var i = 8; i >= 1; i--) {
        for (var j = 1; j <= 8; j++) {
            var classNameForPiece = '.piece.square-' + j + i;
            var pieceDiv = document.querySelector(classNameForPiece);

            if (pieceDiv) {
                var listOfClasses = pieceDiv.classList;
                for (var classInfo in listOfClasses) {
                    if (listOfClasses[classInfo][0] == "w") {
                        fenPosition = fenPosition + listOfClasses[classInfo][1].toUpperCase();
                    } else if (listOfClasses[classInfo][0] == "b") {
                        fenPosition = fenPosition + listOfClasses[classInfo][1].toLowerCase();
                    }
                }
            } else {
                if (j == 1) {
                    fenPosition = fenPosition + "1";
                } else if (!isNaN(fenPosition[fenPosition.length - 1])) {
                    var referenceNumber = fenPosition[fenPosition.length - 1];
                    var newNumber = parseInt(referenceNumber) + 1;
                    fenPosition = fenPosition.slice(0, -1);
                    fenPosition = fenPosition + newNumber;
                } else {
                    fenPosition = fenPosition + "1";
                }
            }
        }
        fenPosition = fenPosition + "/";
    }

    fenPosition = fenPosition.slice(0, -1);

    // Get player's turn from DOM
    const turnElement = document.querySelector('.section-heading-title.section-heading-normal');
    let playersTurn = 'w'; // Default to white's turn
    if (turnElement && turnElement.textContent.includes('pretas')) {
        playersTurn = 'b';
    }

    // Additional FEN fields: castling, en passant, halfmove clock, fullmove number
    const castling = 'KQkq';
    const enPassant = '-';
    const halfmoveClock = '0';
    const fullmoveNumber = '1';

    fenPosition = fenPosition + " " + playersTurn + " " + castling + " " + enPassant + " " + halfmoveClock + " " + fullmoveNumber;

    return fenPosition;
}