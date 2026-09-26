const { DateTime } = require("luxon");
const { TIMEZONE } = require("../config/timezone");

module.exports = {
    formatTimestampToDateString: function(timestamp) {
        // Convert the timestamp to a Luxon DateTime object in CET
        const dateTimeCET = DateTime.fromMillis(timestamp, { zone: TIMEZONE });

        // Format the DateTime object as the desired string format
        const formattedString = dateTimeCET.toFormat("dd.MM.yyyy") + " - " + dateTimeCET.toFormat("HH:mm");

        return formattedString;
    },
    // A moment the way toLocaleString("de-DE") prints it — "7.9.2026, 20:15:03" —
    // but always in the server's zone (TIMEZONE), never the machine's. Takes a
    // timestamp, an ISO string or a Date; "" when it is no moment.
    formatGermanDateTime: function(value) {
        const dt = DateTime.fromJSDate(new Date(value), { zone: TIMEZONE });
        return dt.isValid ? dt.toFormat("d.M.yyyy, HH:mm:ss") : "";
    },
    // Normalize a date into the "dd-MM-yyyy" format the Raid-Helper create API
    // expects. Accepts an ISO date from an <input type="date"> ("yyyy-MM-dd") and
    // passes through an already-"dd-MM-yyyy" value unchanged. Returns "" for empty
    // or unrecognised input so callers can validate/report cleanly.
    toRaidHelperDate: function(value) {
        const str = String(value || "").trim();
        if (!str) return "";
        const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
        // already dd-MM-yyyy (what the API wants) — accept as-is
        if (/^\d{2}-\d{2}-\d{4}$/.test(str)) return str;
        return "";
    },
    // A date as people type it in Discord — "24.09.2026", "24.09.26", "24.09.",
    // "24.9." or "2026-09-24" — as "yyyy-MM-dd"; "" when it is no calendar day.
    // Without a year the coming such day is meant: one more than 60 days back
    // this year (planning January in December) is next year's, a closer one
    // stays this year, so a typo'd yesterday is caught as past, not moved a year.
    parseGermanDate: function(value, now = Date.now()) {
        const str = String(value || "").trim();
        const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
        const de = str.match(/^(\d{1,2})\.(\d{1,2})\.(?:(\d{2}|\d{4}))?$/);
        if (!iso && !de) return "";
        const [day, month] = iso ? [Number(iso[3]), Number(iso[2])] : [Number(de[1]), Number(de[2])];
        const today = DateTime.fromMillis(Number(now), { zone: TIMEZONE }).startOf("day");
        let year = iso ? Number(iso[1]) : (de[3] ? Number(de[3]) : today.year);
        if (year < 100) year += 2000;
        let dt = DateTime.fromObject({ year, month, day }, { zone: TIMEZONE });
        if (!dt.isValid) return "";
        if (!iso && !de[3] && today.diff(dt, "days").days > 60) {
            dt = dt.plus({ years: 1 });
            if (dt.day !== day) return ""; // 29.02. has no next year
        }
        return dt.toFormat("yyyy-MM-dd");
    },
    // A time of day as typed — "19:30", "19.30", "1930", "930" or "19" — as
    // "HH:mm"; "" when it is none.
    parseClockTime: function(value) {
        const str = String(value || "").trim().replace(/\s*uhr$/i, "");
        const match = str.match(/^(\d{1,2})(?:[:.]?(\d{2}))?$/);
        if (!match) return "";
        const hours = Number(match[1]);
        const minutes = match[2] === undefined ? 0 : Number(match[2]);
        if (hours > 23 || minutes > 59) return "";
        return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    },
};