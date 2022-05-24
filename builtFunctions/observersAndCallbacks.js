// Callback function to execute when mutations are observed
var callback = function(mutations) {

    console.log("mutation detected");

    if (deficienteVisual == true || deficienteVisual == false) {
        
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
                    if (window['pageType'] != "analysis") {
                        speech.text = lastMoveMadeStringModified;
                        window.speechSynthesis.speak(speech);
                        
                    }
                    window['lastMoveMadeStringAlreadySpoken'] = lastMoveMadeString;
                }
            }    
        }, 500);
        
    }
    /*
    for (mutation in mutations) {
        console.log(mutations[mutation]);
    } 
    */
    
    setTimeout (function () {
        // update chess
        let newFenPosition = getPiecesToFEN();
        if (newFenPosition != fenPosition) {
            fenPosition = newFenPosition;
        }
        // restart chessboard to follow the game on background
        window['chess'] = new Chess(fenPosition);
        console.log("fen = " + fenPosition);
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

