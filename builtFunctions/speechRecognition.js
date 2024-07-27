// Speech Recognition

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

const calculateFunction = function(expr) {

    var lance = expr.replace(/por/, "x");
    lance = lance.replace(/ flor /, " x ");
    lance = lance.replace(/ for /, " x ");
    lance = lance.replace(/ ar /, " a ");
    lance = lance.replace(/ de /, " d ");
    lance = lance.replace(/dama/, "Q");
    lance = lance.replace(/rei/, "K");
    lance = lance.replace(/bispo/, "B");
    lance = lance.replace(/cavalo/, "N");
    lance = lance.replace(/torre/, "R");
    lance = lance.replace(/ /g,'');
    
    var passedMatchTests = 0;
    
    var higherScoresSum = -1;
    
    var bestMove;
    
    var legalMoves = chess.moves();
    legalMoves = legalMoves.map(function(x){return x.replace(/#/, '');});
    legalMoves = legalMoves.map(function(x){return x.replace(/=/, ' ');});
    legalMoves = legalMoves.map(function(x){return x.replace(/\+/g, '');});
    legalMoves = legalMoves.map(function(x){return x.replace(/  +/g, ' ');});
    legalMoves = legalMoves.map(function(x){return x.trim();});
            
    
    for (var move in legalMoves) {
        let levenshteinScore = similarity(lance, legalMoves[move]);
        let jaroWrinkerScore = JaroWrinker(lance, legalMoves[move]);
        let localScoresSum = (levenshteinScore * 1) + (jaroWrinkerScore * 1);
        if (localScoresSum > higherScoresSum) {
            bestMove = chess.moves()[move];
            higherScoresSum = localScoresSum;
        }
    }
    
    if (higherScoresSum > 1.5) {
        passedMatchTests = 1;
    }
        
    
    if ( passedMatchTests == 1 ) {
        var lanceVencedor = bestMove;
        lanceVencedor = lanceVencedor.replace("N", "Cavalo ");
        lanceVencedor = lanceVencedor.replace("B", "Bispo ");
        lanceVencedor = lanceVencedor.replace("Q", "Dama ");
        lanceVencedor = lanceVencedor.replace("R", "Torre ");
        lanceVencedor = lanceVencedor.replace("K", "Rei ");
        lanceVencedor = lanceVencedor.replace("x", " por ");
        lanceVencedor = lanceVencedor.replace("O-O-O", "grande roque");
        lanceVencedor = lanceVencedor.replace("O-O", "roque");
        lanceVencedor = lanceVencedor.replace("#", " xeque-mate");
        lanceVencedor = lanceVencedor.replace("+", " xeque");        
    
        speech.text = 'Confirma ' + lanceVencedor + '?';
        disableMicrophone(); // Disable microphone before speaking
        window.speechSynthesis.speak(speech);
        // Enable microphone after speaking
        speech.onend = function() {
            enableMicrophone();
        };
        
        Swal.fire({
          title: speech.text,
          text: "Você não poderá voltar o lance!",
          position: 'center-start',
          icon: 'warning',
          showCancelButton: true,
          confirmButtonColor: '#3085d6',
          cancelButtonColor: '#d33',
          confirmButtonText: 'Sim',
          cancelButtonText: 'Não'
        }).then((result) => {
          if (result.isConfirmed) {
            chess.move(bestMove);
            var movesHistory = chess.history({ verbose: true });
            var lastHistoryMove = movesHistory[movesHistory.length -1];
            var source = lastHistoryMove.from;
            var destination = lastHistoryMove.to;
            chess.undo();
            makeMove(source, destination);
          }
        }); 
    }
    else {
        speech.text = 'Favor tentar novamente';
        disableMicrophone(); // Disable microphone before speaking
        window.speechSynthesis.speak(speech);
        // Enable microphone after speaking
        speech.onend = function() {
            enableMicrophone();
        };
        Swal.fire({
          position: 'center-start',
          icon: 'warning',
          title: 'Não encontramos nenhum lance correspondente, favor tentar novamente',
          showConfirmButton: false,
          timer: 3000
        })
        
        // force callback to make sure position os being read correctly            
        window["callback"]();   
    }
}


const commands = {
        'reativar': () => {
            enableDisableFreedomMode();
        }, 
        'desativar': () => {
            enableDisableFreedomMode();
        },
        'lances legais': () => {
        
            Swal.fire({
              position: 'center-start',
              icon: 'info',
              title: 'Lances legais da posição',
              text: chess.moves()
            })
        },
        'confirmar': () => {
            if (pageType == "daily") {
                document.querySelector('.ui_v5-button-component.ui_v5-button-primary').click();
            }
        },
        'cancelar': () => {
            if (pageType == "daily") {
                document.querySelector('.ui_v5-button-component.ui_v5-button-basic').click();
            }
            if (document.querySelector('.promotion-window')) {
                chess.undo();
                document.querySelector('.close-button').click();
            }
        },
        'OK': () => {
            if ($('.swal2-confirm').length) {
                $('.swal2-confirm').click();
            }
        },
        'sim': () => {
            if ($('.swal2-confirm').length) {
                $('.swal2-confirm').click();
            }
        },
        'não': () => {
            if ($('.swal2-cancel').length) {
                $('.swal2-cancel').click();
            }
        },
        'dama': () => {
            if (window['promotionQueen'] != null) {
                window['promotionQueen'].click();
            }
            let damaBranca = document.getElementsByClassName('.promotion-piece.wq');
            if (damaBranca != null) {
                $(".promotion-piece.wq").trigger( "click" );
            }
            let damaPreta = document.getElementsByClassName('.promotion-piece.bq');
            if (damaPreta != null) {
                $(".promotion-piece.bq").trigger( "click" );
            }
        },
        'bispo': () => {
            if (window['promotionBishop'] != null) {
                window['promotionBishop'].click();
            }
        },
        'cavalo': () => {
            if (window['promotionKnight'] != null) {
                window['promotionKnight'].click();
            }
        },
        'torre': () => {
            if (window['promotionRook'] != null) {
                window['promotionRook'].click();
            }
        },

        'abandonar': () => {
            var botaoAbandonar = document.querySelector('[aria-label="Desistir"]');
            if (botaoAbandonar != null) {
                botaoAbandonar.click();
            }
        },

        'desistir': () => {
            var botaoAbandonar = document.querySelector('[aria-label="Desistir"]');
            if (botaoAbandonar != null) {
                botaoAbandonar.click();
            }
        },

        // all possible moves in chess
        'dama :expr': {
          'regexp': /^dama\b(\s?[A-Ha-h1-8]?r?\s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
          'callback': function(expr){calculateFunction("Q"+expr.toLowerCase());}
        },
        'rei :expr': {
          'regexp': /^rei\b(\s?[A-Ha-h1-8]?\r?s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
          'callback': function(expr){calculateFunction("K"+expr.toLowerCase());}
        },
        'torre :expr': {
          'regexp': /^torre\b(\s?[A-Ha-h1-8]?r?\s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
          'callback': function(expr){calculateFunction("R"+expr.toLowerCase());}
        },
        'cavalo :expr': {
          'regexp': /^cavalo\b(\s?[A-Ha-h1-8]?r?\s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
          'callback': function(expr){calculateFunction("N"+expr.toLowerCase());}
        },
        'bispo :expr': {
          'regexp': /^bispo\b(\s?[A-Ha-h1-8]?\r?s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
          'callback': function(expr){calculateFunction("B"+expr.toLowerCase());}
        },
        ':expr': {
          'regexp': /^([A-Ha-h]?r?\s?(por)?(flor)?(for)?\s?[A-Ha-h]\s?[1-8]\s?(dama)?(torre)?)(bispo)?(cavalo)?/i,
          'callback': function(expr){calculateFunction(expr.toLowerCase());}
        },
        'roque': {
          'regexp': /^roque/i,
          'callback': function(expr){calculateFunction('O-O');}
        },
        'grande roque': {
          'regexp': /^grande roque/i,
          'callback': function(expr){calculateFunction('O-O-O');}
        },
    };


function createCustomSolution(phrasesArray, moveToBeMade) { 
    for(let i=0;i<phrasesArray.length;i++) {
        let oneOfThePhrases = phrasesArray[i];
        commands[oneOfThePhrases] = function(){ calculateFunction(moveToBeMade);};
    }
}

 // solution for Queen recognition in portuguese
commands['delmar :expr'] = {
    'regexp': /^delmar\b(\s?[A-Ha-h1-8]?r?\s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("Q"+expr.toLowerCase());}
};
commands['dema :expr'] = {
    'regexp': /^dema\b(\s?[A-Ha-h1-8]?r?\s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("Q"+expr.toLowerCase());}
};
commands['delma :expr'] = {
    'regexp': /^delma\b(\s?[A-Ha-h1-8]?r?\s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("Q"+expr.toLowerCase());}
};
commands['dhema :expr'] = {
    'regexp': /^dhema\b(\s?[A-Ha-h1-8]?r?\s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("Q"+expr.toLowerCase());}
};
commands['dilma :expr'] = {
    'regexp': /^dilma\b(\s?[A-Ha-h1-8]?r?\s?(por)?(flor)?\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("Q"+expr.toLowerCase());}
};
commands['de uma por :expr'] = {
    'regexp': /^deu uma por\b(\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("Qx"+expr.toLowerCase());}
};

// Solution for cx in Portuguese
commands['se for :expr'] = {
    'regexp': /^se for(\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("cx"+expr.toLowerCase());}
};
commands['sipor :expr'] = {
    'regexp': /^sipor(\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("cx"+expr.toLowerCase());}
};
commands['se pôr :expr'] = {
    'regexp': /^se pôr(\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("cx"+expr.toLowerCase());}
};

// Solution for cxd in Portuguese
commands['se for de:expr'] = {
    'regexp': /^se for de(\s?([1-8]))/i,
    'callback': function(expr){calculateFunction("cxd"+expr.toLowerCase());}
};
commands['sipor de:expr'] = {
    'regexp': /^sipor de(\s?([1-8]))/i,
    'callback': function(expr){calculateFunction("cxd"+expr.toLowerCase());}
};
commands['se pôr de:expr'] = {
    'regexp': /^se pôr de(\s?([1-8]))/i,
    'callback': function(expr){calculateFunction("cxd"+expr.toLowerCase());}
};

'se pôr de 6', 'se pôr de seis', 'se por de 6', 'se por de seis', 'sipor de 6'

// Solution for dx in portuguese
commands['depor :expr'] = {
    'regexp': /^depor(\s?([A-Ha-h]\s?[1-8]))/i,
    'callback': function(expr){calculateFunction("dx"+expr.toLowerCase());}
};


// Solution for cxd4 in portuguese
let phrasesArray = ['se for de quatro', 'se pôr de quatro', 'se por de quatro', 
'se por de 4', 'sipor de quatro', 'se pôr de 4'];
let moveToBeMade = 'cxd4'; 
createCustomSolution(phrasesArray, moveToBeMade);

// Solution for cxb5 in portuguese
phrasesArray = ['se por B5', 'sipor B5', 'se pôr B5', 'se por B 5', 'si por B 5'];
moveToBeMade = 'cxb5'; 
createCustomSolution(phrasesArray, moveToBeMade);

// Solution for Kg2 in portuguese
phrasesArray = ['raiz de 2', 'raiz de dois', 'Raí G2', 'raiz G2', 'Hi G2',
'RG 2', 'rede G2', 'rg2', 'Rei G2', 'Rage 2'];
moveToBeMade = 'Kg2'; 
createCustomSolution(phrasesArray, moveToBeMade);

// Solution for bxc3 in portuguese
phrasesArray = ['bebo C3', 'bbdc3', 'Bepo C3', 'bpac3', 'bebo c 3'];
moveToBeMade = 'bxc3'; 
createCustomSolution(phrasesArray, moveToBeMade);

// Solution for Qe2 in portuguese
phrasesArray = ['deu 2', 'deu dois', 'de 1:02', 'de 1 e 2', 'deu 1 e 2', 'deu 1:02', 'de 1 E2',
'damha II 2', 'dama e dois', 'damha I 2'];
moveToBeMade = 'Qe2'; 
createCustomSolution(phrasesArray, moveToBeMade);

// Solution for Kh2 in portuguese
phrasesArray = ['Hey H2', 'Hey H 2', 'Hey H dois', 'he H2', 'rh2', 'ri H2', 'RH 2', 'he H 2'];
moveToBeMade = 'Kh2'; 
createCustomSolution(phrasesArray, moveToBeMade);

// Solution for Nxd4 in portuguese
phrasesArray = ['cavalo por de quatro', 'cavalo puro de quatro', 
'cavalo por de 4', 'cavalo puro de 4', 'cavalo pôr de quatro'];
moveToBeMade = 'Nxd4'; 
createCustomSolution(phrasesArray, moveToBeMade);

// Solution for Qxg7 in portuguese
phrasesArray = ['de moto G7', 'de Moto G 7', 'é de moto G7', 'a de moto G7', 'o de moto G7',
'de 1 por G7', 'dama por G7', 'deu uma por G7', 'de uma por G7', 'Delmar por G7'];
moveToBeMade = 'Qxg7'; 
createCustomSolution(phrasesArray, moveToBeMade);


annyang.addCommands(commands);

annyang.addCallback('resultMatch', function(userSaid, commandText, phrases) {
    console.log(userSaid); // sample output: 'hello'
    console.log(commandText); // sample output: 'hello (there)'
    console.log(phrases); // sample output: ['hello', 'halo', 'yellow', 'polo', 'hello kitty']
  });

annyang.addCallback('resultNoMatch', function(possible_phrases) {
    console.log(possible_phrases);
    Swal.fire({
        position: 'center-start',
        icon: 'warning',
        title: possible_phrases[0] + '? Não entendi...',
        showConfirmButton: false,
        timer: 3000
    });
    speech.text = possible_phrases[0] + '? Não entendi...';
    disableMicrophone(); // Disable microphone before speaking
    window.speechSynthesis.speak(speech);
    // Enable microphone after speaking
    speech.onend = function() {
        enableMicrophone();
    };
    setTimeout(function() { }, 2000);

});

annyang.addCallback('error', function(err) {
    console.log('There was an error in Annyang!',err);
});

