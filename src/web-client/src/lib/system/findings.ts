// The verdict's sentences (docs/system-status.md): the server sends each
// finding as an id with the numbers it rests on (src/services/system/assessment.js);
// here it becomes a sentence and a recommendation in the menu's language.
import { t } from "../../i18n";
import type { SystemFinding } from "../../api";
import { bytes, millis, pct } from "./systemFormat";

export type FindingText = { text: string; advice: string; detail?: string };

const n = (v: number | string | undefined): number => Number(v) || 0;
const s = (v: number | string | undefined): string => String(v ?? "");

/** One finding as a sentence, the recommendation and (for the bot) the slowest routes. */
export function findingText(f: SystemFinding): FindingText {
    const v = f.values || {};
    switch (f.id) {
        case "otherProcess":
            return {
                text: s(v.process)
                    ? t("system.findings.otherProcess.named", { process: s(v.process), processCpu: pct(n(v.processCpu)), hostCpu: pct(n(v.hostCpu)), botCpu: pct(n(v.botCpu)) })
                    : t("system.findings.otherProcess.text", { hostCpu: pct(n(v.hostCpu)), botCpu: pct(n(v.botCpu)) }),
                advice: t("system.findings.otherProcess.advice"),
            };
        case "botBottleneck": {
            const routes = (f.routes || []).map((r) => `${r.route} (${millis(r.p95)})`).join(", ");
            return {
                text: s(v.cause) === "cpu"
                    ? t("system.findings.botBottleneck.cpu", { procCpu: pct(n(v.procCpu)) })
                    : t("system.findings.botBottleneck.loop", { loopP99: millis(n(v.loopP99)), loopShare: pct(n(v.loopShare)) }),
                advice: t("system.findings.botBottleneck.advice"),
                detail: routes ? t("system.findings.botBottleneck.routes", { routes }) : undefined,
            };
        }
        case "hostBusy":
            return {
                text: t("system.findings.hostBusy.text", { hostCpu: pct(n(v.hostCpu)), botCpu: pct(n(v.botCpu)), cores: n(v.cores) }),
                advice: t("system.findings.hostBusy.advice"),
            };
        case "cpuOverloaded":
            return {
                text: t("system.findings.cpuOverloaded.text", { load5: n(v.load5), load15: n(v.load15), cores: n(v.cores) }),
                advice: t("system.findings.cpuOverloaded.advice"),
            };
        case "memoryLow":
            return {
                text: s(v.cause) === "swap"
                    ? t("system.findings.memoryLow.swap", { swapUsedPct: pct(n(v.swapUsedPct)) })
                    : t("system.findings.memoryLow.ram", { memAvailPct: pct(n(v.memAvailPct)), memAvail: bytes(n(v.memAvail)), memTotal: bytes(n(v.memTotal)) }),
                advice: t("system.findings.memoryLow.advice"),
            };
        case "diskLow":
            return {
                text: t("system.findings.diskLow.text", { freePct: pct(n(v.freePct)), free: bytes(n(v.free)), total: bytes(n(v.total)) }),
                advice: t("system.findings.diskLow.advice"),
            };
        default:
            return { text: String(f.id), advice: "" };
    }
}
