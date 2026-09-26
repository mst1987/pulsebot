import { get, send } from "./client";

// ---- Umstieg von Raid-Helper (#291) ----------------------------------------

export type RetirementStatus = "ok" | "mid" | "bad" | "unknown" | "info";
export type RetirementItem = {
    id: "categories" | "upcoming" | "history" | "emojis" | "commands" | "permissions";
    label: string;
    status: RetirementStatus;
    value: string;
    why: string;
    detail: string[];
    required: boolean;
    link?: { to: string; label: string };
    action?: "import";
    hint?: string;
};
export type RetirementChecklist = {
    disabled: boolean;
    disabledAt: number;
    disabledBy: string;
    items: RetirementItem[];
    done: number;
    total: number;
    ready: boolean;
    blockers: string[];
};
export type HistoryImportResult = {
    dryRun: boolean;
    perCategory: number;
    categories: { categoryId: string; categoryName: string; events: number; skipped: number; entries: number; from: number; to: number }[];
    summary: { events: number; skippedEvents: number; entries: number; users: number; unmapped: Record<string, number> };
    stored: { events: number; entries: number; users: number } | null;
    liveError: string | null;
    status: { importedEvents: number; users: number; lastRun: { at: number; byName: string; events: number; entries: number } | null };
};

export function getRaidhelperRetirement(): Promise<{ checklist: RetirementChecklist }> {
    return get<{ checklist: RetirementChecklist }>("/api/settings/raidhelper-retirement");
}

export function setRaidhelperDisabled(disabled: boolean): Promise<{ checklist: RetirementChecklist }> {
    return send("POST", "/api/settings/raidhelper-retirement", { disabled });
}

export function importRaidhelperHistory(body: { perCategory: number; dryRun: boolean }): Promise<HistoryImportResult> {
    return send("POST", "/api/settings/raidhelper-history-import", body);
}
