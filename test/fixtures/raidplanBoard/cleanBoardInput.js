// The input of the cleanBoard golden master (test/services/raidplan/raidplanBoard.golden.test.js):
// one board that walks every section of the cleaner — kept, clamped, defaulted
// and dropped entries alike. Every kept object carries its own id, so the
// output is deterministic. cleanBoardGolden.json is the output the cleaner
// gave for it before it was split up (#424); regenerate it only for a change
// of behaviour that is meant.

const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));

const input = {
    tokens: [
        { userId: "u1", x: 0.25, y: 1.7, size: 60, opacity: 0.5, lock: true },
        { userId: "u1", x: 0.3, y: 0.3 },                       // a second token of the same player: dropped
        { userId: "stranger", x: 0.1, y: 0.1 },                 // not in the lineup: dropped
        { userId: "u2", x: -3, y: "a", size: "", hidden: true, ring: false, showName: false },
        null,                                                   // no user: dropped
    ],
    slots: [
        { id: "s-tank", kind: "tank", n: 1, x: 0.1, y: 0.2, userId: "u1", preferredClasses: ["Warrior", "Druid", "Nope", "Warrior"], byClass: true },
        { id: "s-tank", kind: "tank", n: 2, x: 0.2, y: 0.2, userId: "u1" },          // same id (new one) and a second place: open
        { id: "s-heal", kind: "healer", n: 0, x: 2, y: 0.5, userId: "stranger" },    // stranger: open, n at least 1
        { id: "s-melee", kind: "melee", n: 150, x: 0.4, y: 0.4, placed: false },
        { id: "s-ranged", kind: "ranged", n: 3.7, x: 0.5, y: 0.5, size: 400 },
        { id: "s-dps", kind: "dps", n: "x", x: 0.6, y: 0.6 },
        {
            id: "s-group", kind: "group", n: 2, x: 0.7, y: 0.7, userId: "u3", label: "Gruppe zwei mit einem sehr langen Namen, der gekürzt wird",
            offsets: { u1: { dx: 2, dy: -0.5, size: 20 }, stranger: { dx: 0, dy: 0 }, u2: "bad" },
            hideMembers: true, split: true, groupScale: 9, ringSpread: 0.1, tokenScale: "1.234",
            showRing: false, ringColor: "#ABCDEF", ringOpacity: 0.05, chipWidth: 1000, preferredClasses: ["Mage"], byClass: true,
        },
        { id: "s-group2", kind: "group", n: 1, x: 0.7, y: 0.7, groupScale: "", ringColor: "red", ringOpacity: "", chipWidth: 10 },
        { id: "s-label", kind: "label", label: "Hier stehen", x: 0.8, y: 0.8 },
        { id: "s-empty-label", kind: "label", label: "", x: 0.8, y: 0.8 },           // a label without text: dropped
        { id: "s-bad", kind: "boss", x: 0.8, y: 0.8 },                               // unknown kind: dropped
    ],
    marks: [
        { id: "m1", mark: "skull", x: 0.1, y: 0.2, size: 1 },
        { id: "m1", mark: "cross", x: 0.3, y: 0.4 },
        { id: "m3", mark: "banana", x: 0.3, y: 0.4 },
    ],
    icons: [
        { id: "i1", iconKey: "boss:601", label: "Boss", x: 0.5, y: 0.5, size: 500, rotation: -90, showLabel: true, mobId: "b:illidan", autoFace: false, arrowScale: 2, arrowHidden: true, arrowColor: "#00FF00", arrowOpacity: 0.5 },
        { id: "i2", iconKey: "wow:spell_fire_fireball", x: 0.2, y: 0.2, mobId: "not a mob", arrowScale: 1, arrowColor: "#ffb020", arrowOpacity: 1 },
        { id: "i3", iconKey: "enemy", x: 0.9, y: 0.9, mobId: "d:gathios" },
        { id: "i4", iconKey: "bosspos", x: 0.9, y: 0.9, rotation: 725 },
        { id: "i5", iconKey: "<script>", x: 0.1, y: 0.1 },
    ],
    zones: [
        { id: "z1", type: "danger", shape: "ellipse", label: "Feuer", x: 0.99, y: 0.5, w: 0.5, h: 0.01, color: "#123456" },
        { id: "z2", type: "role", role: "healer", shape: "cluster", count: 99, showNames: true, rotation: 45, iconScale: 7, labelPos: "top", x: 0.2, y: 0.2, w: 0.2, h: 0.2 },
        { id: "z3", type: "role", role: "wizard", shape: "triangle", count: -3, iconScale: "x", labelPos: "nowhere", opacity: 0.8 },
        { id: "z4", type: "lava", shape: "cluster", w: 5, h: "a" },
        "not an object",
    ],
    lines: [
        { id: "l1", kind: "arrow", x1: 0.1, y1: 0.2, x2: 1.3, y2: -0.2, color: "#FF0000", width: 40 },
        { id: "l2", kind: "curve", width: "x" },
    ],
    texts: [
        { id: "t1", text: "Hier sammeln", x: 0.3, y: 0.3, color: "#00ff00", size: 200 },
        { id: "t2", text: "", x: 0.3, y: 0.3 },
        { id: "t3", text: "x".repeat(100), size: "a" },
    ],
    targets: [
        { id: "tg1", title: "Adds", userIds: ["u1", "u1", "stranger", "u2", ...many(30, (i) => `p${i}`)] },
        { id: "tg1", title: "y".repeat(120) },
    ],
    assignments: [
        {
            id: "a1", type: "tank", title: "Boss tanken", assignees: ["user:u1", "user:stranger", "slot:tank:1"],
            targets: [
                { kind: "mob", ref: "b:illidan", name: "Illidan", oid: "i1" },    // its icon stands for this mob: kept
                { kind: "mob", ref: "d:gathios", name: "Gathios", oid: "i2" },    // its icon is another mob's: falls back to the kind
                { kind: "mob", ref: "d:zerevor", name: "Zerevor", oid: "gone", n: 2 },
                { kind: "mark", ref: "skull" },
            ],
        },
        { id: "a2", type: "weird", assignees: ["class:Mage:1"], targets: [{ kind: "text", ref: "Fear" }] },
    ],
    steps: [
        { id: "st1", text: "Pull", participants: ["user:u1", "user:stranger", "slot:tank:1"], targets: [{ kind: "mark", ref: "skull" }, { kind: "mark", ref: "skull" }] },
    ],
    notes: 12345,
    profileId: "prof-1",
    mapOpacity: 0.456,
    objectScale: 7,
    roles: { u1: "dps", u2: "wizard", stranger: "healer", u3: "healer" },
    mobs: [
        { id: "d:gathios", name: "Gathios", icon: "mob:22949" },
        { id: "d:gathios", name: "Gathios again" },
        { id: "d:zerevor", name: "" },
        { id: "x:bad", name: "Bad" },
        { id: "c:own-mob", name: "Eigener Mob", icon: "<bad>" },
        ...many(45, (i) => ({ id: `d:mob-${i}`, name: `Mob ${i}` })),
    ],
    hiddenCards: ["kick", "kick", "nonsense", "curse"],
    counts: { tank: 2, healer: 5, melee: 6, ranged: 7 },
    showRings: false,
    groupColors: { 1: "#AABBCC", 21: "#000000", 2: "blue" },
    groupMarks: { 2: "skull", 1: "skull", 3: "moon", 30: "star" },
    view: { zoom: 9, cx: 0.5, cy: 2 },
    inSheet: false,
    showMap: false,
    autoPlace: false,
    autoPos: { "t:a1:1": { x: 0.5, y: 1.5 }, "m:d:gathios#1": { x: "a", y: 0 }, bogus: { x: 0, y: 0 } },
    autoStyle: {
        "t:a1:1": { size: 999, opacity: 0.05, ring: false, showName: false, label: "Main tank", showLabel: true, rotation: 370, autoFace: false, hidden: true, lock: true, arrowScale: 0.1, z: 5000 },
        "m:d:gathios#1": { size: "", opacity: null },
        bogus: { size: 10 },
    },
    autoScale: 0.1,
    showNames: false,
    showBadges: false,
    showRoleRings: false,
    inheritOff: ["row-1", "row-1", "bad id!", 7],
};

const options = { allowedUserIds: ["u1", "u2", "u3", ...many(30, (i) => `p${i}`)], profileIds: ["prof-1"] };

module.exports = { input, options, many };
