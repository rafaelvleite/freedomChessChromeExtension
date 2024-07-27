function disableMicrophone() {
    if (annyang) {
        annyang.abort();
    }
}

function enableMicrophone() {
    if (annyang) {
        annyang.start({ autoRestart: true });
    }
}

// Callback function to execute when mutations are observed
var callback = function(mutations) {
    setTimeout(function() {
        window['lastMoveMadeString'] = getLastMoveMade();
        if (lastMoveMadeString != undefined) {
            if (lastMoveMadeStringAlreadySpoken != lastMoveMadeString) {
                lastMoveMadeStringModified = lastMoveMadeString.replace(/C/, 'Cavalo ');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/T/, 'Torre ');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/R/, 'Rei ');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/D/, 'Dama ');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/B/, 'Bispo ');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/x/, ' por ');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/O-O-O/, 'Grande roque');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/O-O/, 'Roque');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/#/, '');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/=/, ' ');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/\+/g, '');
                lastMoveMadeStringModified = lastMoveMadeStringModified.replace(/  +/g, ' ');
                lastMoveMadeStringModified = lastMoveMadeStringModified.trim();
                lastMoveMadeStringModified = lastMoveMadeStringModified.toLowerCase();
                
                // Log and speak the move                    
                disableMicrophone(); // Disable microphone before speaking
                speech.text = lastMoveMadeStringModified;
                window.speechSynthesis.speak(speech);
                
                // Enable microphone after speaking
                speech.onend = function() {
                    enableMicrophone();
                };
                
                window['lastMoveMadeStringAlreadySpoken'] = lastMoveMadeString;
            }
        }    
    }, 500);
    
    setTimeout (function () {
        // update chess
        let newFenPosition = getPiecesToFEN();
        if (newFenPosition != fenPosition) {
            fenPosition = newFenPosition;
        }
        // restart chessboard to follow the game on background
        window['chess'] = new Chess(fenPosition);
    }, 500);

}

// Create an observer instance linked to the callback function
window['observer'] = new MutationObserver(callback);

// Observe if moves list has changed
function startObservingMoves() {

    // get player color
    window['']

    // get starting position
    window['fenPosition'] = getPiecesToFEN();
    
    // Start chessboard to follow the game on background
    window['chess'] = new Chess(fenPosition);

    var targetNode = document.querySelector('.board');
        
    // Options for the observer (which mutations to observe)
    var config = {
        attributes: true,
        childList: true,
        subtree: true
    };
    
    // initialize var for accessibility
    window['lastMoveMadeStringAlreadySpoken'] = "";
    
    // Start observing the target node for configured mutations
    observer.observe(targetNode, config);
    
}

