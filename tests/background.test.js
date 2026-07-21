"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const BACKGROUND_SOURCE = fs.readFileSync(
    path.join(__dirname, "../background.js"),
    "utf8"
);

const OWNER_KEY = "freedomChessAudioOwner";

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createEvent() {
    const listeners = [];
    return {
        addListener(listener) {
            listeners.push(listener);
        },
        emit(...args) {
            return listeners.map((listener) => listener(...args));
        }
    };
}

function sender(tabId, documentId = `document-${tabId}`) {
    return {
        tab: { id: tabId },
        frameId: 0,
        documentId
    };
}

function createHarness() {
    const sessionValues = Object.create(null);
    const sentToTabs = [];
    const runtimeMessage = createEvent();
    const runtimeInstalled = createEvent();
    const tabsRemoved = createEvent();
    const actionClicked = createEvent();

    const chrome = {
        storage: {
            session: {
                async get(key) {
                    return { [key]: clone(sessionValues[key]) };
                },
                async set(values) {
                    for (const [key, value] of Object.entries(values)) {
                        sessionValues[key] = clone(value);
                    }
                },
                async remove(key) {
                    delete sessionValues[key];
                }
            }
        },
        tabs: {
            async sendMessage(tabId, message, options) {
                sentToTabs.push({
                    tabId,
                    message: clone(message),
                    options: clone(options)
                });
            },
            onRemoved: tabsRemoved
        },
        action: {
            onClicked: actionClicked
        },
        runtime: {
            onMessage: runtimeMessage,
            onInstalled: runtimeInstalled
        }
    };

    vm.runInNewContext(BACKGROUND_SOURCE, { chrome }, { filename: "background.js" });

    async function send(type, from) {
        return new Promise((resolve, reject) => {
            const results = runtimeMessage.emit(
                { type },
                from,
                (response) => resolve(clone(response))
            );

            if (!results.includes(true)) {
                reject(new Error(`Background ignored message: ${type}`));
            }
        });
    }

    return {
        actionClicked,
        owner() {
            return clone(sessionValues[OWNER_KEY]) || null;
        },
        send,
        sentToTabs,
        tabsRemoved
    };
}

test("a claim from a second tab revokes the first audio owner", async () => {
    const harness = createHarness();

    const firstClaim = await harness.send(
        "freedomChess:audio:claim",
        sender(11, "first-document")
    );
    assert.equal(firstClaim.ok, true);
    assert.equal(firstClaim.owner.tabId, 11);
    assert.equal(harness.sentToTabs.length, 0);

    const secondClaim = await harness.send(
        "freedomChess:audio:claim",
        sender(22, "second-document")
    );
    assert.equal(secondClaim.ok, true);
    assert.equal(secondClaim.owner.tabId, 22);
    assert.equal(secondClaim.previousOwnerRevoked, true);
    assert.equal(harness.owner().tabId, 22);

    assert.deepEqual(harness.sentToTabs, [
        {
            tabId: 11,
            message: {
                type: "freedomChess:audio:revoked",
                owner: secondClaim.owner
            },
            options: {
                frameId: 0,
                documentId: "first-document"
            }
        }
    ]);
});

test("only the current tab and document can release audio ownership", async () => {
    const harness = createHarness();
    await harness.send("freedomChess:audio:claim", sender(22, "current-document"));

    const otherTab = await harness.send(
        "freedomChess:audio:release",
        sender(11, "other-document")
    );
    assert.equal(otherTab.ok, true);
    assert.equal(otherTab.released, false);
    assert.equal(harness.owner().tabId, 22);

    const staleDocument = await harness.send(
        "freedomChess:audio:release",
        sender(22, "stale-document")
    );
    assert.equal(staleDocument.released, false);
    assert.equal(harness.owner().documentId, "current-document");

    const ownerRelease = await harness.send(
        "freedomChess:audio:release",
        sender(22, "current-document")
    );
    assert.equal(ownerRelease.ok, true);
    assert.equal(ownerRelease.released, true);
    assert.equal(harness.owner(), null);
});

test("closing the owner tab clears the session owner", async () => {
    const harness = createHarness();
    await harness.send("freedomChess:audio:claim", sender(31));

    harness.tabsRemoved.emit(31);

    // A queued state request runs after the queued tab-removal cleanup.
    const state = await harness.send("freedomChess:audio:state", sender(99));
    assert.equal(state.ok, true);
    assert.equal(state.owner, null);
    assert.equal(state.isOwner, false);
    assert.equal(harness.owner(), null);
});

test("clicking the toolbar action toggles Freedom Chess in that tab", async () => {
    const harness = createHarness();

    harness.actionClicked.emit({ id: 44 });
    await Promise.resolve();

    assert.deepEqual(harness.sentToTabs, [
        {
            tabId: 44,
            message: { type: "freedomChess:toolbar-toggle" },
            options: undefined
        }
    ]);
});
