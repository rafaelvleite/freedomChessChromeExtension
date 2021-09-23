// Speech Recognition

const calculateFunction = function(expr) {

    var lance = expr.replace(/por/, "x");
    lance = lance.replace(/ flor /, " x ");
    lance = lance.replace(/ for /, " x ");
    lance = lance.replace(/ ar /, " a ");
    lance = lance.replace(/ de /, " d ");
    lance = lance.replace(/dama/, "Q");
    lance = lance.replace(/bispo/, "B");
    lance = lance.replace(/cavalo/, "N");
    lance = lance.replace(/torre/, "R");
    lance = lance.replace(/ /g,'');
    
    console.log(lance);

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
        console.log(lance, legalMoves[move], levenshteinScore, jaroWrinkerScore);
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
        lanceVencedor = lanceVencedor.replace("x", "por ");
    
        speech.text = 'Confirma ' + lanceVencedor + '?';
        window.speechSynthesis.speak(speech);
        
        
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
        console.log("Não passou");
        speech.text = 'Não encontramos nenhum lance correspondente, favor tentar novamente';
        window.speechSynthesis.speak(speech);
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
        'deficiente visual': () => { 
            var deficienteVisualMessage = "Modo para Deficiencia Visual Ativado!"
            speech.text = deficienteVisualMessage;
            window.speechSynthesis.speak(speech);
        },
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
                console.log(document.querySelector('.close-button'));
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
        
        // all possible moves in chess
        
        // Start of solution - problem for cxd4 in Portuguese
        'se for de quatro': () => {
            calculateFunction("c por d4");
        },
        'se pôr de quatro': () => {
            calculateFunction("c por d4");
        },
        'se por de quatro': () => {
            calculateFunction("c por d4");
        },
        'se por de 4': () => {
            calculateFunction("c por d4");
        },
        'sipor de quatro': () => {
            calculateFunction("c por d4");
        },
        'se pôr de 4': () => {
            calculateFunction("c por d4");
        },
        // End of solution
        
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

    
annyang.addCommands(commands);


annyang.addCallback('resultNoMatch', function(possible_phrases) {
    console.log(possible_phrases);
});

annyang.addCallback('error', function(err) {
    console.log('There was an error in Annyang!',err);
});

