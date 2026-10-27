// Rollen-Nachrichten (self-service roles): the editor's logic without React —
// what blocks a role, what is still wrong with the form, the server's error
// codes in words, the colour field and the button rows of the preview. The
// server checks everything again (src/services/discord/roleMessages.js); this
// side only says it before the click.
import type { ApiError, RoleMessageChannelOption, RoleMessageInput, RoleMessageLimits, RoleMessageRole, RoleMessageRoleOption } from "../../api";
import { t } from "../../i18n";
import { previewEmoji } from "./buttonEmoji";

/** Discord's limits as the server has them (GET /api/role-messages sends the same). */
export const ROLE_MESSAGE_LIMITS: RoleMessageLimits = { roles: 25, reactions: 20, title: 200, body: 3000, label: 80 };

/** Buttons per row of a Discord message. */
export const BUTTONS_PER_ROW = 5;

/** An error of the role-message routes: the code plus, for a role, which one and why. */
export type RoleMessageError = ApiError & { roleId?: string; reason?: string };

// ---- why a role cannot be handed out ------------------------------------------

/** The server's English reasons (selfRole.js) → the i18n key under roleMessages.reason. */
const REASONS: Record<string, string> = {
    "the role is a full-admin role": "admin",
    "the role is an orga role": "orga",
    "the role is pinged on new applications (officer role)": "officer",
    "the role has rights under Einstellungen -> Berechtigungen": "permissions",
    "the role may run bot commands (botCommandAccess)": "botCommands",
    "the role is a raider role of a category": "raider",
    "the role is part of the role sync between the servers": "roleSync",
    "the role carries Discord permissions beyond @everyone": "discordPermissions",
    "missing Manage Roles": "manageRoles",
    "the role belongs to an integration": "integration",
    "the role is above the bot's highest role": "aboveBot",
};

/** A server reason in the menu's language; an unknown one stays as the server wrote it. */
export function reasonText(reason: string): string {
    const key = REASONS[reason];
    if (key) return t(`roleMessages.reason.${key}`);
    const roster = /^the role belongs to the roster (.+)$/.exec(reason);
    if (roster) return t("roleMessages.reason.roster", { roster: roster[1] });
    const channel = /^the role unlocks the channel #(.+)$/.exec(reason);
    if (channel) return t("roleMessages.reason.channel", { channel: channel[1] });
    return reason;
}

/** Why the role may not go into a message ("" when it may): its rights first, then the bot's reach. */
export function roleBlockReason(role: RoleMessageRoleOption): string {
    if (role.privileged) return reasonText(role.privileged);
    if (role.managed) return reasonText("the role belongs to an integration");
    if (!role.editable) return reasonText("the role is above the bot's highest role");
    return "";
}

// ---- emoji ----------------------------------------------------------------------

/** The key two emojis share when they are "the same reaction": a server emoji's id, a Unicode emoji without U+FE0F. */
export function emojiKey(text: string): string {
    const parsed = previewEmoji(text || "");
    if (!parsed) return "";
    return parsed.kind === "custom" ? parsed.id : parsed.text.replace(/️/g, "");
}

// ---- colour ---------------------------------------------------------------------

/** 0..0xFFFFFF → "#rrggbb"; null stays null (the bot's own accent). */
export function colorToHex(color: number | null | undefined): string | null {
    if (color === null || color === undefined || !Number.isFinite(color)) return null;
    return `#${Math.max(0, Math.min(0xffffff, Math.round(color))).toString(16).padStart(6, "0")}`;
}

// ---- the form's problems --------------------------------------------------------

export type RoleMessageProblem =
    | { code: "missingChannel" | "missingTitle" | "titleLong" | "bodyLong" | "badImage" | "noRoles" | "tooManyRoles" | "tooManyReactions" }
    | { code: "labelLong" | "duplicateEmoji" | "duplicateRole" | "blockedRole" | "unknownRole"; roleId: string };

/**
 * What is still wrong with the form, in the order the fields stand. `roles` are
 * the server's roles (empty while the bot is offline: then a role is not judged).
 */
