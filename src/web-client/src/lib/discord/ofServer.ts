// The client's second loot filter (#919): the API already sends only the active
// Discord server's loot; a row that still names another server is dropped here,
// so a server switch can never show a leftover of the previous one. A row without
// `guildId` (an older API answer) stays - the API filtered it already.

/** The rows of `rows` that belong to the active server `activeGuildId`. */
export function ofServer<T extends { guildId?: string }>(rows: T[], activeGuildId: string | undefined): T[] {
    return rows.filter((row) => !row.guildId || row.guildId === activeGuildId);
}
