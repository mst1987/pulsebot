const {
    TEMP_VOICE_DEFAULTS, DEFAULT_NAME_TEMPLATE, tempVoiceSettings, normalizeCategoryTempVoice, categoryTempVoiceFor, normalizeVoicePlan,
} = require("../../../src/stores/settings/tempVoiceSettings");

const CAT = "1300000000000000001";
const PARENT = "1300000000000000002";
const VOICE = "1300000000000000003";

describe("stores/settings/tempVoiceSettings", () => {
    describe("tempVoiceSettings", () => {
        it("fills every default and leaves the mode empty when none is given", () => {
            expect(tempVoiceSettings(undefined)).toEqual({ mode: "", ...TEMP_VOICE_DEFAULTS });
            expect(tempVoiceSettings([])).toEqual({ mode: "", ...TEMP_VOICE_DEFAULTS });
        });

        it("keeps valid values and clamps the minutes", () => {
            expect(tempVoiceSettings({
                mode: "temp", fromRaid2: true, parentId: PARENT, nameTemplate: "  {raid}\n{nr} ", leadMinutes: 999, closeAfterMinutes: -4, onlyAssigned: true,
            })).toEqual({
                mode: "temp", fromRaid2: true, parentId: PARENT, nameTemplate: "{raid} {nr}", leadMinutes: 240, closeAfterMinutes: 0, onlyAssigned: true,
            });
        });

        it("drops an unknown mode, a broken parent id and non-numbers", () => {
            const s = tempVoiceSettings({ mode: "always", parentId: "nope", leadMinutes: "x", closeAfterMinutes: "", nameTemplate: "   ", fromRaid2: "yes" });
            expect(s.mode).toBe("");
            expect(s.parentId).toBe("");
            expect(s.leadMinutes).toBe(30);
            expect(s.closeAfterMinutes).toBe(60);
            expect(s.nameTemplate).toBe(DEFAULT_NAME_TEMPLATE);
            expect(s.fromRaid2).toBe(false);
        });

        it("cuts a long name template to 100 characters", () => {
            expect(tempVoiceSettings({ nameTemplate: "x".repeat(150) }).nameTemplate).toHaveLength(100);
        });

        it("stores the English placeholder names as the German ones", () => {
            expect(tempVoiceSettings({ nameTemplate: "{raid} {no} - {date} {time}" }).nameTemplate).toBe("{raid} {nr} - {datum} {zeit}");
            expect(tempVoiceSettings({ nameTemplate: "{raid} {nr} {datum}" }).nameTemplate).toBe("{raid} {nr} {datum}");
            expect(tempVoiceSettings({ nameTemplate: "{dates} {No}" }).nameTemplate).toBe("{dates} {No}");
        });
    });

    describe("normalizeCategoryTempVoice", () => {
        it("stores only what differs, plus the mode", () => {
            expect(normalizeCategoryTempVoice({
                [CAT]: { mode: "existing", leadMinutes: 30, closeAfterMinutes: 90 },
                " ": { mode: "temp" },
                other: { leadMinutes: 30 },
            })).toEqual({ [CAT]: { mode: "existing", closeAfterMinutes: 90 } });
        });

        it("reads garbage as empty", () => {
            expect(normalizeCategoryTempVoice(null)).toEqual({});
            expect(normalizeCategoryTempVoice([1])).toEqual({});
        });
    });

    describe("categoryTempVoiceFor", () => {
        it("follows the fixed channel when no mode is stored", () => {
            expect(categoryTempVoiceFor({ categoryVoiceChannel: { [CAT]: VOICE } }, CAT)).toMatchObject({ mode: "existing", voiceChannelId: VOICE });
            expect(categoryTempVoiceFor({}, CAT)).toMatchObject({ mode: "none", voiceChannelId: "" });
            expect(categoryTempVoiceFor(null, "")).toMatchObject({ mode: "none" });
        });

        it("keeps a stored mode", () => {
            const config = { categoryVoiceChannel: { [CAT]: VOICE }, categoryTempVoice: { [CAT]: { mode: "temp", leadMinutes: 15 } } };
            expect(categoryTempVoiceFor(config, CAT)).toEqual({ ...TEMP_VOICE_DEFAULTS, mode: "temp", leadMinutes: 15, voiceChannelId: VOICE });
        });
    });

    describe("normalizeVoicePlan", () => {
        it("is null without a valid mode", () => {
            expect(normalizeVoicePlan(null)).toBeNull();
            expect(normalizeVoicePlan({ mode: "x" })).toBeNull();
            expect(normalizeVoicePlan([])).toBeNull();
        });

        it("keeps mode, name and lead time", () => {
            expect(normalizeVoicePlan({ mode: "none", nameTemplate: "", leadMinutes: 10, onlyAssigned: true }))
                .toEqual({ mode: "none", nameTemplate: DEFAULT_NAME_TEMPLATE, leadMinutes: 10 });
        });
    });
});
