// The voice channel per raid on the client (docs/channels.md): settings with
// defaults, which raid gets a temporary channel, the name preview.
import { describe, expect, it } from "vitest";
import {
    clockMinus, DEFAULT_NAME_TEMPLATE, isTemporary, renderVoiceName, tempVoiceFor, TEMP_VOICE_DEFAULTS, voiceDayLabel, voiceNameFor, voiceTimeLabel,
} from "../tempVoice";

// Sat 31.10.2026 20:00 in Berlin (CET, UTC+1)
const SAT_20 = Date.UTC(2026, 9, 31, 19, 0) / 1000;

describe("tempVoiceFor", () => {
    it("follows the fixed channel without a stored mode", () => {
        expect(tempVoiceFor(undefined, "")).toEqual({ ...TEMP_VOICE_DEFAULTS, mode: "none" });
        expect(tempVoiceFor({}, "c1").mode).toBe("existing");
        expect(tempVoiceFor({ mode: "bogus" as never }, "").mode).toBe("none");
    });

    it("keeps a stored mode and stored values over the defaults", () => {
        const s = tempVoiceFor({ mode: "temp", leadMinutes: 15 }, "c1");
        expect(s.mode).toBe("temp");
        expect(s.leadMinutes).toBe(15);
        expect(s.closeAfterMinutes).toBe(TEMP_VOICE_DEFAULTS.closeAfterMinutes);
    });
});

describe("isTemporary", () => {
    it("is every raid for temp, from raid 2 on for existing with the switch, never for none", () => {
        expect(isTemporary({ mode: "temp", fromRaid2: false }, 1)).toBe(true);
        expect(isTemporary({ mode: "existing", fromRaid2: true }, 1)).toBe(false);
        expect(isTemporary({ mode: "existing", fromRaid2: true }, 2)).toBe(true);
        expect(isTemporary({ mode: "existing", fromRaid2: false }, 2)).toBe(false);
        expect(isTemporary({ mode: "none", fromRaid2: true }, 3)).toBe(false);
    });
});

describe("renderVoiceName", () => {
    it("fills the placeholders and drops an empty one with its separator", () => {
        expect(renderVoiceName(DEFAULT_NAME_TEMPLATE, { raid: "SSC", nr: "2", datum: "Sa 31.10." })).toBe("SSC 2 · Sa 31.10.");
        expect(renderVoiceName(DEFAULT_NAME_TEMPLATE, { raid: "SSC", nr: "", datum: "Sa 31.10." })).toBe("SSC · Sa 31.10.");
        expect(renderVoiceName("{leader} · {raid}", { raid: "SSC", leader: "" })).toBe("SSC");
        expect(renderVoiceName("{raid} {unknown}", { raid: "SSC" })).toBe("SSC {unknown}");
    });
});

describe("labels in Berlin time", () => {
    it("names the day in German and the time on 24 hours", () => {
        expect(voiceDayLabel(SAT_20)).toBe("Sa 31.10.");
        expect(voiceTimeLabel(SAT_20)).toBe("20:00");
        expect(voiceDayLabel(0)).toBe("");
        expect(voiceTimeLabel(0)).toBe("");
    });

    it("numbers raids only when there are several", () => {
        expect(voiceNameFor(DEFAULT_NAME_TEMPLATE, { raid: "SSC", start: SAT_20, index: 1, total: 1 })).toBe("SSC · Sa 31.10.");
        expect(voiceNameFor(DEFAULT_NAME_TEMPLATE, { raid: "SSC", start: SAT_20, index: 2, total: 2 })).toBe("SSC 2 · Sa 31.10.");
        expect(voiceNameFor("{leader}", { raid: "SSC", start: SAT_20, index: 1, total: 1 })).toBe("SSC");
        expect(voiceNameFor("{leader}", { raid: "", start: SAT_20, index: 1, total: 1 })).toBe("Raid");
    });
});

describe("clockMinus", () => {
    it("subtracts minutes across midnight and rejects a bad clock", () => {
        expect(clockMinus("20:00", 30)).toBe("19:30");
        expect(clockMinus("00:15", 30)).toBe("23:45");
        expect(clockMinus("8:05", 5)).toBe("08:00");
        expect(clockMinus("abends", 30)).toBe("");
    });
});
