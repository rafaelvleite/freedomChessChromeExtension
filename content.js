// https://medium.com/swlh/programming-a-chess-bot-for-chess-com-fa6bd7e1da76
// references for speech: https://codepen.io/Web_Cifar/pen/jOqBEjE and https://codeburst.io/html5-speech-recognition-api-670846a50e92
// string similarity: https://medium.com/@sumn2u/string-similarity-comparision-in-js-with-examples-4bae35f13968

window.onload = () =>{

    // import scripts
    'use strict';
    const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
    const script = document.createElement('script');
    script.setAttribute("type", "module");
    
    // get classes for elements for functions on different pages and also get pagetypes from url
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/classesMappingChessCom.js'));
    head.insertBefore(script, head.lastChild);

    // get string similarity functions
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/stringsSimilarity.js'));
    head.insertBefore(script, head.lastChild);
    
    // get speech recognition functions
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/speechRecognition.js'));
    head.insertBefore(script, head.lastChild);

    // start chess board for background
    script.setAttribute("src", chrome.extension.getURL('thirdParty/chess.js/chess.js'));
    head.insertBefore(script, head.lastChild);
    
    // Create button for enabling Freedom Mode
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/createFreedomModeButton.js'));
    head.insertBefore(script, head.lastChild);
    
    // enable/disable Freedom Mode
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/enableDisableFreedomMode.js'));
    head.insertBefore(script, head.lastChild);
    
    // get board pieces and create FEN position
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/getPiecesToFenPosition.js'));
    head.insertBefore(script, head.lastChild);
    
    // get board pieces and create FEN position
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/getPiecesToFenPosition.js'));
    head.insertBefore(script, head.lastChild);
    
    // get observers and callbacks for screen mutations
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/observersAndCallbacks.js'));
    head.insertBefore(script, head.lastChild);

    // get functions related to the move itself
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/moveFunctions.js'));
    head.insertBefore(script, head.lastChild);

}


// enable Freedom Chess Mode
function enableFreedomMode() {

    // enableMouseCoordinatesDebug();
    
    // Event listeners for daily games and promotion
    const head = document.head || document.getElementsByTagName("head")[0] || document.documentElement;
    const script = document.createElement('script');
    script.setAttribute("type", "module");
    script.setAttribute("src", chrome.extension.getURL('builtFunctions/eventListeners.js'));
    head.insertBefore(script, head.lastChild);
    
    // Text to Speech
    window['speech'] = new SpeechSynthesisUtterance();
    speech.lang = "pt-BR";
    speech.rate = 1.1;
    speech.pitch = 1;
    speech.volume = 1;
    
    // deficiente visual?
    window['deficienteVisual'] = false;

    // welcome message and instructions
    var welcomeMessage = "Modo Freedom Ativado, basta dizer os lances para jogar. Se você for deficiente visual, diga 'Sou deficiente visual' para que eu diga em voz alta os lances de seu adversário. Boa partida!"
    
    // speech.text = welcomeMessage;
    // window.speechSynthesis.speak(speech);
    
    // start recognizing speech
    recognition.start();
    
    // start observing opponent's moves
    startObservingMoves();     
    
}










    
