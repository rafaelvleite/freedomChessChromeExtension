// get classes for elements for functions on different pageswindow['currentUrl'] = window.location.href;// Observe behavior for analysis modeif (currentUrl.includes("analysis")){    window['movesListBoxClass'] = '.move-list.horizontal-move-list';    window['moveNodeClass'] = '.move-node';    window['pageType'] = "analysis";}// Observe behavior for play modeelse if (currentUrl.includes("play")){    window['movesListBoxClass'] = '.layout-move-list.vertical-move-list';    window['moveNodeClass'] = '.move';    window['pageType'] = "play";}// Observe behavior for daily play modeelse if (currentUrl.includes("daily")){    window['movesListBoxClass'] = '.move-list-move-list.vertical-move-list';    window['moveNodeClass'] = '.move';    window['pageType'] = "daily";}// Observe behavior for live game modeelse if ((currentUrl.includes("live")) && (!currentUrl.includes("game"))){    window['movesListBoxClass'] = '.vertical-move-list-component';    window['moveNodeClass'] = '.vertical-move-list-notation-vertical';    window['pageType'] = "liveNoGame";}// Observe behavior for live game modeelse if ((currentUrl.includes("live")) && (currentUrl.includes("game"))){    window['movesListBoxClass'] = '.move-list-move-list.vertical-move-list';    window['moveNodeClass'] = '.move';    window['pageType'] = "liveGame";}// Observe behavior for puzzleselse if (currentUrl.includes("puzzles")){    window['pageType'] = "puzzles";}