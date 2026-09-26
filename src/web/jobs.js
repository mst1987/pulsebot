// The bot process's background jobs (#424): every periodic sweep and every
// listener that keeps a Discord message current, started in one place.
// server.js only serves HTTP; bot.js calls startJobs(client) right after
// startWebServer(client), so the jobs come up where they did when the server
// started them itself — after the web server, before the Discord login.
//
// Each job's own start function is idempotent and unref's its timers, so a job
// never keeps the process alive on its own. The order below is the old order
// in server.js, with the application sweep (formerly started by bot.js) last;
// the jobs that need the Discord gateway (role sync, talk overview, event
// series) wait for it themselves with a delayed first run.
const discord = require("./discord");
const sheetCleanup = require("../utils/sheetCleanup");
const raidEventScan = require("./raidEventScan");
const logAutoLink = require("./logAutoLink");
const eventMessage = require("./eventMessage");
const reminders = require("./reminders");
const roleSync = require("./roleSync");
const talkOverview = require("./talkOverview");
const eventSeries = require("./eventSeries");
const applicationState = require("../utils/recruitment/applicationState");

const JOBS = [
    // Sweep due raid-sheet copies (deleted a few days after each raid).
    { name: "sheetCleanup", start: () => sheetCleanup.startSheetCleanup(), stop: () => sheetCleanup.stopSheetCleanup() },
    // Periodically snapshot finished Raid-Helper events into raidEventStore (see
    // loadRecentEvents), so a raid shows up on the dashboard even if nobody opens
    // it right after the raid ends.
    { name: "raidEventScan", start: () => raidEventScan.startRaidEventScan(), stop: () => raidEventScan.stopRaidEventScan() },
    // Assign detected Warcraft-Logs to their raid in the background, so a log the
    // listener could not place at detection time (Raid-Helper unreachable, event
    // not yet known) still ends up linked without an admin clicking anything.
    { name: "logAutoLink", start: () => logAutoLink.startLogAutoLink(), stop: () => logAutoLink.stopLogAutoLink() },
    // Keep the bot's event messages of EventHelper events current as signups change.
    { name: "eventMessageSync", start: () => eventMessage.startEventMessageSync(), stop: () => eventMessage.stopEventMessageSync() },
    // Automatic reminders per raid category and the role sync between the event
    // and the talk server (#264). Both do nothing until configured.
    { name: "reminders", start: () => reminders.startReminders(), stop: () => reminders.stopReminders() },
    { name: "roleSync", start: () => roleSync.startRoleSync(), stop: () => roleSync.stopRoleSync() },
    // The raid overview on the talk server (#257); does nothing until configured.
    { name: "talkOverview", start: () => talkOverview.startTalkOverview(), stop: () => talkOverview.stopTalkOverview() },
    // Recurring events per category (#289): creates each date's event in time; nothing until a series exists.
    { name: "eventSeries", start: () => eventSeries.startEventSeries(), stop: () => eventSeries.stopEventSeries() },
    // Drop /apply applications that were started and then abandoned.
    { name: "applicationState", start: () => applicationState.start(), stop: () => applicationState.stop() },
];

let running = false;

/**
 * Start every background job once (idempotent: a second call starts nothing).
 * Pass the bot client, so the jobs that talk to Discord find it.
 * @returns {string[]} the names of the jobs, in start order
 */
function startJobs(client) {
    if (client) discord.setClient(client);
    const names = JOBS.map((job) => job.name);
    if (running) return names;
    running = true;
    for (const job of JOBS) job.start();
    console.log(`Background jobs started: ${names.join(", ")}`);
    return names;
}

/** Stop every background job, in reverse start order (idempotent). */
function stopJobs() {
    for (const job of [...JOBS].reverse()) job.stop();
    running = false;
}

module.exports = { startJobs, stopJobs, JOBS };
