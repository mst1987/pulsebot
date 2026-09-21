// The raider-facing Discord texts are English (the community mostly is), while
// the shared services — signupService, raiderProfileStore — answer the web
// admin in German. The bot's signup flows run every message they pass on to a
// raider through `toEnglish()`: a known service sentence becomes its English
// counterpart, anything unknown passes unchanged (better a German sentence than
// none at all).
//
// Keep this table in step with the `fail(...)` / `error:` / `notice` texts of
// web/signupService.js and web/raiderProfileStore.js; the test runs the real
// service refusals through it and fails on a German leftover.

const RULES = [
    // signupService.validateSignup / submitSignup / submitSignups
    [/^Event nicht gefunden\.?$/, "This event no longer exists."],
    [/^Für dieses Event meldest du dich über Raid-Helper im Discord an\.$/, "Sign up for this event through Raid-Helper in Discord."],
    [/^Anmeldung läuft über Raid-Helper\.$/, "Signups for this raid run through Raid-Helper."],
    [/^Unbekannter Anmeldestatus „(.*)“\.$/, "Unknown signup status “$1”."],
    [/^Das Event wurde abgesagt – Anmeldungen sind nicht mehr möglich\.$/, "The event was cancelled – signups are no longer possible."],
    [/^Der Raid hat schon begonnen – Anmeldungen sind geschlossen\.$/, "The raid has already started – signups are closed."],
    [/^Die Anmeldung ist geschlossen – du kannst dich nur noch abmelden\.$/, "Signups are closed – you can only sign off now."],
    [/^Der Anmeldeschluss ist vorbei – du kannst dich nur noch abmelden oder „Spät“ angeben\.$/, "The signup deadline has passed – you can only sign off or sign up as “Late” now."],
    [/^Höchstens (\d+) Charaktere je Anmeldung\.$/, "At most $1 characters per signup."],
    [/^Höchstens (\d+) Charaktere\.$/, "At most $1 characters."],
    [/^Dieser Charakter steht nicht in deinem Profil\.$/, "This character is not in your profile."],
    [/^(.+) steht nicht in deinem Profil\.$/, "$1 is not in your profile."],
    [/^Bitte eine Spezialisierung wählen\.$/, "Please pick a spec."],
    [/^Diese Spezialisierung ist für (.+) nicht im Profil hinterlegt\.$/, "This spec is not in your profile for $1."],
    [/^Der Raid ist voll \((\d+)\/(\d+)\) – es geht keine Anmeldung mehr\. Frag die Raidleitung\.$/, "The raid is full ($1/$2) – no more signups. Ask the raid lead."],
    [/^Der Raid ist voll \((\d+)\/(\d+)\) – du stehst auf der Warteliste \(Bank\)\. Ob jemand nachrückt, entscheidet die Raidleitung\.$/,
        "The raid is full ($1/$2) – you are on the waiting list (bench). The raid lead decides who moves up."],
    [/^Der Raid ist damit voll – die Anmeldung ist jetzt geschlossen\.$/, "The raid is now full – signups are closed."],
    [/^Für diesen Raid brauchst du eine Raider-Rolle\.$/, "You need a raider role for this raid."],
    [/^Kein Nutzer\.$/, "No user."],
    [/^Keiner der gewählten Charaktere passt$/, "None of the picked characters fits"],
    [/^Kein Charakter gewählt$/, "No character picked"],
    [/^Klasse passt nicht zu diesem Raid$/, "class does not fit this raid"],
    [/^laut Profil ohne brauchbares Gear$/, "no usable gear according to your profile"],
    // utils/setup/reasons.js — the bench reasons a setup DM passes on
    [/^Von der Orga auf die Bank gesetzt$/, "Benched by the raid lead"],
    [/^Keine Spec mit brauchbarem Gear$/, "No spec with usable gear"],
    [/^Abgemeldet$/, "Signed off"],
    [/^Keine Spezialisierung angegeben$/, "No spec given"],
    [/^Tank voll \((\d+)\/(\d+)\)$/, "Tanks full ($1/$2)"],
    [/^Heiler voll \((\d+)\/(\d+)\)$/, "Healers full ($1/$2)"],
    [/^Nahkampf voll \((\d+)\/(\d+)\)$/, "Melee full ($1/$2)"],
    [/^Fernkampf voll \((\d+)\/(\d+)\)$/, "Ranged full ($1/$2)"],
    [/^Raid voll \((\d+)\/(\d+)\)$/, "Raid full ($1/$2)"],
    [/^Kommt später$/, "Joining late"],
    [/^Nur „Vielleicht“ angemeldet$/, "Only signed up as “Tentative”"],
    [/^Als Ersatz angemeldet$/, "Signed up as a backup"],
    [/^War zuletzt dabei$/, "Was in the last raid"],
    [/^Anwesenheit (\d+) %$/, "Attendance $1%"],
    [/^Andere passten besser in die Aufstellung$/, "Others fitted the lineup better"],
    // raiderProfileStore.addCharacter
    [/^Kein Konto\.$/, "No account."],
    [/^Bitte eine Klasse angeben\.$/, "Please pick a class."],
    [/^Bitte einen Namen angeben\.$/, "Please enter a name."],
    // utils/characterNames.validateCharacterName (via addCharacter)
    [/^Höchstens Vor- und Nachname – ein Leerzeichen dazwischen\.$/, "At most a first and a last name – one space between them."],
    [/^Der Name darf kein Leerzeichen haben – Vor- und Nachname gibt es nur in WoW Forever\.$/,
        "The name must not contain a space – first and last names exist only in WoW Forever."],
    [/^Der Name darf nur Buchstaben haben\.$/, "The name may only contain letters."],
    [/^Der Vorname darf nur Buchstaben haben\.$/, "The first name may only contain letters."],
    [/^Der Nachname darf nur Buchstaben haben\.$/, "The last name may only contain letters."],
    [/^Der Name braucht mindestens (\d+) Buchstaben\.$/, "The name needs at least $1 letters."],
    [/^Der Vorname braucht mindestens (\d+) Buchstaben\.$/, "The first name needs at least $1 letters."],
    [/^Der Nachname braucht mindestens (\d+) Buchstaben\.$/, "The last name needs at least $1 letters."],
    [/^Der Name hat (\d+) Buchstaben – höchstens (\d+)\.$/, "The name has $1 letters – at most $2."],
    [/^Der Vorname hat (\d+) Buchstaben – höchstens (\d+)\.$/, "The first name has $1 letters – at most $2."],
    [/^Der Nachname hat (\d+) Buchstaben – höchstens (\d+)\.$/, "The last name has $1 letters – at most $2."],
    [/^Dieser Name ist nicht erlaubt – bitte einen anderen wählen\.$/, "This name is not allowed – please pick another one."],
];

/**
 * One service sentence in English. Several sentences joined by line breaks
 * (a waiting-list notice plus "now full") are translated line by line.
 */
function toEnglish(text) {
    const s = text === null || text === undefined ? "" : String(text);
    if (!s) return s;
    return s.split("\n").map((line) => {
        // A leading "⚠️ " / "⏳ " / "✅ " stays; the sentence after it is looked up.
        const [, lead, sentence] = line.match(/^([^\p{L}]*)(.*?)\s*$/u);
        for (const [pattern, english] of RULES) {
            if (pattern.test(sentence)) return `${lead}${sentence.replace(pattern, english)}`;
        }
        return line;
    }).join("\n");
}

module.exports = { toEnglish, RULES };
