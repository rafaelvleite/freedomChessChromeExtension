// https://medium.com/swlh/programming-a-chess-bot-for-chess-com-fa6bd7e1da76
// references for speech: https://codepen.io/Web_Cifar/pen/jOqBEjE and https://codeburst.io/html5-speech-recognition-api-670846a50e92


window.onload = () =>{

    // start chess board for background
    'use strict';
    const script = document.createElement('script');
    script.setAttribute("type", "module");
    script.setAttribute("src", chrome.extension.getURL('thirdParty/chess.js/chess.js'));
    const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
    head.insertBefore(script, head.lastChild);

    // get classes for elements for functions on different pages
    window['currentUrl'] = window.location.href;
    
    // Observe behavior for analysis mode
    if (currentUrl.includes("analysis")){
        window['movesListBoxClass'] = '.move-list.horizontal-move-list';
        window['moveNodeClass'] = '.move-node';
        window['pageType'] = "analysis";
    }
    // Observe behavior for play mode
    else if (currentUrl.includes("play")){
        window['movesListBoxClass'] = '.layout-move-list.vertical-move-list';
        window['moveNodeClass'] = '.move';
        window['pageType'] = "play";
    }
    // Observe behavior for daily play mode
    else if (currentUrl.includes("daily")){
        window['movesListBoxClass'] = '.move-list-move-list.vertical-move-list';
        window['moveNodeClass'] = '.move';
        window['pageType'] = "daily";
    }
    // Observe behavior for live game mode
    else if ((currentUrl.includes("live")) && (!currentUrl.includes("game"))){
        window['movesListBoxClass'] = '.vertical-move-list-component';
        window['moveNodeClass'] = '.vertical-move-list-notation-vertical';
        window['pageType'] = "liveNoGame";
    }
    // Observe behavior for live game mode
    else if ((currentUrl.includes("live")) && (currentUrl.includes("game"))){
        window['movesListBoxClass'] = '.move-list-move-list.vertical-move-list';
        window['moveNodeClass'] = '.move';
        window['pageType'] = "liveGame";
    }
    
    
    // Create button for enabling Freedom Mode
    const button = document.createElement('button');
    var buttonImageUrl = chrome.runtime.getURL('images/speech-icon.png');
    button.id = "freedomButton";
    button.className = "freedomButtonClass";
    button.innerHTML = '<img src="' + buttonImageUrl + '" style="width:30px; float:left; margin-left: -20%;" />';
    
    if (pageType == "play") {
        var checkExist = setInterval(function() {
           if ($('.secondary-controls-left.secondary-controls-group').length) {
              document.querySelector('.secondary-controls-left.secondary-controls-group').append(button);
              clearInterval(checkExist);
           }
        }, 100); // check every 100ms
    
    }
    else if (pageType == "analysis"){
        var checkExist = setInterval(function() {
           if ($('.secondary-controls-component').length) {
              document.querySelector('.secondary-controls-component').append(button);
              clearInterval(checkExist);
           }
        }, 100); // check every 100ms
    }
    else if (pageType == "daily"){
        var checkExist = setInterval(function() {
           if ($('.daily-game-footer-middle').length) {
              document.querySelector('.daily-game-footer-middle').append(button);
              clearInterval(checkExist);
           }
        }, 100); // check every 100ms
    }
    else if (pageType == "liveGame"){
        var checkExist = setInterval(function() {
           if ($('.live-game-buttons-component').length) {
              document.querySelector('.live-game-buttons-component').append(button);
              clearInterval(checkExist);
           }
        }, 100); // check every 100ms
    }
    else if (pageType == "liveNoGame"){
        var checkExist = setInterval(function() {
           if ($('.game-buttons-component').length) {
              document.querySelector('.game-buttons-component').append(button);
              clearInterval(checkExist);
           }
        }, 100); // check every 100ms
    }
    
    

    // Create an observer instance linked to the callback function
    window['freedomEnabled'] = false;
    window['observer'] = new MutationObserver(callback);
    
    window['confirm'] = function(question, text, confirmButtonText, callback) {
        Swal.fire({
              title: question,
              imageUrl: chrome.runtime.getURL('images/freedomChess.png'),
              imageHeight: 100,
              imageAlt: 'Freedom Logo',
              text: text,
              showCancelButton: true,
              confirmButtonColor: '#3085d6',
              cancelButtonColor: '#d33',
              confirmButtonText: confirmButtonText,
        }).then((confirmed) => {
            callback(confirmed && confirmed.value == true);
        });
    }
    
    // switch enable/disable Freedom Mode
    window['enableDisableFreedomMode'] = function() {
        
        if (freedomEnabled == false) {
        
            var question = 'Você deseja ativar o Modo Freedom?';
            var text = "Você passará a falar os lances ao invés de usar o mouse.";
            var confirmButtonText = 'Sim, ative!';
            
            confirm(question, text, confirmButtonText, function (confirmed) {
                if (confirmed) {
                    Swal.fire({
                        icon: 'success',
                        title: "Ativado!",
                        text: "O modo Freedom está ativo.",
                        showConfirmButton: false,
                        timer: 1500
                    });
                    setTimeout(function(){ 
                        enableFreedomMode();
                    }, 2000);
                    freedomEnabled = true;
                }
                else {
                    freedomEnabled = false;
                }
            });
        }
                
        else if (freedomEnabled == true) {
            question = 'Você deseja desativar o Modo Freedom?';
            text = "Você passará a fazer os lances com o mouse normalmente.";
            confirmButtonText = 'Sim, desative!';
            
            confirm(question, text, confirmButtonText, function (confirmed) {
                if (confirmed) {
                    observer.disconnect(); 
                    Swal.fire({
                        icon: 'success',
                        title: "Destivado!",
                        text: "O modo Freedom foi desativado.",
                        showConfirmButton: false,
                        timer: 1500
                    });
                    freedomEnabled = false;
                }
                else {
                    freedomEnabled = true;
                }
            });
        }
        return;
    }
    
    // button click behavior
    button.addEventListener("click", function(){
        enableDisableFreedomMode();
    }, false);

}


