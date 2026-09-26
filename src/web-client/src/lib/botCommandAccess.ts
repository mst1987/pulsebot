// The rules behind Einstellungen → Berechtigungen → Bot-Befehle, kept apart from
// the component so src/web-client/src/lib/botCommandAccess.test.ts can run them in
// plain Node.
//
// Written like lib/settingsLogic.ts: every function is `export function
// name(params): Result {` on one line and no body uses type syntax, so stripping
// the signatures' annotations leaves valid JavaScript.
import type { BotAccessMode, BotAccessRule, BotCommand } from "../api";
import { t } from "../i18n";

export type AccessMap = Record<string, BotAccessRule>;
export type RoleNameOf = (id: string) => string;

/** "Jeder" · "Nur Rollen" · "Nur Admins", in the active language. */
export function modeLabel(mode: BotAccessMode): string {
    return t(`settings.botCommands.mode.${mode}`);
}

/** How the command is written in the list: `/name` for a slash command, the bare name for a button. */
export function commandLabel(command: BotCommand): string {
    return command.kind === "button" ? command.name : `/${command.name}`;
}

/** The rule that applies: the stored one, else the code's default. */
export function ruleOf(command: BotCommand, map: AccessMap): BotAccessRule {
    return map[command.name] || command.defaultAccess;
}

/** Whether two rules grant the same (role order does not matter). */
export function sameRule(a: BotAccessRule, b: BotAccessRule): boolean {
    if (a.mode !== b.mode) return false;
    if (a.mode !== "roles") return true;
    const left = [...a.roleIds].sort().join(",");
    const right = [...b.roleIds].sort().join(",");
    return left === right;
}

/** A rule that can be saved: "Nur Rollen" needs at least one role. */
export function ruleValid(rule: BotAccessRule): boolean {
    return rule.mode !== "roles" || rule.roleIds.length > 0;
}

/** The rule as it is stored: roles only for "Nur Rollen", without duplicates. */
export function cleanRule(rule: BotAccessRule): BotAccessRule {
    if (rule.mode !== "roles") return { mode: rule.mode, roleIds: [] };
    return { mode: "roles", roleIds: [...new Set(rule.roleIds)] };
}

/**
 * The map with one command set to a rule. A rule equal to the command's
 * default removes the entry instead — "Standard" means the code decides, so a
 * later change of the default reaches that command too.
 */
export function withRule(map: AccessMap, command: BotCommand, rule: BotAccessRule): AccessMap {
    const out = { ...map };
    const clean = cleanRule(rule);
    if (sameRule(clean, command.defaultAccess)) delete out[command.name];
    else out[command.name] = clean;
    return out;
}

/** "für alle Befehle der Gruppe übernehmen": the same rule on every command of the group. */
export function withGroupRule(map: AccessMap, commands: BotCommand[], groupId: string, rule: BotAccessRule): AccessMap {
    let out = map;
    for (const command of commands) {
        if (command.group === groupId) out = withRule(out, command, rule);
    }
    return out;
}

/** The commands of a group in list order. */
export function commandsOfGroup(commands: BotCommand[], groupId: string): BotCommand[] {
    return commands.filter((c) => c.group === groupId);
}

/**
 * The small line under a group's name: "5 Befehle · @Orga, @Raidleiter", plus
 * how many are open to everyone or kept for admins when the group mixes them.
 */
export function groupSummary(commands: BotCommand[], map: AccessMap, roleName: RoleNameOf): string {
    const count = commands.length;
    const parts = [t("settings.botCommands.commands", { count })];
    const roles = [];
    let everyone = 0;
    let admins = 0;
    for (const command of commands) {
        const rule = ruleOf(command, map);
        if (rule.mode === "everyone") everyone += 1;
        else if (rule.mode === "admins") admins += 1;
        else for (const id of rule.roleIds) if (!roles.includes(id)) roles.push(id);
    }
    if (roles.length) {
        const names = roles.slice(0, 3).map(roleName);
        parts.push(roles.length > 3 ? `${names.join(", ")} +${roles.length - 3}` : names.join(", "));
    }
    if (everyone) parts.push(everyone === count ? modeLabel("everyone") : t("settings.botCommands.everyoneSome", { count: everyone }));
    if (admins) parts.push(admins === count ? t("settings.botCommands.adminsAll") : t("settings.botCommands.adminsSome", { count: admins }));
    return parts.join(" · ");
}

/** How many commands of the list differ from their default. */
export function customizedCount(commands: BotCommand[], map: AccessMap): number {
    return commands.filter((c) => !!map[c.name] && !sameRule(map[c.name], c.defaultAccess)).length;
}
