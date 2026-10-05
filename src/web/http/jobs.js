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
//
// Every job starts inside budget.runInBackground(): the async context carries
// over to its timers, so whatever a job asks Raid-Helper counts as background
// work and stops first when the day's requests run short (utils/raidhelper/budget.js).
const discord = require("../../services/discord/discord");
const budget = require("../../utils/raidhelper/budget");
const sheetCleanup = require("../../utils/setup/sheetCleanup");
const raidhelperSync = require("../../services/events/raidhelperSync");
const logAutoLink = require("../../services/logcheck/logAutoLink");
const eventMessage = require("../../services/events/eventMessage");
const reminders = require("../events/reminders");
const roleSync = require("../../services/discord/roleSync");
const talkOverview = require("../../services/talk/talkOverview");
const eventSeries = require("../events/eventSeries");
const applicationState = require("../../utils/recruitment/applicationState");
const availabilityPanel = require("../../services/signups/availabilityPanel");

const JOBS = [
    // Sweep due raid-sheet copies (deleted a few days after each raid).
    { name: "sheetCleanup", start: () => sheetCleanup.startSheetCleanup(), stop: () => sheetCleanup.stopSheetCleanup() },
    // The only reader of Raid-Helper's event list (#608): fetch it every few
    // minutes into a store every page reads, then snapshot the finished raids
    // into raidEventStore, so a raid stays on the dashboard after Raid-Helper drops it.
    { name: "raidhelperSync", start: () => raidhelperSync.startRaidhelperSync(), stop: () => raidhelperSync.stopRaidhelperSync() },
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
    // Once after the start: redraw the absence/attendance panels whose text a deploy changed.
    { name: "availabilityPanels", start: () => availabilityPanel.startPanelRefresh(), stop: () => availabilityPanel.stopPanelRefresh() },
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
    for (const job of JOBS) budget.runInBackground(() => job.start());
    console.log(`Background jobs started: ${names.join(", ")}`);
    return names;
}

/** Stop every background job, in reverse start order (idempotent). */
function stopJobs() {
    for (const job of [...JOBS].reverse()) job.stop();
    running = false;
}

module.exports = { startJobs, stopJobs, JOBS };