// Speech Recognition
window.SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
window['recognition'] = new SpeechRecognition();
recognition.interimResults = true;
recognition.lang = 'pt-BR';

recognition.onresult = function(e) {
    
    var text = Array.from(e.results)
      .map((result) => result[0])
      .map((result) => result.transcript)
      .join("");
      
    if (e.results[0].isFinal) {
    
        console.log(text);
    
        // ativar voz para lances do adversário
        if (text.includes("deficiente visual")) {
            window['deficienteVisual'] = true;
            var deficienteVisualMessage = "Modo para Deficiencia Visual Ativado!"
            speech.text = deficienteVisualMessage;
            window.speechSynthesis.speak(speech);
        }
        else if (text.includes("desativar")) {
            enableDisableFreedomMode();
        }
        else {
        
            // remove spaces if only square for pawn move
            if (text.length <= 3) {
                text = text.replace(/ +/g, "");
            }
            
            // replace text for numbers
            text = text.replace(/ um/, "1");
            text = text.replace(/ dois/, "2");
            text = text.replace(/ três/, "3");
            text = text.replace(/ quatro/, "4");
            text = text.replace(/ cinco/, "5");
            text = text.replace(/ seis/, "6");
            text = text.replace(/ sete/, "7");
            text = text.replace(/ oito/, "8");
            text = text.replace(/rock/, "roque");
            
            
            var legalMoves = chess.moves();
            console.log(legalMoves);
            legalMoves = legalMoves.map(function(x){return x.replace(/N/, 'Cavalo ');});
            legalMoves = legalMoves.map(function(x){return x.replace(/R/, 'Torre ');});
            legalMoves = legalMoves.map(function(x){return x.replace(/K/, 'Rei ');});
            legalMoves = legalMoves.map(function(x){return x.replace(/Q/, 'Dama ');});
            legalMoves = legalMoves.map(function(x){return x.replace(/B/, 'Bispo ');});
            legalMoves = legalMoves.map(function(x){return x.replace(/x/, ' por ');});
            legalMoves = legalMoves.map(function(x){return x.replace(/O-O-O/, 'Grande roque');});
            legalMoves = legalMoves.map(function(x){return x.replace(/O-O/, 'Roque');});
            
            
          
            var bestMove = "";
            var similarityReference = 0;
            
            for (var move in legalMoves) {
                var stringsSimilarity = similarity(text, legalMoves[move]);
                if (stringsSimilarity >= similarityReference) {
                    similarityReference = stringsSimilarity;
                    bestMove = legalMoves[move];
                }
            }
            var indexForBestMove = legalMoves.indexOf(bestMove);
            legalMoves = chess.moves();
            var chosenMove = legalMoves[indexForBestMove];
        
            if (similarityReference >= 0.6) {
                chess.move(chosenMove);
                var movesHistory = chess.history({ verbose: true });
                var lastHistoryMove = movesHistory[movesHistory.length -1];
                source = lastHistoryMove.from;
                destination = lastHistoryMove.to;
                chess.undo();
                makeMove(source, destination);    
            }
            else {
                //console.log(text);
                //console.log(chosenMove); 
                //console.log(similarityReference); 
                //console.log(chess.fen());
                // play beep sound
                // Play beep
                let context = new (window.AudioContext || window.webkitAudioContext)();
                var osc = context.createOscillator(); // instantiate an oscillator
                osc.type = 'sine'; // this is the default - also square, sawtooth, triangle
                osc.frequency.value = 440; // Hz
                osc.connect(context.destination); // connect it to the destination
                osc.start(); // start the oscillator
                osc.stop(context.currentTime + 0.5); // stop 2 seconds after the current time
            } 
        } 
    }
};

