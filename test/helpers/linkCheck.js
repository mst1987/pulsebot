// For suites whose overviews link Discord channels (#537): every link goes
// through src/services/discord/linkCheck.js, which only hands out a link to a
// channel it knows exists. A suite without a real client marks its channels as
// existing here — linkCheck keeps the last known state while the bot is
// offline, exactly the rule the overviews rely on in production.
//
//   const { knownChannels } = require("../../helpers/linkCheck");
//   beforeEach(() => knownChannels("c1", "c2"));
const linkCheck = require("../../src/services/discord/linkCheck");

/** Forget every state, then mark the given channel ids as existing. */
function knownChannels(...ids) {
    linkCheck._reset();
    for (const id of ids.flat()) linkCheck.channelCreated(id);
    return linkCheck;
}

/** Forget every state, then mark the given channel ids as deleted. */
function deletedChannels(...ids) {
    linkCheck._reset();
    for (const id of ids.flat()) linkCheck.channelDeleted(id);
    return linkCheck;
}

module.exports = { knownChannels, deletedChannels, linkCheck };
