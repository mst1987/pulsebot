// German bot texts of the public event messages: the signup message
// (services/events/eventMessage.js, utils/signup/capacity.js), the
// announcement, the Discord event, the pings and reminders, the cancel/delete
// DMs and the public event page (web/pages/eventPublicPage.js).
module.exports = {
    // the signup message
    "{count} signed up": "{count} angemeldet",
    "+{count} more": "+{count} weitere",
    "**Cancelled**": "**Abgesagt**",
    "**Signups closed**": "**Anmeldung geschlossen**",
    "you can still sign off.": "du kannst dich noch abmelden.",
    "The raid has started – signups are closed.": "Der Raid hat begonnen – die Anmeldung ist geschlossen.",
    "The signup deadline has passed – only “Late” or Absence now.": "Der Anmeldeschluss ist vorbei – nur noch „Spät“ oder Absagen.",
    "Cancelled: {title}": "Abgesagt: {title}",
    "My characters …": "Meine Charaktere …",
    "from your profile – up to 3 at once": "aus deinem Profil – bis zu 3 auf einmal",
    "Sign up – pick a character or class …": "Anmelden – Charakter oder Klasse wählen …",
    // the announcement of a new raid (services/events/eventAnnounce.js)
    "New raid: {title}": "Neuer Raid: {title}",
    "[Sign up]({url})": "[Anmelden]({url})",
    "A new raid is on the calendar.": "Ein neuer Raid steht im Kalender.",
    // the Discord event's description (services/discord/discordEvent.js)
    "❌ Cancelled: {reason}": "❌ Abgesagt: {reason}",
    "❌ Cancelled": "❌ Abgesagt",
    "Sign up only through the message in the channel – “Interested” here does not count.": "Anmelden nur über die Nachricht im Kanal – „Interessiert“ zählt hier nicht.",
    // pings (services/discord/pingDelivery.js) without a text of the orga
    "Please sign up or sign off for the raid, so the roster is complete.": "Bitte melde dich für den Raid an oder ab, damit das Roster vollständig ist.",
    "Please sign up or sign off for the raid.": "Bitte melde dich für den Raid an oder ab.",
    // reminders (web/events/reminders.js)
    "Reminder: {title} starts {when}. See you soon!": "Erinnerung: {title} startet {when}. Bis gleich!",
    "Reminder: the raid starts {when}. See you soon!": "Erinnerung: Der Raid startet {when}. Bis gleich!",
    "signup deadline {when}": "Anmeldeschluss {when}",
    "raid start {when}": "Raidbeginn {when}",
    "Reminder: please sign up or sign off for {title} ({until}).": "Erinnerung: Bitte melde dich für {title} an oder ab ({until}).",
    "Reminder: please sign up or sign off for the raid ({until}).": "Erinnerung: Bitte melde dich für den Raid an oder ab ({until}).",
    // the event management (services/events/eventManage.js): the note on a move, the DMs
    "📅 **{title}** has been moved: now {when} ({relative}).": "📅 **{title}** wurde verschoben: jetzt {when} ({relative}).",
    "❌ **{title}** on {when} has been cancelled.": "❌ **{title}** am {when} wurde abgesagt.",
    "❌ **{title}** has been cancelled.": "❌ **{title}** wurde abgesagt.",
    "🗑️ **{title}** on {when} will not take place — the event has been removed.": "🗑️ **{title}** am {when} findet nicht statt – das Event wurde entfernt.",
    "🗑️ **{title}** will not take place — the event has been removed.": "🗑️ **{title}** findet nicht statt – das Event wurde entfernt.",
    // the public event page (web/pages/eventPublicPage.js)
    "Cancelled": "Abgesagt",
    "Raid in progress": "Raid läuft",
    "Signups closed": "Anmeldung geschlossen",
    "Signup deadline passed": "Anmeldeschluss vorbei",
    "{size}-man": "{size}er",
    "Date · server time": "Datum · Serverzeit",
    "until {time} server time": "bis {time} Serverzeit",
    "Cancelled.": "Abgesagt.",
    "Nobody has signed up yet.": "Noch niemand angemeldet.",
    "Add to calendar": "Zum Kalender hinzufügen",
    "Sign up in the menu": "Im Menü anmelden",
    "Public view – no login needed. Sign up in Discord or in the menu.": "Öffentliche Ansicht – kein Login nötig. Anmelden im Discord oder im Menü.",
    "EventHelper · Public event view": "EventHelper · Öffentliche Event-Ansicht",
};
