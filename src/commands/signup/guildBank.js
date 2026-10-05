// The orga's buttons under a guild bank request in the orga channel
// (services/signups/guildBank.js, built by utils/signup/guildBankPost.js):
//
//   guildbank:done:<id>      "Erledigt" — resolves at once, the raider gets a DM
//   guildbank:reject:<id>    "Ablehnen …" — opens the decline modal
//   guildbank:mreject:<id>   the submitted decline modal (optional reason)
//
// Only the orga with write access to `raids` may — the same rights model as
// the web menu (config/permissions.js), resolved by services/discord/userAccess.js
// from the member's roles on the event servers. The bot gate (botAccess.js)
// lets every click through (`defaultAccess: "everyone"`): the channel is the
// orga's, and the real check is the area right below, not a role list of its
// own. Every answer is ephemeral and German (orga text).
const { MessageFlags } = require("discord.js");
const store = require("../../stores/guildBankStore");
const guildBank = require("../../services/signups/guildBank");
const { userMayAny } = require("../../services/discord/userAccess");
const { PREFIX, parseOrgaId, rejectModal, plain } = require("../../utils/signup/guildBankPost");

const NO_RIGHTS = "Das darf nur die Orga mit Raid-Rechten.";
const GONE = "Diese Anfrage gibt es nicht mehr.";
const HANDLED = "Diese Anfrage ist schon erledigt.";

/** The clicking member's name as the orga reads it. */
function displayName(interaction) {
    const member = interaction.member;
    const user = interaction.user || {};
    return String((member && (member.displayName || member.nick)) || user.globalName || user.username || "").trim();
}

const mayHandle = (interaction) => userMayAny(interaction.user.id, ["raids"], "write");

/** What the orga reads after handling a request. */
function doneText(result) {
    const r = result.request;
    const name = plain(r.userName);
    const what = r.status === "done" ? "✅ Erledigt" : "⛔ Abgelehnt";
    const dm = result.dm ? `${name || "Der Raider"} bekommt eine DM.` : `Die DM an ${name || "den Raider"} kam nicht an – sind die DMs zu?`;
    return `${what} – ${dm}${result.posted ? "" : "\n⚠️ Der Post im Kanal ließ sich nicht aktualisieren."}`;
}

/** Resolve a request and say how it went (the reply is already deferred). */
async function resolve(interaction, id, status, reason = "") {
    const result = await guildBank.resolveRequest(id, { by: interaction.user.id, byName: displayName(interaction), status, reason });
    if (result.error) return interaction.editReply({ content: result.request ? HANDLED : GONE });
    return interaction.editReply({ content: doneText(result) });
}

module.exports = {
    name: PREFIX,
    description: "Knöpfe unter einer Gildenbank-Anfrage im Orga-Kanal (Erledigt, Ablehnen)",
    group: "signup",
    defaultAccess: "everyone",
    async execute(interaction) {
        const { action, id } = parseOrgaId(interaction.customId);
        const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
        if (!id || !["done", "reject", "mreject"].includes(action)) return ephemeral("Unbekannte Aktion.");
        if (action === "reject") {
            // the modal must be the first answer — check before opening it
            if (!(await mayHandle(interaction))) return ephemeral(NO_RIGHTS);
            const request = store.getRequest(id);
            if (!request) return ephemeral(GONE);
            if (request.status !== "open") {
                // answer first (three seconds), then take the stale buttons off the post
                await ephemeral(HANDLED);
                return guildBank.redrawPost(request);
            }
            return interaction.showModal(rejectModal(id));
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!(await mayHandle(interaction))) return interaction.editReply({ content: NO_RIGHTS });
        if (action === "done") return resolve(interaction, id, "done");
        let reason = "";
        try {
            reason = String(interaction.fields.getTextInputValue("reason") || "").trim();
        } catch {
            // no reason field: declined without one
        }
        return resolve(interaction, id, "rejected", reason);
    },
};
