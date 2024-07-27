// get classes for elements for functions on different pages
window['currentUrl'] = window.location.href;

// Observe behavior for analysis mode
if (currentUrl.includes("analysis")) {
    window['movesListBoxClass'] = '.move-list';
    window['moveNodeClass'] = '.white-move, .black-move'; // Updated class names
    window['pageType'] = "analysis";
}
// Observe behavior for play mode
else if (currentUrl.includes("play")) {
    window['movesListBoxClass'] = '.move-list';
    window['moveNodeClass'] = '.white-move, .black-move'; // Updated class names
    window['pageType'] = "play";
}
// Observe behavior for daily play mode
else if (currentUrl.includes("daily")) {
    window['movesListBoxClass'] = '.move-list';
    window['moveNodeClass'] = '.white-move, .black-move'; // Updated class names
    window['pageType'] = "daily";
}
// Observe behavior for live game mode
else if ((currentUrl.includes("live")) && (!currentUrl.includes("game"))) {
    window['movesListBoxClass'] = '.vertical-move-list-component';
    window['moveNodeClass'] = '.vertical-move-list-notation-vertical';
    window['pageType'] = "liveNoGame";
}
// Observe behavior for live game mode
else if ((currentUrl.includes("live")) && (currentUrl.includes("game"))) {
    window['movesListBoxClass'] = '.move-list';
    window['moveNodeClass'] = '.white-move, .black-move'; // Updated class names
    window['pageType'] = "liveGame";
}
// Observe behavior for puzzles
else if (currentUrl.includes("puzzles")) {
    window['pageType'] = "puzzles";
}
else {
    window['pageType'] = "";
}