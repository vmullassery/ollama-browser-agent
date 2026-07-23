(function () {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        switch (message.type) {
          case 'oba:scanDom': {
            sendResponse({ ok: true, elements: globalThis.OBA_DomScan.scanInteractiveElements() });
            break;
          }
          case 'oba:captureViewportSize': {
            sendResponse({ ok: true, width: window.innerWidth, height: window.innerHeight });
            break;
          }
          case 'oba:executeAction': {
            const { action } = message;
            let result;
            if (action.type === 'click') result = globalThis.OBA_PageActions.clickElement(action.elementId);
            else if (action.type === 'type') result = globalThis.OBA_PageActions.typeIntoElement(action.elementId, action.text);
            else if (action.type === 'scroll') result = globalThis.OBA_PageActions.scrollBy(action.deltaY || 400);
            else if (action.type === 'extract') result = globalThis.OBA_PageActions.extractText(action.elementId);
            else if (action.type === 'click-coordinates') result = globalThis.OBA_PageActions.clickAtCoordinates(action.x, action.y);
            else throw new Error(`Unknown action type: ${action.type}`);
            sendResponse({ ok: true, result });
            break;
          }
          default:
            sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
        }
      } catch (error) {
        sendResponse({ ok: false, error: error.message });
      }
    })();
    return true;
  });
})();
