// German bot texts of absences and attendances (/availability, the panel, the DMs).
module.exports = {
    // panel
    "Enter absence": "Abwesenheit eintragen",
    "Enter attendance": "Anwesenheit eintragen",
    "My entries": "Meine Einträge",
    "Absence & attendance": "Ab- & Anwesenheit",
    "Absence & attendance · {category}": "Ab- & Anwesenheit · {category}",
    "**Away for a while?** Enter your absence and you are signed off from every **{category}** raid in that period – also from raids created later.":
        "**Länger weg?** Trag deine Abwesenheit ein, dann wirst du von jedem **{category}**-Raid in diesem Zeitraum abgemeldet – auch von Raids, die erst später angelegt werden.",
    "**Away for a while?** Enter your absence and you are signed off from every raid in that period – also from raids created later.":
        "**Länger weg?** Trag deine Abwesenheit ein, dann wirst du von jedem Raid in diesem Zeitraum abgemeldet – auch von Raids, die erst später angelegt werden.",
    "**There for sure?** Enter your attendance with a character and you are signed up for every **{category}** raid in that period as *Signed up*.":
        "**Sicher dabei?** Trag deine Anwesenheit mit einem Charakter ein, dann wirst du für jeden **{category}**-Raid in diesem Zeitraum als *Dabei* angemeldet.",
    "**There for sure?** Enter your attendance with a character and you are signed up for every raid in that period as *Signed up*.":
        "**Sicher dabei?** Trag deine Anwesenheit mit einem Charakter ein, dann wirst du für jeden Raid in diesem Zeitraum als *Dabei* angemeldet.",
    "You pick the raids yourself, and you get a DM for every raid the bot signs you up or off for. Your own signup always stays yours to change.":
        "Die Raids wählst du selbst, und für jeden Raid, für den dich der Bot an- oder abmeldet, bekommst du eine DM. Deine Anmeldung kannst du jederzeit selbst ändern.",
    // modal
    "From (day)": "Von (Tag)",
    "e.g. 24.10. or 24.10.2026": "z. B. 24.10. oder 24.10.2026",
    "To (day, empty = the same day)": "Bis (Tag, leer = derselbe Tag)",
    "e.g. 31.10.": "z. B. 31.10.",
    "Reason (optional, the raid lead sees it)": "Grund (optional, sieht die Raidleitung)",
    "e.g. holiday, work": "z. B. Urlaub, Arbeit",
    // picker
    "Reason: {reason}": "Grund: {reason}",
    "Character: **{character}** · {spec} ({version})": "Charakter: **{character}** · {spec} ({version})",
    "Pick the raids to sign off from ({picked} of {total}).": "Wähle die Raids, von denen du dich abmeldest ({picked} von {total}).",
    "Pick the raids to sign up for ({picked} of {total}).": "Wähle die Raids, für die du dich anmeldest ({picked} von {total}).",
    "No raid in this period yet.": "In diesem Zeitraum gibt es noch keinen Raid.",
    "Raids created later in this period sign you off automatically.": "Raids, die später in diesem Zeitraum angelegt werden, melden dich automatisch ab.",
    "Raids created later in this period sign you up automatically.": "Raids, die später in diesem Zeitraum angelegt werden, melden dich automatisch an.",
    "Character · spec": "Charakter · Spec",
    "No raid picked – only later ones": "Kein Raid gewählt – nur spätere",
    "Save absence": "Abwesenheit speichern",
    "Save attendance": "Anwesenheit speichern",
    // list
    "Away": "Weg",
    "There": "Dabei",
    "No absence or attendance entered.": "Keine Ab- oder Anwesenheit eingetragen.",
    "Deleting an entry stops it – the signups it made stay as they are.": "Löschen beendet den Eintrag – die An- und Abmeldungen, die er gemacht hat, bleiben.",
    "Delete an entry …": "Eintrag löschen …",
    "Away {period}": "Weg {period}",
    "There {period}": "Dabei {period}",
    "Absence": "Abwesenheit",
    "My absences & attendances": "Meine Ab- & Anwesenheiten",
    "⚠️ I could not send you a DM – are your DMs closed for this server?": "⚠️ Ich konnte dir keine DM schicken – hast du DMs für diesen Server geschlossen?",
    // command
    "Your profile has no character with a usable spec for these raids yet – add one first.":
        "Dein Profil hat noch keinen Charakter mit brauchbarer Spec für diese Raids – leg zuerst einen an.",
    "This selection has expired – start again with the button or /availability.": "Diese Auswahl ist abgelaufen – starte neu über den Knopf oder /availability.",
    "Cancelled – nothing was saved.": "Abgebrochen – nichts gespeichert.",
    "Entry deleted.": "Eintrag gelöscht.",
    // service: comment and DMs
    "Away {from}–{to}": "Weg {from}–{to}",
    "Character: **{character}** · {spec}": "Charakter: **{character}** · {spec}",
    "**Signed off from:**": "**Abgemeldet von:**",
    "**Signed up for:**": "**Angemeldet für:**",
    "No raid to sign off from yet.": "Noch kein Raid zum Abmelden.",
    "No raid to sign up for yet.": "Noch kein Raid zum Anmelden.",
    "already signed off": "schon abgemeldet",
    "already signed up": "schon angemeldet",
    "you are away": "du bist weg",
    "skipped": "übersprungen",
    "Raids created later in this period sign you off automatically – you get a DM each time.":
        "Raids, die später in diesem Zeitraum angelegt werden, melden dich automatisch ab – du bekommst jedes Mal eine DM.",
    "Raids created later in this period sign you up automatically – you get a DM each time.":
        "Raids, die später in diesem Zeitraum angelegt werden, melden dich automatisch an – du bekommst jedes Mal eine DM.",
    "Absence saved": "Abwesenheit gespeichert",
    "Attendance saved": "Anwesenheit gespeichert",
    "Entered for you by the raid lead": "Von der Raidleitung für dich eingetragen",
    "You are away {period} ({reason}), so you were signed off.": "Du bist {period} weg ({reason}), deshalb wurdest du abgemeldet.",
    "You are away {period}, so you were signed off.": "Du bist {period} weg, deshalb wurdest du abgemeldet.",
    "You are available {period}, so you were signed up with **{character}** · {spec}.": "Du bist {period} da, deshalb wurdest du mit **{character}** · {spec} angemeldet.",
    "Changed your mind? Sign up or off again in the raid's message.": "Doch anders? Melde dich in der Nachricht des Raids wieder an oder ab.",
    "Signed off automatically": "Automatisch abgemeldet",
    "Signed up automatically": "Automatisch angemeldet",
};
