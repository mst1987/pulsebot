// The NPC each default mob of the raid plan catalog is on Wowhead (TBC Classic database), so that
// scripts/fetch-mob-icons.js can fetch its real portrait: the model render of the NPC's display
// (https://wow.zamimg.com/modelviewer/tbc/webthumbs/npc/<displayId % 256>/<displayId>.png), cropped to head and shoulders
// (scripts/lib/png.js) and stored as src/web-client/public/mobs/<npcId>.png. The script checks every entry against the
// Wowhead page (its title has to name the mob) and every image with a real request; nothing is written blind.
// Edit THIS table (slug of `d:<slug>` -> NPC id), not src/config/mobIcons.json.
//
// Not in the table (they keep their placeholder icon, the catalog marks them): the Wowhead pages of Towering Infernal
// (17818), Giant Infernal (17908) and Doomfire (18095, "Doomfire Spirit") name no display, so there is no model render.
// Input of scripts/fetch-mob-icons.js only, so it lives beside the script in scripts/data/ (#424): the backend never
// reads it (it reads the generated src/config/mobIcons.json), and it is no configuration anybody sets.

const MOB_NPCS = {
    gathios: 22949,
    zerevor: 22950,
    malande: 22951,
    veras: 22952,
    "flame-of-azzinoth": 22997,
    "shadow-demon": 23375,
    "parasitic-shadowfiend": 23498,
    // Maiev of the Illidan encounter (23197, "is a boss"); 21699 and 22989 are other versions of her
    maiev: 23197,
    "ashtongue-channeler": 23421,
    "ashtongue-sorcerer": 23215,
    "ashtongue-defender": 23216,
    "ashtongue-elementalist": 23523,
    "ashtongue-rogue": 23318,
    "essence-of-suffering": 23418,
    "essence-of-desire": 23419,
    "essence-of-anger": 23420,
    "shadowy-construct": 23111,
    "vengeful-spirit": 23109,
    "illidari-nightlord": 22855,
    "illidari-fearbringer": 22954,
    "illidari-defiler": 22853,
    "illidari-heartseeker": 23339,
    "lesser-doomguard": 17864,
    "hyjal-abomination": 17898,
    "hyjal-ghoul": 17895,
    // the Hyjal necromancer is called "Shadowy Necromancer" on Wowhead ("Necromancer" 8553 is a Scholomance mob)
    "hyjal-necromancer": 17899,
    "hyjal-crypt-fiend": 17897,
    midnight: 16151,
    "netherspite-infernal": 17646,
    "pure-spawn": 22035,
    "tainted-spawn": 22036,
    "fathom-guard-sharkkis": 21966,
    "fathom-guard-tidalvess": 21965,
    "fathom-guard-caribdis": 21964,
    "tainted-elemental": 22009,
    "coilfang-strider": 22056,
    "enchanted-elemental": 21958,
    thaladred: 20064,
    sanguinar: 20060,
    capernian: 20062,
    telonicus: 20063,
    sathrovarr: 24892,
    "void-sentinel": 25772,
};

module.exports = { MOB_NPCS };
