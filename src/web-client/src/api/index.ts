// The client's API, one file per area (docs/web-admin.md). Everything is
// re-exported here so a page imports from "../api" as before; the access
// helpers live in lib/access.ts and stay reachable here for the transition.
export * from "./client";
export * from "./session";
export * from "./dashboard";
export * from "./channels";
export * from "./settings";
export * from "./discordServers";
export * from "./raidhelperRetirement";
export * from "./botCommands";
export * from "./roster";
export * from "./raids";
export * from "./raidTemplates";
export * from "./notifyTemplates";
export * from "./raidDetail";
export * from "./raidManage";
export * from "./eventSeries";
export * from "./recruitment";
export * from "./history";
export * from "./loot";
export * from "./cla";
export * from "./lootcouncil";
export * from "./profile";
export * from "./signups";
export * from "./setup";
export * from "./raidplan";
export { canAccess, canAccessAny } from "../lib/access";