recognition.onend = function () {
    if (freedomEnabled == true) {
        recognition.start();
    }
    else {
        recognition.stop();
    }
};



// Debug for x y coordinates on screen
function enableMouseCoordinatesDebug() {
    document.onmousemove = function(e){
    var x = e.pageX;
    var y = e.pageY;
    e.target.title = "X is "+x+" and Y is "+y;
    };
}

// see wheter the game has already started or not
function hasTheGameStarted(){
    if ((pageType == "liveGame") || (pageType == "liveNoGame")) {
        if(moveNodeClass.length){
            return true;
        }
        else {
            return false;
        }
    }
    else {
        return true;
    }
}



// see wheter the game is over or not
function isGameOver(){
    if ($('.game-result').length) {
        return $('.game-result').text();
    }
    else {
        return false;
    }
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



// funcões para similaridade de frases por distância de Levenshtein
function editDistance(s1, s2) {
  s1 = s1.toLowerCase();
  s2 = s2.toLowerCase();

  var costs = new Array();
  for (var i = 0; i <= s1.length; i++) {
    var lastValue = i;
    for (var j = 0; j <= s2.length; j++) {
      if (i == 0)
        costs[j] = j;
      else {
        if (j > 0) {
          var newValue = costs[j - 1];
          if (s1.charAt(i - 1) != s2.charAt(j - 1))
            newValue = Math.min(Math.min(newValue, lastValue),
              costs[j]) + 1;
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
    }
    if (i > 0)
      costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}
function similarity(s1, s2) {
  var longer = s1;
  var shorter = s2;
  if (s1.length < s2.length) {
    longer = s2;
    shorter = s1;
  }
  var longerLength = longer.length;
  if (longerLength == 0) {
    return 1.0;
  }
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
}



// get moves count
function getMovesCount(){
    if (pageType == "analysis"){
        if (document.querySelector(movesListBoxClass) && document.querySelector(movesListBoxClass).firstChild){
            var localMovesMadeCount = document.querySelector(movesListBoxClass).childElementCount;
        }
        else {
            var localMovesMadeCount = 0;
        }
    }
    else if (pageType == "play"){
        if (document.querySelector(movesListBoxClass) && document.querySelector(movesListBoxClass).firstChild){
            var movesArray = document.querySelectorAll(moveNodeClass);
            var lastNodeArray = movesArray[movesArray.length - 1].childNodes;
            var localMovesMadeCount = ((movesArray.length) * 2);
            if (lastNodeArray.length == 2){
                localMovesMadeCount --;
            }
        }
        else {
            var localMovesMadeCount = 0;
        }
    }
    else if (pageType == "daily"){
        if (document.querySelector(movesListBoxClass) && document.querySelector(movesListBoxClass).firstChild){
            var movesArray = document.querySelectorAll(moveNodeClass);
            var lastNodeArray = movesArray[movesArray.length - 1].childNodes;
            var localMovesMadeCount = ((movesArray.length) * 2);
            if (lastNodeArray.length == 3){
                localMovesMadeCount --;
            }
        }
        else {
            var localMovesMadeCount = 0;
        }
    }
    else if (pageType == "liveNoGame"){
        if (document.querySelector(movesListBoxClass) && document.querySelectorAll(moveNodeClass).length){
            var movesArray = document.querySelectorAll(moveNodeClass);
            var lastNodeArray = movesArray[movesArray.length - 1].childNodes;
            var localMovesMadeCount = ((movesArray.length) * 2);
            if (lastNodeArray[4].textContent == ""){
                localMovesMadeCount --;
            }
        }
        else {
            var localMovesMadeCount = 0;
        }
    }    
    else if (pageType == "liveGame"){
        if (document.querySelector(movesListBoxClass) && document.querySelector(movesListBoxClass).firstChild){
            var movesArray = document.querySelectorAll(moveNodeClass);
            var lastNodeArray = movesArray[movesArray.length - 1].childNodes;
            var localMovesMadeCount = ((movesArray.length) * 2);
            if (lastNodeArray.length == 3){
                localMovesMadeCount --;
            }
        }
        else {
            var localMovesMadeCount = 0;
        }
    }      
    return localMovesMadeCount;
}


function getLastMoveMade(){
    
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



// Observe if moves list has changed
function startObservingMoves() {

    var movesPlayed = getMovesCount();
    console.log(movesPlayed);
            
    // in case we just started a game as black and expecting opponent to play
    if(movesPlayed == 0) {
        //The node we need does not exist yet.
        //Wait 500ms and try again
        window.setTimeout(function(){
            startObservingMoves();
        }, 500);
        return;
    }
    
    // Select the node that will be observed for mutations
    if (pageType == "live") {
        var targetNode = document.querySelector(movesListBoxClass).firstChild;
    }
    else {
        var targetNode = document.querySelector(movesListBoxClass);
    }
    
    // Options for the observer (which mutations to observe)
    if (pageType == "play") {
        var config = {
        attributes: false,
        childList: true,
        subtree: true
        };
    }
    else if (pageType == "analysis") {
        var config = {
        attributes: false,
        childList: true,
        subtree: false
        };
    }
    else if (pageType == "daily") {
        var config = {
        attributes: false,
        childList: true,
        subtree: true
        };
    }
    else if (pageType == "liveNoGame") {
        var config = {
        attributes: true,
        childList: false,
        subtree: false
        };
    }
    else if (pageType == "liveGame") {
        var config = {
        attributes: true,
        childList: false,
        subtree: false
        };
    }
    // Start observing the target node for configured mutations
    observer.observe(targetNode, config);

    // force the first callback 
    window["callback"]();   

}



// Callback function to execute when mutations are observed
var callback = function(mutations) {

    console.log("callback");
    
    // check if game started
    var hasTheGameAlreadyStarted = hasTheGameStarted();    

    // check if game is over
    var isTheGameOver = isGameOver();    


    if ((freedomEnabled == true) && (hasTheGameAlreadyStarted == true) && (isTheGameOver == false)) {
        // get player color
        var playerColor = getPlayerColor();
    
        // get moves count
        window['movesMadeCount'] = getMovesCount();
    
        // get last move made
        var lastMoveMadeString = getLastMoveMade();
        lastMoveMadeString = lastMoveMadeString.trim();
        
        // last move made to speech
        var spokenLastMoveMadeString = lastMoveMadeString;
        spokenLastMoveMadeString = spokenLastMoveMadeString.replace(/T/, "Torre ");;
        spokenLastMoveMadeString = spokenLastMoveMadeString.replace(/C/, "Cavalo ");
        spokenLastMoveMadeString = spokenLastMoveMadeString.replace(/B/, "Bispo ");
        spokenLastMoveMadeString = spokenLastMoveMadeString.replace(/D/, "Dama ");
        spokenLastMoveMadeString = spokenLastMoveMadeString.replace(/R/, "Rei ");
        spokenLastMoveMadeString = spokenLastMoveMadeString.replace(/O-O-O/, "Grande Roque ");
        spokenLastMoveMadeString = spokenLastMoveMadeString.replace(/O-O/, "Roque ");
        spokenLastMoveMadeString = spokenLastMoveMadeString.replace(/x/, " por ");
        
        // make move on background
        var englishLastMadeMoveString = lastMoveMadeString.replace(/C/, 'N');
        englishLastMadeMoveString = englishLastMadeMoveString.replace(/D/, 'Q');
        englishLastMadeMoveString = englishLastMadeMoveString.replace(/R/, 'K');
        englishLastMadeMoveString = englishLastMadeMoveString.replace(/T/, 'R');
        console.log(englishLastMadeMoveString);
        console.log(chess.fen());
        chess.move(englishLastMadeMoveString);

            
        // make the alert that move has been played
        if (movesMadeCount %2 == 0) {
            if (deficienteVisual == true) {
                var speechMessage = "As Pretas jogaram " + spokenLastMoveMadeString + ", agora as Brancas jogam!";                
                speech.text = speechMessage;
                window.speechSynthesis.speak(speech);
            }
        }
        else{
            if (deficienteVisual == true) {
                var speechMessage = "As Brancas jogaram " + spokenLastMoveMadeString + ", agora as Pretas jogam!";
                speech.text = speechMessage;
                window.speechSynthesis.speak(speech);
            }
        }
    }
    else {
        window['observer'].disconnect(); 
        Swal.fire({
            icon: 'success',
            title: "Destivado!",
            text: "O modo Freedom foi desativado.",
            showConfirmButton: false,
            timer: 1500
        });
        freedomEnabled = false;
    }   
};


function getPiecesToFEN() {

    console.log(pageType);

    var fenPosition = "";
    
    if ((pageType == "analysis") || (pageType == "play")) {
        console.log("here");
        for (var i = 8; i >=1; i--) {
            for (var j = 1; j <=8; j++) {
                console.log(fenPosition, i, j);
                var classNameForPiece = '.square-' + j + i;
                var pieceDiv = document.querySelector(classNameForPiece);
                if (pieceDiv) {
                    var listOfClasses = pieceDiv.classList;
                    for (var classInfo in listOfClasses) {
                        if (listOfClasses[classInfo][0] == "w") {
                            fenPosition = fenPosition + listOfClasses[classInfo][1].toUpperCase(); 
                        }
                        else if (listOfClasses[classInfo][0] == "b") {
                            fenPosition = fenPosition + listOfClasses[classInfo][1].toLowerCase(); 
                        }
                        else if (listOfClasses[classInfo] == "highlight") {
                            if (j > 1){
                                if (!isNaN(fenPosition[fenPosition.length -1])) {
                                    var referenceNumber = fenPosition[fenPosition.length -1];
                                    console.log(referenceNumber);
                                    var newNumber = parseInt(referenceNumber) + 1;
                                    fenPosition = fenPosition.slice(0, -1);
                                    fenPosition = fenPosition + newNumber;
                                }
                                else {
                                    fenPosition = fenPosition + "1";
                                }
                            }
                            else {
                                fenPosition = fenPosition + "1";
                            }
                            
                        }
                    }
                }
                else {
                    if (j == 1) {
                        fenPosition = fenPosition + "1";
                        console.log("j=1");
                    }
                    else if (!isNaN(fenPosition[fenPosition.length -1])) {
                        var referenceNumber = fenPosition[fenPosition.length -1];
                        console.log(referenceNumber);
                        var newNumber = parseInt(referenceNumber) + 1;
                        fenPosition = fenPosition.slice(0, -1);
                        fenPosition = fenPosition + newNumber;
                    }
                    else {
                        fenPosition = fenPosition + "1";
                    }
                    
                }
                
            } 
            fenPosition = fenPosition + "/";
        }
        var playerColor = getPlayerColor();
        fenPosition = fenPosition.slice(0, -1);
        fenPosition = fenPosition + " " + playerColor + " KQkq - 0 1";
    
    }
    else {
        for (var i = 8; i >=1; i--) {
            for (var j = 1; j <=8; j++) {
                var classNameForPiece = '.square-0' + j + "0" + i;
                var pieceDiv = document.querySelector(classNameForPiece);
                if (pieceDiv) {
                    var listOfClasses = pieceDiv.classList;
                    for (var classInfo in listOfClasses) {
                        if (listOfClasses[classInfo][0] == "w") {
                            fenPosition = fenPosition + listOfClasses[classInfo][1].toUpperCase(); 
                        }
                        else if (listOfClasses[classInfo][0] == "b") {
                            fenPosition = fenPosition + listOfClasses[classInfo][1].toLowerCase(); 
                        }
                    }
                }
                else {
                    if (j == 1) {
                        fenPosition = fenPosition + "1";
                    }
                    else if (!isNaN(fenPosition[fenPosition.length -1])) {
                        var referenceNumber = fenPosition[fenPosition.length -1];
                        var newNumber = parseInt(referenceNumber) + 1;
                        fenPosition = fenPosition.slice(0, -1);
                        fenPosition = fenPosition + newNumber;
                    }
                    else {
                        fenPosition = fenPosition + "1";
                    }
                    
                }
                
            } 
            fenPosition = fenPosition + "/";
        }
        var playerColor = getPlayerColor();
        fenPosition = fenPosition.slice(0, -1);
        fenPosition = fenPosition + " " + playerColor + " KQkq - 0 1";
    
    }
    
    return fenPosition;
} 


// enable Freedom Chess Mode
function enableFreedomMode() {

    // enableMouseCoordinatesDebug();
    
    // Text to Speech
    window['speech'] = new SpeechSynthesisUtterance();
    speech.lang = "pt-BR";
    speech.rate = 1.1;
    speech.pitch = 1;
    speech.volume = 1;
    
    // deficiente visual?
    window['deficienteVisual'] = false;

    // get starting fen
    var fenPosition = getPiecesToFEN();
    console.log(fenPosition);
    
    // Start chessboard to follow the game on background
    window['chess'] = new Chess(fenPosition);
    console.log(chess.fen());
    
    // check if game started
    var hasTheGameAlreadyStarted = hasTheGameStarted();
    
    // check if game is over
    var isTheGameOver = isGameOver();
    
    // welcome message and instructions
    var welcomeMessage = "Modo Freedom Ativado, seja bem-vindo! Se quiser desativar este modo, basta dizer Desativar. Se você for deficiente visual, diga agora 'Sou deficiente visual' para que eu diga em voz alta os lances de seu adversário. Boa partida!"
    speech.text = welcomeMessage;
    console.log(speech);
    window.speechSynthesis.speak(speech);
    
    if ((hasTheGameAlreadyStarted == true) && (isTheGameOver == false)) {
    
        recognition.start();
    
        // get player color
        var playerColor = getPlayerColor();
        
        // start observing opponent's moves
        startObservingMoves();     
    
    }
}










    

