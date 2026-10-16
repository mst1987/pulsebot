import { afterEach, describe, expect, it } from "vitest";
import {
    TILE_LIMITS, bytes, mergePoll, millis, num, pct, seriesOf, sparkPath, toneHigh, toneLow, uptime, within,
} from "./systemFormat";
import { findingText } from "./findings";
import { switchLang } from "../../test/i18n";
import { systemStatus } from "../../pages/system/SystemPage.fixture";

describe("numbers with their unit", () => {
    afterEach(() => switchLang("de"));

    it("formats percent, bytes and durations in German", () => {
        expect(pct(42.4)).toBe("42 %");
        expect(pct(7.25)).toBe("7,3 %");
        expect(pct(0)).toBe("0 %");
        expect(bytes(512)).toBe("512 B");
        expect(bytes(1536)).toBe("1,5 KB");
        expect(bytes(4.5 * 1024 ** 3)).toBe("4,5 GB");
        expect(bytes(300 * 1024 ** 2)).toBe("300 MB");
        expect(millis(4.25)).toBe("4,3 ms");
        expect(millis(85)).toBe("85 ms");
        expect(millis(1234)).toBe("1,2 s");
        expect(millis(14000)).toBe("14 s");
        expect(num(1234.5, 1)).toBe("1.234,5");
    });

    it("formats uptimes with two parts at most", () => {
        expect(uptime(40)).toBe("40 s");
        expect(uptime(12 * 60)).toBe("12 Min.");
        expect(uptime(3600 + 5 * 60)).toBe("1 Std. 5 Min.");
        expect(uptime(2 * 3600)).toBe("2 Std.");
        expect(uptime(86400)).toBe("1 Tag");
        expect(uptime(3 * 86400 + 4 * 3600 + 59)).toBe("3 Tage 4 Std.");
    });

    it("formats in English", async () => {
        await switchLang("en");
        expect(pct(7.25)).toBe("7.3 %");
        expect(uptime(3 * 86400 + 3600)).toBe("3 days 1 h");
    });
});

describe("tones", () => {
    it("colours high figures from warn on, low figures below it", () => {
        expect(toneHigh(50, TILE_LIMITS.hostCpu)).toBe("");
        expect(toneHigh(70, TILE_LIMITS.hostCpu)).toBe("mid");
        expect(toneHigh(85, TILE_LIMITS.hostCpu)).toBe("bad");
        expect(toneLow(50, TILE_LIMITS.memAvailPct)).toBe("");
        expect(toneLow(15, TILE_LIMITS.memAvailPct)).toBe("mid");
        expect(toneLow(5, TILE_LIMITS.memAvailPct)).toBe("bad");
    });
});

describe("series and sparkline", () => {
    const history = systemStatus().history;

    it("picks one field of a range as [time, value]", () => {
        const host = seriesOf(history, "hour", "hostCpu");
        expect(host).toHaveLength(8);
        expect(host[0][1]).toBe(20);
        expect(seriesOf(history, "day", "procCpu")).toHaveLength(2);
        expect(seriesOf(history, "hour", "nope")).toEqual([]);
        expect(seriesOf(null, "hour", "hostCpu")).toEqual([]);
    });

    it("keeps points inside the range", () => {
        const now = 10 * 3600 * 1000;
        expect(within([[now - 2 * 3600 * 1000, 1], [now - 600000, 2]], "hour", now)).toEqual([[now - 600000, 2]]);
        expect(within([[now - 2 * 3600 * 1000, 1]], "day", now)).toHaveLength(1);
    });

    it("draws the line over the time span and closes the area at the bottom", () => {
        expect(sparkPath([])).toEqual({ line: "", area: "" });
        const { line, area } = sparkPath([[0, 0], [50, 50], [100, 100]], { width: 100, height: 28, max: 100 });
        expect(line).toBe("M0.0,27.0 L50.0,14.0 L100.0,1.0");
        expect(area).toBe(`${line} L100.0,28 L0.0,28 Z`);
        // one point sits at the right edge; the default top is the largest value, at least the floor
        expect(sparkPath([[5, 2]], { floor: 4 }).line).toBe("M100.0,14.0");
    });
});

describe("mergePoll", () => {
    it("keeps the last processes when a poll brings none", () => {
        const prev = systemStatus();
        const next = systemStatus({ processes: null, now: 1 });
        expect(mergePoll(prev, next).processes).toBe(prev.processes);
        expect(mergePoll(null, next).processes).toBeNull();
        const fresh = systemStatus({ now: 2 });
        expect(mergePoll(prev, fresh).processes).toBe(fresh.processes);
    });
});

describe("findingText", () => {
    it("turns every finding into a sentence with its numbers", () => {
        expect(findingText({ id: "otherProcess", level: "bad", values: { hostCpu: 90, botCpu: 4, process: "", processCpu: 0 } }).text)
            .toBe("Ein anderer Prozess belastet den Server: 90 % CPU insgesamt, der Bot selbst nur 4 %.");
        const bot = findingText({ id: "botBottleneck", level: "bad", values: { procCpu: 97, loopP99: 400, loopShare: 30, cause: "cpu" }, routes: [{ route: "/r/:id", p95: 5200, count: 3 }] });
        expect(bot.text).toBe("Der Bot selbst ist der Engpass: er braucht dauerhaft 97 % eines CPU-Kerns.");
        expect(bot.detail).toBe("Langsamste Anfragen: /r/:id (5,2 s).");
        expect(findingText({ id: "botBottleneck", level: "warn", values: { procCpu: 20, loopP99: 400, loopShare: 30, cause: "loop" } }).text).toContain("bis zu 400 ms");
        expect(findingText({ id: "hostBusy", level: "warn", values: { hostCpu: 90, botCpu: 70, cores: 1 } }).text).toContain("davon 70 % durch den Bot");
        expect(findingText({ id: "cpuOverloaded", level: "warn", values: { load5: 3, load15: 2.5, cores: 2 } }).text).toContain("Load 3 (5 Minuten)");
        expect(findingText({ id: "memoryLow", level: "warn", values: { swapUsedPct: 70, cause: "swap" } }).text).toContain("zu 70 % belegt");
        expect(findingText({ id: "memoryLow", level: "bad", values: { memAvailPct: 6, memAvail: 512 * 1024 ** 2, memTotal: 8 * 1024 ** 3, cause: "ram" } }).text)
            .toBe("Zu wenig Arbeitsspeicher: nur 6 % verfügbar (512 MB von 8 GB).");
        expect(findingText({ id: "diskLow", level: "warn", values: { freePct: 8, free: 1024 ** 3, total: 10 * 1024 ** 3 } }).advice).toContain("data/");
    });
});
