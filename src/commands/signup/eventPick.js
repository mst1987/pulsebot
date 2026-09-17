const { getEvent } = require("../../web/eventStore");
const { PICK_PREFIX, PICK_MINE, messageComponents } = require("../../web/eventMessage");
const { onJoin, onClass, reply, emojisFor } = require("./eventButton");

// The public signup select under an EventHelper event message (#303):
//
//   event-pick:<eventId>   value "mine"     → the member's own characters · specs (multi-select,
//                                             up to 3) with the classes below — or a direct signup
//                                             with the only fitting character
//                          value <classId>  → the spec select → the name modal
//
// A message component is the same for everybody, so this select cannot list
// anyone's own characters; "Meine Charaktere …" opens them ephemerally. Every
// step after it is the button flow's (eventButton.js, utils/signupButtons.js).
//
// Discord keeps a picked option shown in the member's client and sends nothing
// when the same option is picked again. So the answer first resets the select
// by updating the message's components (the embed stays untouched), then
// follows up ephemerally.

/** Put the public select back to its placeholder for the member who picked. Best-effort. */
async function resetSelect(interaction, event) {
    try {
        await interaction.update({ components: messageComponents(event, { emojis: await emojisFor(interaction) }) });
        return true;
    } catch (e) {
        console.warn(`[eventPick] Auswahl nicht zurückgesetzt: ${e.message}`);
        return false;
    }
}

module.exports = {
    name: PICK_PREFIX,
    description: "Anmelde-Auswahl (Charakter oder Klasse) unter einer EventHelper-Event-Nachricht",
    // One more way into the signup buttons' flow — the same access.
    accessOf: "event-btn",
    async execute(interaction) {
        const [, eventId = ""] = String(interaction.customId || "").split(":");
        const event = getEvent(eventId);
        if (!event) return reply(interaction, "Dieses Event gibt es nicht mehr.");
        await resetSelect(interaction, event);
        const value = String((interaction.values || [])[0] || "");
        if (value === PICK_MINE) return onJoin(interaction, event);
        return onClass(interaction, event, value);
    },
};
