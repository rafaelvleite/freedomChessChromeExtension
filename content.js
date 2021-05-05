//https://medium.com/swlh/programming-a-chess-bot-for-chess-com-fa6bd7e1da76window.onload = () =>{    const button = document.createElement('button');    button.id = "freedomButton";    button.textContent = "Freedom";    button.className = "freedomButtonClass"    if (document.querySelector('.layout-controls')) {        document.querySelector('.layout-controls').append(button);    }    if (document.querySelector('.board-layout-controls')){        document.querySelector('.board-layout-controls').append(button);        }    button.addEventListener('click', () => enableFreedomMode());}function enableMouseCoordinatesDebug() {    document.onmousemove = function(e){    var x = e.pageX;    var y = e.pageY;    e.target.title = "X is "+x+" and Y is "+y;    };}function getPlayerColor() {    const gameBoard = document.querySelector('.board');    const offsetX = gameBoard.getBoundingClientRect().x;    const offsetY = gameBoard.getBoundingClientRect().y;    const squareWidth = gameBoard.getBoundingClientRect().width / 8;    const bubbles = true;    let x = squareWidth * 0.5 + offsetX;    let y = squareWidth * 7.5 + offsetY;    var myPiece = document.elementFromPoint(x, y);        var classList = myPiece.className.split(' ');    var playerColor = classList[1][0];    return playerColor;}function getSourceSquare() {    var source = prompt("Por favor digite a casa de origem de seu lance");    return source;}function getDestinationSquare() {    var destination = prompt("Por favor digite a casa de destino de seu lance");    return destination;}function makeMove(source, destination) {    // get number of moves played    if (document.querySelector('.move-list.horizontal-move-list')){        var movesMadeCount = document.querySelector('.move-list.horizontal-move-list').childElementCount;    }    // get board to get screen position and offsets and also square width    const gameBoard = document.querySelector('.board');    const offsetX = gameBoard.getBoundingClientRect().x;    const offsetY = gameBoard.getBoundingClientRect().y;    const squareWidth = gameBoard.getBoundingClientRect().width / 8;    const bubbles = true;        // dicionário de conversão de casa em coordenadas    var dict = {      "a": 1,      "b": 2,      "c": 3,      "d": 4,      "e": 5,      "f": 6,      "g": 7,      "h": 8    };        // origin square click    var sourceColumn = source[0];    var sourceRow = source[1];    let clientX = squareWidth * (dict[sourceColumn] - 0.5) + offsetX;    let clientY = squareWidth * (8 + 0.5 - parseInt(sourceRow)) + offsetY;    let event = new PointerEvent('pointerdown', { clientX, clientY, bubbles });    gameBoard.dispatchEvent(event);        // destination square click     var destinationColumn = destination[0];    var destinationRow = destination[1];     clientX = squareWidth * (dict[destinationColumn] - 0.5) + offsetX;    clientY = squareWidth * (8 + 0.5 - parseInt(destinationRow)) + offsetY;       event = new PointerEvent('pointerup', { clientX, clientY, bubbles });    document.querySelector('html').dispatchEvent(event);         // check if move is legal    window.setTimeout(function(){         if (document.querySelector('.move-list.horizontal-move-list')){        var newMovesMadeCount = document.querySelector('.move-list.horizontal-move-list').childElementCount;        if (newMovesMadeCount == movesMadeCount){            alert("Lance ilegal, por favor faça seu lance novamente");            source = getSourceSquare();            destination = getDestinationSquare();            makeMove(source, destination)        }    }    }, 1000);}function observeMovesMade() {    var movesListBox = document.querySelector('.move-list.horizontal-move-list');    if(!movesListBox) {        //The node we need does not exist yet.        //Wait 500ms and try again        window.setTimeout(observeMovesMade,500);        return;    }    // Select the node that will be observed for mutations    var targetNode = document.querySelector('.move-list.horizontal-move-list');        // Options for the observer (which mutations to observe)    var config = {      attributes: false,      childList: true,      subtree: true    };    // Create an observer instance linked to the callback function    var observer = new MutationObserver(callback);        // Start observing the target node for configured mutations    observer.observe(targetNode, config);        // alert that player has made the move    var movesMade = document.querySelectorAll('.move-node');    var lastMoveMade = movesMade[movesMade.length- 1];    var lastMoveMadeString = lastMoveMade.textContent;    if (lastMoveMadeString.split(" ")) {        var lastMoveMadeStringArray = lastMoveMadeString.split(" ");        lastMoveMadeString = lastMoveMadeStringArray[lastMoveMadeStringArray.length - 1];    }    alert("As Brancas jogaram " + lastMoveMadeString + ", agora as Pretas jogam!");}// Callback function to execute when mutations are observedvar callback = function() {    let playerColor = getPlayerColor();    var movesMadeCount = document.querySelector('.move-list.horizontal-move-list').childElementCount;        var movesMade = document.querySelectorAll('.move-node');    var lastMoveMade = movesMade[movesMade.length- 1];    var lastMoveMadeString = lastMoveMade.textContent;        if (lastMoveMadeString.split(" ")) {        var lastMoveMadeStringArray = lastMoveMadeString.split(" ");        lastMoveMadeString = lastMoveMadeStringArray[lastMoveMadeStringArray.length - 1];    }            if (movesMadeCount %2 == 0) {        alert("As Pretas jogaram " + lastMoveMadeString + ", agora as Brancas jogam!");        if (playerColor == "w") {            let source = getSourceSquare();            let destination = getDestinationSquare();            makeMove(source, destination);           }    }    else{        alert("As Brancas jogaram " + lastMoveMadeString + ", agora as Pretas jogam!");        if (playerColor == "b") {            let source = getSourceSquare();            let destination = getDestinationSquare();            makeMove(source, destination);           }    }};function enableFreedomMode() {    // enableMouseCoordinatesDebug();        // get player color    let playerColor = getPlayerColor();        // first move    if (playerColor == "w"){        let source = getSourceSquare();        let destination = getDestinationSquare();        makeMove(source, destination);    }        // observe if any move has been made    observeMovesMade();    }    