export function roleMessageProblems(input: RoleMessageInput, roles: RoleMessageRoleOption[], limits: RoleMessageLimits = ROLE_MESSAGE_LIMITS): RoleMessageProblem[] {
    const out: RoleMessageProblem[] = [];
    if (!input.channelId) out.push({ code: "missingChannel" });
    if (!input.title.trim()) out.push({ code: "missingTitle" });
    if (input.title.trim().length > limits.title) out.push({ code: "titleLong" });
    if (input.body.trim().length > limits.body) out.push({ code: "bodyLong" });
    if (input.imageUrl.trim() && !/^https:\/\/\S+$/i.test(input.imageUrl.trim())) out.push({ code: "badImage" });
    if (!input.roles.length) out.push({ code: "noRoles" });
    if (input.roles.length > limits.roles) out.push({ code: "tooManyRoles" });
    if (input.roles.filter((r) => r.emoji.trim()).length > limits.reactions) out.push({ code: "tooManyReactions" });

    const byId = new Map(roles.map((r) => [r.id, r]));
    const seenRoles = new Set<string>();
    const seenEmojis = new Set<string>();
    for (const r of input.roles) {
        if (seenRoles.has(r.roleId)) out.push({ code: "duplicateRole", roleId: r.roleId });
        seenRoles.add(r.roleId);
        if (roles.length) {
            const opt = byId.get(r.roleId);
            if (!opt) out.push({ code: "unknownRole", roleId: r.roleId });
            else if (roleBlockReason(opt)) out.push({ code: "blockedRole", roleId: r.roleId });
        }
        if (r.label.trim().length > limits.label) out.push({ code: "labelLong", roleId: r.roleId });
        const key = emojiKey(r.emoji);
        if (key && seenEmojis.has(key)) out.push({ code: "duplicateEmoji", roleId: r.roleId });
        if (key) seenEmojis.add(key);
    }
    return out;
}

/** One problem as a sentence; `roleName` names the role of a role problem. */
export function problemText(p: RoleMessageProblem, limits: RoleMessageLimits, roleName: (id: string) => string): string {
    const role = "roleId" in p ? roleName(p.roleId) : "";
    return t(`roleMessages.problem.${p.code}`, { ...limits, role });
}

// ---- the server's errors --------------------------------------------------------

const ERROR_CODES = new Set([
    "unknown_guild", "no_guild", "unknown_channel", "missing_title", "bad_image", "no_roles", "too_many_roles",
    "too_many_reactions", "duplicate_role", "unknown_role", "bad_emoji", "unknown_emoji", "duplicate_emoji",
    "privileged_role", "role_unusable", "missing_id", "not_found", "post_failed", "edit_failed", "bot_offline",
]);

/**
 * A failed save or delete in words: every known code has its sentence (with the
 * role's name and the reason in the menu's language), an unknown one keeps the
 * server's own message.
 */
export function roleMessageErrorText(err: RoleMessageError, roleName: (id: string) => string, limits: RoleMessageLimits = ROLE_MESSAGE_LIMITS): string {
    if (!err || !ERROR_CODES.has(err.code)) return err?.message || t("common.error");
    const role = err.roleId ? roleName(err.roleId) : "";
    const reason = err.reason ? reasonText(err.reason) : "";
    return t(`roleMessages.error.${err.code}`, { ...limits, role, reason, message: err.message || "" });
}

// ---- channels and buttons -------------------------------------------------------

export type ChannelGroup = { category: string; channels: RoleMessageChannelOption[] };

/** The channels by their category, in the server's order; channels without one first. */
export function groupChannels(channels: RoleMessageChannelOption[]): ChannelGroup[] {
    const groups: ChannelGroup[] = [];
    for (const c of channels) {
        const name = c.category || "";
        let g = groups.find((x) => x.category === name);
        if (!g) {
            g = { category: name, channels: [] };
            if (name) groups.push(g);
            else groups.unshift(g);
        }
        g.channels.push(c);
    }
    return groups;
}

/** The roles as Discord lays out their buttons: rows of five. */
export function buttonRows<T>(roles: T[], perRow = BUTTONS_PER_ROW): T[][] {
    const rows: T[][] = [];
    for (let i = 0; i < roles.length; i += perRow) rows.push(roles.slice(i, i + perRow));
    return rows;
}

/** The input the API takes from the editor's draft (texts trimmed, empty labels to the role name). */
export function toInput(draft: RoleMessageInput, roles: RoleMessageRoleOption[]): RoleMessageInput {
    const name = (id: string) => roles.find((r) => r.id === id)?.name || "";
    return {
        ...draft,
        title: draft.title.trim(),
        body: draft.body.trim(),
        imageUrl: draft.imageUrl.trim(),
        roles: draft.roles.map((r: RoleMessageRole) => ({ roleId: r.roleId, emoji: r.emoji.trim(), label: r.label.trim() || name(r.roleId) })),
    };
}
