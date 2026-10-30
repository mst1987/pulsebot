// Words a character name typed into the bot or the web may not carry — the
// raiders' names end up in public Discord messages (signup, setup, invite
// call). German and English, lower case, without umlauts (ä → a, ß → ss; see
// normalizeForCheck in src/utils/signup/characterNames.js).
//
// Three lists, because a blunt substring check refuses harmless names
// ("Hancock", "Barsch", "Torpedo" — the Scunthorpe problem):
//   CONTAINS  roots that are never part of a harmless name — matched anywhere
//   PREFIX    matched at the start of a name part (and of first + last name)
//   EXACT     only the whole part, or first + last name together
// Extend the lists here; test/utils/signup/characterNames.test.js holds the cases
// that must stay allowed.

const CONTAINS = [
    "fuck", "fick", "cunt", "nigg", "nigga", "neger", "hitler", "holocaust", "auschwitz",
    "wichser", "wichse", "wixer", "fotze", "hurensohn", "schlampe", "schwuchtel", "kanake",
    "arschloch", "arschgeige", "bitch", "whore", "pussy", "faggot", "penis", "vagina",
    "dildo", "porno", "rapist", "vergewalt", "pedophil", "paedophil", "kinderfick",
    "motherf", "wanker", "bastard", "scheiss", "shithead", "bullshit", "retard", "missgeburt",
    "judensau", "untermensch", "kkk",
];

const PREFIX = [
    "nazi", "spast", "arsch", "hure", "nutte", "shit", "piss", "slut", "kacke", "titten",
];

const EXACT = [
    "ass", "arse", "dick", "cock", "cum", "fag", "tit", "tits", "anal", "anus", "sex",
    "siegheil", "hoe", "twat", "prick", "wank", "kotze", "sperma", "mongo",
];

module.exports = { CONTAINS, PREFIX, EXACT };
