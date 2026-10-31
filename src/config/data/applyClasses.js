// WoW classes + specs for the application flow. `icon` is the guild emoji name.
const CLASSES = [
    { value: "warrior", label: "Warrior", icon: "warrior", specs: ["Arms", "Fury", "Protection"] },
    { value: "paladin", label: "Paladin", icon: "paladin", specs: ["Holy", "Protection", "Retribution"] },
    { value: "hunter", label: "Hunter", icon: "hunter", specs: ["Beast Mastery", "Marksmanship", "Survival"] },
    { value: "rogue", label: "Rogue", icon: "rogue", specs: ["Assassination", "Combat", "Subtlety"] },
    { value: "priest", label: "Priest", icon: "priest", specs: ["Discipline", "Holy", "Shadow"] },
    { value: "shaman", label: "Shaman", icon: "shaman", specs: ["Elemental", "Enhancement", "Restoration"] },
    { value: "mage", label: "Mage", icon: "mage", specs: ["Arcane", "Fire", "Frost"] },
    { value: "warlock", label: "Warlock", icon: "warlock", specs: ["Affliction", "Demonology", "Destruction"] },
    { value: "druid", label: "Druid", icon: "druid", specs: ["Balance", "Feral", "Restoration"] },
];

function getClass(value) {
    return CLASSES.find((c) => c.value === value) || null;
}

module.exports = { CLASSES, getClass };
