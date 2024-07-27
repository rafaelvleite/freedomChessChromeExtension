// https://medium.com/swlh/programming-a-chess-bot-for-chess-com-fa6bd7e1da76
// references for speech: https://codepen.io/Web_Cifar/pen/jOqBEjE and https://codeburst.io/html5-speech-recognition-api-670846a50e92
// string similarity: https://medium.com/@sumn2u/string-similarity-comparision-in-js-with-examples-4bae35f13968


// enable Freedom Chess Mode
function enableFreedomMode() {

    // enableMouseCoordinatesDebug();

    // Text to Speech
    window['speech'] = new SpeechSynthesisUtterance();
    speech.lang = "pt-BR";
    speech.rate = 1.2;
    speech.pitch = 1;
    speech.volume = 1;    

    // start recognizing speech
    annyang.setLanguage('pt-BR');
    //annyang.start({ autoRestart: true });

    // start observing opponent's moves
    startObservingMoves();
     
    
}










    
