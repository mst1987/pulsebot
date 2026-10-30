import { get, send } from "../client";

// ---- Neue Version starten (#745) -------------------------------------------
// Einstellungen → Spielversion: the checklist for the day a guild starts a
// new game version, computed by the server from the real data
// (services/versions/versionLaunch.js). Only the manual items carry a mark.

export type LaunchStatus = "done" | "open";
export type LaunchMark = { at: number; byName: string };
export type LaunchFieldState = { field: "realm" | "armory" | "wcl" | "wowhead" | "softres" | "raidsheet"; state: "set" | "missing" | "notNeeded"; reason: string };
export type LaunchCategoryRef = { id: string; name: string };

type Base<I extends string> = { id: I; status: LaunchStatus; optional: boolean; mark: LaunchMark | null };
export type LaunchItem =
    | (Base<"backup"> & { kind: "manual" })
    | (Base<"backup"> & { kind: "auto"; snapshotAt: number; offsiteAt: number; snapshotLight: string; offsiteLight: string })
    | (Base<"export" | "lootAddon" | "talk"> & { kind: "manual" })
    | (Base<"categories"> & { kind: "auto"; total: number; missing: LaunchCategoryRef[]; target: LaunchCategoryRef[] })
    | (Base<"versionSettings"> & { kind: "auto"; fields: LaunchFieldState[] })
    | (Base<"templates"> & { kind: "auto"; count: number; names: string[]; incomplete: string[] })
    | (Base<"series"> & { kind: "auto"; categories: number; problems: { categoryId: string; name: string; kind: "series" | "default"; template: string }[] })
    | (Base<"rosters"> & { kind: "auto"; categories: number; problems: { categoryId: string; name: string; rosterId: string; problems: ("missing" | "closed" | "noRoles" | "noManagers")[] }[] })
    | (Base<"guildBank"> & { kind: "auto"; banks: { key: string; guild: string; realm: string; assigned: boolean }[] })
    | (Base<"mainVersion"> & { kind: "auto"; mainVersion: string; isMain: boolean; hidden: boolean });

export type LaunchChecklist = {
    versionId: string;
    label: string;
    short: string;
    items: LaunchItem[];
    done: number;
    total: number;
};

export function getVersionLaunch(versionId = ""): Promise<{ checklist: LaunchChecklist }> {
    return get<{ checklist: LaunchChecklist }>(`/api/settings/version-launch${versionId ? `?version=${encodeURIComponent(versionId)}` : ""}`);
}

export function markVersionLaunch(versionId: string, item: string, done: boolean): Promise<{ checklist: LaunchChecklist }> {
    return send("POST", "/api/settings/version-launch", { version: versionId, item, done });
}
