'use strict';

const AUDIO_OWNER_KEY = 'freedomChessAudioOwner';

const MESSAGE_TYPES = Object.freeze({
  CLAIM: 'freedomChess:audio:claim',
  RELEASE: 'freedomChess:audio:release',
  STATE: 'freedomChess:audio:state',
  REVOKED: 'freedomChess:audio:revoked',
  TOOLBAR_TOGGLE: 'freedomChess:toolbar-toggle',
});

let operationQueue = Promise.resolve();

function enqueue(operation) {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function errorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || 'Erro desconhecido.');
}

function senderIdentity(sender) {
  const tabId = sender && sender.tab && sender.tab.id;
  if (!Number.isInteger(tabId)) {
    throw new Error('A mensagem precisa partir de uma aba do Chess.com.');
  }

  const identity = {
    tabId,
    frameId: Number.isInteger(sender.frameId) ? sender.frameId : 0,
    claimedAt: Date.now(),
  };

  if (typeof sender.documentId === 'string') {
    identity.documentId = sender.documentId;
  }

  return identity;
}

function sameOwner(left, right) {
  if (!left || !right || left.tabId !== right.tabId || left.frameId !== right.frameId) {
    return false;
  }

  if (left.documentId && right.documentId) {
    return left.documentId === right.documentId;
  }

  return true;
}

async function readOwner() {
  const stored = await chrome.storage.session.get(AUDIO_OWNER_KEY);
  const owner = stored && stored[AUDIO_OWNER_KEY];

  if (!owner || !Number.isInteger(owner.tabId)) {
    return null;
  }

  return owner;
}

async function writeOwner(owner) {
  await chrome.storage.session.set({ [AUDIO_OWNER_KEY]: owner });
}

async function clearOwner() {
  await chrome.storage.session.remove(AUDIO_OWNER_KEY);
}

function flagDeliveryFailure(tabId, error) {
  // A swallowed delivery failure made a toolbar click a total no-op: the usual
  // cause is a Chess.com tab loaded before the last extension reload.
  globalThis.console?.warn?.('[FreedomChess] não foi possível falar com a aba', tabId, errorMessage(error));
  try {
    chrome.action?.setBadgeText?.({ tabId, text: '!' });
    chrome.action?.setBadgeBackgroundColor?.({ tabId, color: '#c33b32' });
    chrome.action?.setTitle?.({
      tabId,
      title: 'Freedom Chess não está ativo nesta aba. Recarregue a página do Chess.com.',
    });
  } catch (_badgeError) {
    // Badge feedback is best-effort; the console warning already reported it.
  }
}

function clearDeliveryFailure(tabId) {
  try {
    chrome.action?.setBadgeText?.({ tabId, text: '' });
    chrome.action?.setTitle?.({ tabId, title: 'Alternar Freedom Chess' });
  } catch (_badgeError) {
    // Nothing to clear if the action API is unavailable.
  }
}

async function sendToTab(tabId, message, options) {
  try {
    await chrome.tabs.sendMessage(tabId, message, options);
    clearDeliveryFailure(tabId);
    return true;
  } catch (error) {
    // The tab may have navigated or closed between ownership checks.
    flagDeliveryFailure(tabId, error);
    return false;
  }
}

async function revokeOwner(owner, replacement) {
  const options = { frameId: Number.isInteger(owner.frameId) ? owner.frameId : 0 };
  if (typeof owner.documentId === 'string') {
    options.documentId = owner.documentId;
  }

  return sendToTab(
    owner.tabId,
    {
      type: MESSAGE_TYPES.REVOKED,
      owner: replacement,
    },
    options,
  );
}

async function claimAudio(sender) {
  const claimant = senderIdentity(sender);
  const previousOwner = await readOwner();

  await writeOwner(claimant);

  let previousOwnerRevoked = false;
  if (previousOwner && !sameOwner(previousOwner, claimant)) {
    previousOwnerRevoked = await revokeOwner(previousOwner, claimant);
  }

  return {
    ok: true,
    owner: claimant,
    previousOwnerRevoked,
  };
}

async function releaseAudio(sender) {
  const claimant = senderIdentity(sender);
  const owner = await readOwner();
  const released = sameOwner(owner, claimant);

  if (released) {
    await clearOwner();
  }

  return {
    ok: true,
    released,
    owner: released ? null : owner,
  };
}

async function audioState(sender) {
  const owner = await readOwner();
  let isOwner = false;

  try {
    isOwner = sameOwner(owner, senderIdentity(sender));
  } catch (_error) {
    // Extension pages may inspect state, but can never own page audio.
  }

  return {
    ok: true,
    owner,
    isOwner,
  };
}

function respond(sendResponse, task) {
  task.then(
    (result) => {
      try {
        sendResponse(result);
      } catch (_error) {
        // The sender may have navigated while the asynchronous task completed.
      }
    },
    (error) => {
      try {
        sendResponse({
          ok: false,
          error: errorMessage(error),
        });
      } catch (_sendError) {
        // There is no remaining message port on which to report the failure.
      }
    },
  );
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  switch (message.type) {
    case MESSAGE_TYPES.CLAIM:
      respond(sendResponse, enqueue(() => claimAudio(sender)));
      return true;
    case MESSAGE_TYPES.RELEASE:
      respond(sendResponse, enqueue(() => releaseAudio(sender)));
      return true;
    case MESSAGE_TYPES.STATE:
      respond(sendResponse, enqueue(() => audioState(sender)));
      return true;
    default:
      return false;
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (!Number.isInteger(tab && tab.id)) {
    return;
  }

  void sendToTab(tab.id, { type: MESSAGE_TYPES.TOOLBAR_TOGGLE });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    const owner = await readOwner();
    if (owner && owner.tabId === tabId) {
      await clearOwner();
    }
  }).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  void enqueue(clearOwner).catch(() => undefined);
});
