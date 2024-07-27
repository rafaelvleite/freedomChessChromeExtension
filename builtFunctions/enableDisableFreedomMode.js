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

window['freedomEnabled'] = false;

window['confirm'] = function(question, text, confirmButtonText, cancelButtonText, callback) {

    // Text to Speech
    disableMicrophone(); // Disable microphone before speaking
    window['speech'] = new SpeechSynthesisUtterance();
    speech.lang = "pt-BR";
    speech.rate = 1.2;
    speech.pitch = 1;
    speech.volume = 1;    
    speech.text = question;
    window.speechSynthesis.speak(speech);
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
          cancelButtonText: cancelButtonText,
    }).then((confirmed) => {
        callback(confirmed && confirmed.value == true);
    });
}

// switch enable/disable Freedom Mode
window['enableDisableFreedomMode'] = function() {
    
    if (freedomEnabled == false) {
    
        var question = 'Você deseja ativar o Modo Freedom?';
        var text = "Você passará a falar os lances ao invés de usar o mouse.";
        var confirmButtonText = 'Sim';
        var cancelButtonText = 'Não';
        
        confirm(question, text, confirmButtonText, cancelButtonText, function (confirmed) {
            if (confirmed) {
                speech.text = 'O modo Freedom está ativo.';
                disableMicrophone(); // Disable microphone before speaking
                window.speechSynthesis.speak(speech);
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
                // Enable microphone after speaking
                speech.onend = function() {
                    enableMicrophone();
                };
            }
            else {
                freedomEnabled = false;
            }
        });
    }
            
    else if (freedomEnabled == true) {
        question = 'Você deseja desativar o Modo Freedom?';
        text = "Você passará a fazer os lances com o mouse normalmente.";
        confirmButtonText = 'Sim';
        var cancelButtonText = 'Não';
        
        confirm(question, text, confirmButtonText, cancelButtonText, function (confirmed) {
            if (confirmed) {
                observer.disconnect(); 
                speech.text = 'O modo Freedom foi desativado.';
                disableMicrophone(); // Disable microphone before speaking
                window.speechSynthesis.speak(speech);
                Swal.fire({
                    icon: 'success',
                    title: "Destivado!",
                    text: "O modo Freedom foi desativado.",
                    showConfirmButton: false,
                    
                    timer: 1500
                });
                freedomEnabled = false;
                // Enable microphone after speaking
                speech.onend = function() {
                    enableMicrophone();
                };
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
