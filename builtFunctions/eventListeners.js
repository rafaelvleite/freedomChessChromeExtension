// Event listeners for daily games
window['confirmButtonClicked'] = false;

if (window['pageType'] == "daily") {
    const observer = new MutationObserver(() => {
        const confirmButton = document.querySelector('.ui_v5-button-component.ui_v5-button-primary');
        const cancelButton = document.querySelector('.ui_v5-button-component.ui_v5-button-basic');
        if (confirmButton && cancelButton) {
            window['confirmButton'] = confirmButton;
            window['cancelButton'] = cancelButton;
            confirmButton.addEventListener('click', () => {
                confirmButtonClicked = true;
            });
            observer.disconnect();
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

// Event listeners for promotion
var checkPromotionWindowExists = setInterval(function() {    
    if (document.querySelector('.promotion-window') !== null) {
        var divButtons = document.querySelectorAll('.promotion-piece');
        for (var i=0, max=divButtons.length; i < max; i++) {
            if (divButtons[i].classList.contains('bb') || divButtons[i].classList.contains('wb')) {
                window['promotionBishop'] = divButtons[i]
            }
            else if (divButtons[i].classList.contains('bn') || divButtons[i].classList.contains('wn')) {
                window['promotionKnight'] = divButtons[i]
            }
            else if (divButtons[i].classList.contains('bq') || divButtons[i].classList.contains('wq')) {
                window['promotionQueen'] = divButtons[i]
            }
            else if (divButtons[i].classList.contains('br') || divButtons[i].classList.contains('wr')) {
                window['promotionRook'] = divButtons[i]
            }
        }
        clearInterval(checkPromotionWindowExists);            
    }   
    else{
    
    }     
}, 100); // check every 100ms