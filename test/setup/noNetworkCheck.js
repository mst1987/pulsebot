// Second half of the network guard (#432), a `setupFilesAfterEnv` entry: a
// test during which test/setup/noNetwork.js blocked a request fails, even when
// the code under test caught the error and carried on. A suite that blocks on
// purpose (test/setup/noNetwork.test.js) takes its attempts with
// `takeBlocked()` inside the test.
const { takeBlocked } = require("./noNetwork");

function checkNoNetwork() {
    const hits = takeBlocked();
    if (hits.length) {
        throw new Error(`Der Test wollte ins Netz: ${hits.join(", ")} - jest.mock verwenden (test/setup/noNetwork.js)`);
    }
}

if (typeof afterEach === "function") afterEach(checkNoNetwork);

module.exports = { checkNoNetwork };
