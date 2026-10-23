// The words of the roles page (System › Discord › Rollen): what a role means for
// the bot, whether the bot can hand it out and why not, and the order the table
// shows. The server sends codes only (api/discordRoles.ts); everything a reader
// sees is put together here, in the active language.
import { t, tOr } from "../../i18n";
import type { ServerRole, ServerRoleUse } from "../../api";

/** One thing the bot does with the role, as a short line. */
export function roleUseLabel(use: ServerRoleUse): string {
    switch (use.code) {
        case "rolePermissions":
            return t("discord.roles.use.rolePermissions", { areas: use.areas.map((a) => tOr(`settings.areas.${a}.label`, a)).join(", ") });
        case "botCommand":
            return t("discord.roles.use.botCommand", { commands: use.commands.map((c) => `/${c}`).join(", ") });
        case "categoryRaider": {
            const names = (use.categories || []).map((c) => c.name).filter(Boolean);
            return names.length ? t("discord.roles.use.categoryRaider", { names: names.join(", ") }) : t("discord.roles.use.categoryRaiderAny");
        }
        case "roleSync":
            return t("discord.roles.use.roleSync", { sides: use.sides.map((s) => t(`discord.roles.side.${s}`)).join(", ") });
        case "roster":
            return t("discord.roles.use.roster", { name: use.name, kinds: use.kinds.map((k) => t(`discord.roles.use.rosterKind.${k}`)).join(", ") });
        case "roleMessage":
            return t("discord.roles.use.roleMessage", { title: use.title });
        default:
            return t(`discord.roles.use.${use.code}`);
    }
}

/** Every use of the role; a role without one says what it is instead ("nicht genutzt", "Grundrechte aller" …). */
export function roleUseLines(role: ServerRole): string[] {
    if (role.everyone) return [t("discord.roles.cell.everyone")];
    const lines = role.uses.map(roleUseLabel);
    if (role.isBotRole) return [t("discord.roles.cell.botRole"), ...lines];
    if (lines.length) return lines;
    return [role.managed ? t("discord.roles.cell.integration") : t("discord.roles.cell.unused")];
}

export type AssignView = {
    text: string;
    /** one word for a phone; the full text goes into its tooltip there */
    short: string;
    /** the tooltip's explanation, when the short text needs one */
    sub?: string;
    /** "ok" the bot can; "fix" it should but cannot (a note); "plain" expected or fixed */
    tone: "ok" | "fix" | "plain";
};

/** "Bot kann vergeben": yes, or the reason in words. */
export function assignView(role: ServerRole, botName: string): AssignView {
    const short = (key: string) => t(`discord.roles.assignShort.${key}`);
    if (role.assign.ok) return { text: t("discord.roles.assign.yes"), short: short("yes"), tone: "ok" };
    switch (role.assign.reason) {
        case "everyone": return { text: t("discord.roles.assign.everyone"), short: short("everyone"), tone: "plain" };
        case "managed":
        case "botRole":
            return { text: t(`discord.roles.assign.${role.assign.reason}`), short: short(role.assign.reason), sub: t("discord.roles.assign.managedSub"), tone: "plain" };
        case "noManageRoles":
            return { text: t("discord.roles.assign.noManageRoles"), short: short("noManageRoles"), sub: t("discord.roles.assign.noManageRolesSub"), tone: "fix" };
        default:
            return role.hints.includes("aboveBot")
                ? { text: t("discord.roles.assign.aboveFix", { bot: botName }), short: short("aboveFix"), sub: t("discord.roles.assign.aboveFixSub"), tone: "fix" }
                : { text: t("discord.roles.assign.above"), short: short("above"), tone: "plain" };
    }
}

/**
 * Where a role stands to the bot's own one, read from what the server says about
 * handing it out: below (the bot can give it), above, or the bot role itself.
 * "" when that answer does not tell (the bot lacks the right, @everyone, an app's role).
 */
export function botRelation(role: ServerRole): "below" | "above" | "own" | "" {
    if (role.everyone) return "";
    if (role.assign.ok) return "below";
    if (role.assign.reason === "above") return "above";
    if (role.assign.reason === "botRole") return "own";
    return "";
}

/**
 * The calm line above the table: the sensitive permissions that are normal on
 * this server (@everyone has them, or most roles do), so the table shows them in
 * grey and keeps orange for the outliers. `total` = the roles without @everyone.
 */
export function commonSensitiveItems(common: { key: string; roles: number; everyone: boolean }[], total: number, label: (key: string) => string): string[] {
    return common.map((c) => (c.everyone
        ? t("discord.roles.page.commonEveryone", { perm: label(c.key) })
        : t("discord.roles.page.commonRoles", { perm: label(c.key), count: c.roles, total })));
}

/**
 * The rank the table shows: 1 is the highest role, as Discord lists them;
 * @everyone has none (null). `roles` come highest first from the server.
 */
export function ranks(roles: ServerRole[]): Map<string, number | null> {
    const out = new Map<string, number | null>();
    let n = 0;
    for (const r of [...roles].sort((a, b) => b.position - a.position)) out.set(r.id, r.everyone ? null : ++n);
    return out;
}

/**
 * Where the line "Bot-Rolle … alles darunter kann der Bot vergeben" goes: the
 * index of the bot's role in rows sorted top first, or -1 (no bot role shown).
 */
export function dividerAt(rows: ServerRole[], botRoleId: string | null | undefined): number {
    if (!botRoleId) return -1;
    return rows.findIndex((r) => r.id === botRoleId);
}

/** The members filter of the drawer: case-insensitive on the display name. */
export function matchesMember(name: string, query: string): boolean {
    const q = query.trim().toLowerCase();
    return !q || name.toLowerCase().includes(q);
}

/** Up to two letters for a member without a picture. */
export function initialsOf(name: string): string {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
    return letters.toUpperCase();
}
