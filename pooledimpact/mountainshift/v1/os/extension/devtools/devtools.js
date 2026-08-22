// devtools/devtools.js
// Runs in the DevTools context — creates the Sentinel panel.

chrome.devtools.panels.create(
  '🟣 Sentinel',          // panel tab title
  '../icons/icon16.png',  // icon
  '../panel/panel.html',  // panel UI
  (panel) => {
    panel.onShown.addListener((panelWindow) => {
      // Panel is now visible — panel.html takes over from here
    });
  }
);
