// https://medium.com/swlh/programming-a-chess-bot-for-chess-com-fa6bd7e1da76
// references for speech: https://codepen.io/Web_Cifar/pen/jOqBEjE and https://codeburst.io/html5-speech-recognition-api-670846a50e92
// string similarity: https://medium.com/@sumn2u/string-similarity-comparision-in-js-with-examples-4bae35f13968


// enable Freedom Chess Mode
function enableFreedomMode() {

    // enableMouseCoordinatesDebug();
    
    // Text to Speech
    window['speech'] = new SpeechSynthesisUtterance();
    speech.lang = "pt-BR";
    speech.rate = 0.8;
    speech.pitch = 1;
    speech.volume = 1;
    
    // deficiente visual?
    window['deficienteVisual'] = false;

    // welcome message and instructions
    var welcomeMessage = "Modo Freedom Ativado, basta dizer os lances para jogar. Se você for deficiente visual, diga 'Sou deficiente visual' para que eu diga em voz alta os lances de seu adversário. Boa partida!"
    
    // speech.text = welcomeMessage;
    // window.speechSynthesis.speak(speech);
    
    // start observing opponent's moves
    startObservingMoves();
     
    // start recognizing speech
    annyang.setLanguage('pt-BR');
    annyang.start();
    
}










    
