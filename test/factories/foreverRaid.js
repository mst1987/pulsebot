// A full WoW Forever raid for the length budget of the Discord messages: realistic "Vorname Nachname" characters,
// freely chosen Discord names (emoji, brackets, long ones) and application emojis with real id lengths.
//
//   const { foreverRaid, longEmojis } = require("../../factories/foreverRaid");
//   const { signups, discordNames } = foreverRaid(40);

const CHARACTERS = [
    "Aldric Sturmwind", "Konstantinos Mittelfeldau", "Devi Res", "Maximilian Donnerschlag", "Mira Tal",
    "Theodoric Silberklinge", "Isolde Nachtwandler", "Bjarne Frosthammer", "Lena Wolf", "Valentina Sonnenfeuer",
    "Gunnar Eisenfaust", "Seraphina Dunkelherz", "Tom Berg", "Friedrich Sturmbrecher", "Anya Morgenrot",
    "Alexandrius Schattenfels", "Kira Stein", "Wilhelmina Lichtbringer", "Ragnar Blutaxt", "Noa Lind",
    "Christopher Himmelsglanz", "Devi Rew", "Leopold Drachenherz", "Yara Feuer", "Ottokar Steinbrecher",
    "Annelies Weidenbach", "Bartholomew Rabenfels", "Cornelius Eichenschild", "Dorothea Kupferglanz", "Emil Grau",
    "Felicitas Windspiel", "Gregor Hammerfaust", "Helena Sternenlicht", "Ivo Kern", "Josephine Morgentau",
    "Kasimir Dornenhain", "Ludmilla Frostwind", "Matthias Wolkenbruch", "Nikolaus Felsenherz", "Ophelia Rosenrot",
];

const DISCORD_NAMES = [
    "Marc", "Konstantin (Tank)", "Lena | Heal", "xX_Shadow_Xx", "Mira",
    "Theo", "Isi", "Bjarne", "Lena W", `Vali ${String.fromCodePoint(0x1f525)}`,
    "Gunnar", "Sera", "Tommy", "Fritz der Grosse", "Anya",
    "Alex", "Kira", `Willi ${String.fromCodePoint(0x1f9d9)}`, "Ragnar", "Noa",
    "Chris", "Devi", "Leo", "Yara | Raidlead Donnerstag", "Otto",
    "Annie", "Bart", "Cornelius", "Dori", "Emil",
    "Feli", "Greg", "Helena", "Ivo", "Josy",
    "Kasi", "Ludmilla [Offi]", "Matze", "Niko", "Ophelia",
];

const TANKS = ["Warrior-Protection", "Paladin-Protection", "Druid-Guardian"];
const HEALERS = ["Priest-Holy", "Paladin-Holy", "Shaman-Restoration", "Druid-Restoration", "Priest-Discipline"];
const DAMAGE = [
    ["Warrior-Fury", "melee"], ["Rogue-Combat", "melee"], ["Mage-Arcane", "ranged"], ["Warlock-Destruction", "ranged"],
    ["Hunter-Marksmanship", "ranged"], ["Shaman-Enhancement", "melee"], ["Priest-Shadow", "ranged"], ["Druid-Balance", "ranged"],
    ["Paladin-Retribution", "melee"], ["Mage-Frost", "ranged"], ["Shaman-Elemental", "ranged"], ["Rogue-Subtlety", "melee"],
];

const userIdOf = (i) => String(100000000000000000n + BigInt(i) * 1234567891n);

/** Tanks, healers and damage in a raid's usual share; `size` is 40 at most. */
function foreverRaid(size) {
    const tanks = size >= 40 ? 3 : 2;
    const healers = size >= 40 ? 8 : 5;
    const specOf = (i) => {
        if (i < tanks) return [TANKS[i % TANKS.length], "tank"];
        if (i < tanks + healers) return [HEALERS[(i - tanks) % HEALERS.length], "healer"];
        return DAMAGE[(i - tanks - healers) % DAMAGE.length];
    };
    const signups = [];
    const discordNames = {};
    for (let i = 0; i < size; i++) {
        const [spec, role] = specOf(i);
        const userId = userIdOf(i);
        signups.push({ userId, character: CHARACTERS[i], spec, role, status: "signed", at: i + 1 });
        discordNames[userId] = DISCORD_NAMES[i];
    }
    return { signups, discordNames };
}

/** The application emojis by name, with ids as long as Discord's. */
function longEmojis(catalog) {
    return Object.fromEntries(catalog.map((e) => [e.name, { id: "1234567890123456789", name: e.name, animated: false }]));
}

module.exports = { foreverRaid, longEmojis };
