// Debug for x y coordinates on screen
function enableMouseCoordinatesDebug() {
    document.onmousemove = function(e){
    var x = e.pageX;
    var y = e.pageY;
    e.target.title = "X is "+x+" and Y is "+y;
    };
}


// make the move
function makeMove(source, destination) {

    // get player color
    var playerColor = getPlayerColor();
    
    // get board to get screen position and offsets and also square width
    const gameBoard = document.querySelector('.board');
    const offsetX = gameBoard.getBoundingClientRect().x;
    const offsetY = gameBoard.getBoundingClientRect().y;
    const squareWidth = gameBoard.getBoundingClientRect().width / 8;
    const bubbles = true;
    
    // dicionário de conversão de casa em coordenadas
    var dict = { "a": 1, "b": 2, "c": 3, "d": 4, "e": 5, "f": 6, "g": 7, "h": 8 };
    
    // origin square click
    var sourceColumn = source[0];
    var sourceRow = source[1];
    
    if (playerColor == "w") {
        var clientX = squareWidth * (dict[sourceColumn] - 0.5) + offsetX;
        var clientY = squareWidth * (8 + 0.5 - parseInt(sourceRow)) + offsetY;    
    }
    else {
        var clientX = squareWidth * (9 - dict[sourceColumn] - 0.5) + offsetX;
        var clientY = squareWidth * (- 0.5 + parseInt(sourceRow)) + offsetY;
    }
    
    var event = new PointerEvent('pointerdown', { clientX, clientY, bubbles });
    gameBoard.dispatchEvent(event);
    
    // destination square click 
    var destinationColumn = destination[0];
    var destinationRow = destination[1]; 
    
    if (playerColor == "w") {
        clientX = squareWidth * (dict[destinationColumn] - 0.5) + offsetX;
        clientY = squareWidth * (8 + 0.5 - parseInt(destinationRow)) + offsetY;   
    }
    else {
        clientX = squareWidth * (9 - dict[destinationColumn] - 0.5) + offsetX;
        clientY = squareWidth * (- 0.5 + parseInt(destinationRow)) + offsetY;   
    }
    event = new PointerEvent('pointerup', { clientX, clientY, bubbles });
    document.querySelector('html').dispatchEvent(event); 
    
}


// See board orientation to get player color
function getPlayerColor() {
    const gameBoard = document.querySelector('.board');
    var gameBoardClasses = gameBoard.className.split(' ');
    if (gameBoardClasses.includes('flipped')){
        playerColor = "b";
    }
    else{
        playerColor = "w";
    }
    return playerColor;
}


// get moves count
function getMovesCount(){

    let localMovesMadeCount = 0;

    if (pageType == "analysis"){
        if (document.querySelector(movesListBoxClass) && document.querySelector(movesListBoxClass).firstChild){
            localMovesMadeCount = document.querySelector(movesListBoxClass).childElementCount;
        }
    }
    else if (pageType == "play"){
        const movesList = document.querySelector(movesListBoxClass);
        if (movesList && movesList.firstChild) {
            const whiteMoves = document.querySelectorAll('.white-move');
            const blackMoves = document.querySelectorAll('.black-move');
            localMovesMadeCount = whiteMoves.length + blackMoves.length;
        }
    }
    else if (pageType == "daily"){
        if (document.querySelector(movesListBoxClass) && document.querySelector(movesListBoxClass).firstChild){
            var movesArray = document.querySelectorAll(moveNodeClass);
            var lastNodeArray = movesArray[movesArray.length - 1].childNodes;
            localMovesMadeCount = ((movesArray.length) * 2);
            if (lastNodeArray.length == 3){
                localMovesMadeCount --;
            }
        }
    }
    else if (pageType == "liveNoGame"){
        if (document.querySelector(movesListBoxClass) && document.querySelectorAll(moveNodeClass).length){
            var movesArray = document.querySelectorAll(moveNodeClass);
            var lastNodeArray = movesArray[movesArray.length - 1].childNodes;
            localMovesMadeCount = ((movesArray.length) * 2);
            if (lastNodeArray[4].textContent == ""){
                localMovesMadeCount --;
            }
        }
    }    
    else if (pageType == "liveGame"){
        if (document.querySelector(movesListBoxClass) && document.querySelector(movesListBoxClass).firstChild){
            var movesArray = document.querySelectorAll(moveNodeClass);
            var lastNodeArray = movesArray[movesArray.length - 1].childNodes;
            localMovesMadeCount = ((movesArray.length) * 2);
            if (lastNodeArray.length == 3){
                localMovesMadeCount --;
            }
        }
    }      
    return localMovesMadeCount;
}


// get last move made for accessibility
function getLastMoveMade(){

    if (pageType != "puzzles"){
    
        var movesPlayed = getMovesCount();
        
        // in case we just started a game as black and expecting opponent to play
        if(movesPlayed == 0) {
            //The node we need does not exist yet.
            //Wait 500ms and try again
            window.setTimeout(function(){
                getLastMoveMade();
            }, 500);
            return;
        }

        var movesMade = document.querySelectorAll(moveNodeClass);
        var lastMoveMade = movesMade[movesMade.length- 1];  
        
        if (pageType == "play"){
            var lastMoveMadeDivs = lastMoveMade.childNodes;
            var lastMoveMade = lastMoveMadeDivs[lastMoveMadeDivs.length - 1];
        }   
        else if (pageType == "daily"){
            var lastMoveMadeDivs = lastMoveMade.childNodes;
            if (movesMadeCount % 2 == 0){
                var lastMoveMade = lastMoveMadeDivs[lastMoveMadeDivs.length - 1];
            }
            else if (movesMadeCount % 2 != 0){
                var lastMoveMade = lastMoveMadeDivs[lastMoveMadeDivs.length - 2];
            }
        }
        else if (pageType == "liveNoGame"){
            var lastMoveMadeDivs = lastMoveMade.childNodes;
            if (movesMadeCount % 2 == 0){
                var lastMoveMade = lastMoveMadeDivs[lastMoveMadeDivs.length - 3];
            }
            else if (movesMadeCount % 2 != 0){
                var lastMoveMade = lastMoveMadeDivs[lastMoveMadeDivs.length - 5];
            }
        }
        else if (pageType == "liveGame"){
            var lastMoveMadeDivs = lastMoveMade.childNodes;
            if (movesMadeCount % 2 == 0){
                var lastMoveMade = lastMoveMadeDivs[lastMoveMadeDivs.length - 2];
            }
            else if (movesMadeCount % 2 != 0){
                var lastMoveMade = lastMoveMadeDivs[lastMoveMadeDivs.length - 2];
            }
        }
        
        // remove move number if exists
        var lastMoveMadeString = lastMoveMade.textContent;
        lastMoveMadeString = lastMoveMadeString.replaceAll("\n", "").trim();
        
        if (lastMoveMadeString.split(" ")) {
            var lastMoveMadeStringArray = lastMoveMadeString.split(" ");
            lastMoveMadeString = lastMoveMadeStringArray[lastMoveMadeStringArray.length - 1];
        }
        return lastMoveMadeString;

    }
    
}

// get player's turn
function getPlayersTurn() {
    
    var movesPlayed = getMovesCount();
    var playersTurn = '';
    
    if (movesPlayed % 2 == 0){
        playersTurn = 'w';
    }
    else if (movesPlayed % 2 != 0){
        playersTurn = 'b';
    }
    else {
        playersTurn = getPlayerColor();
    }
    return playersTurn;

} 
