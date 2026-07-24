const { DateTime } = require("luxon");

module.exports = {
    getWednesdayWeeksAgo: function(weeks) {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        // Calculate the number of days to subtract to get to the previous Wednesday
        const daysToSubtract = ((today.getDay() + 4) % 7) + 7 * (weeks - 1);
    
        // Subtract two weeks' worth of days and the calculated daysToSubtract
        const weeksAgo = new Date(today.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);
    
        return weeksAgo;
    },
    // Function to parse "D-M-YYYY" format
    parseDMYDateString: function(dateString) {
        const parts = dateString.split("-");
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Months in JavaScript are zero-based
        const year = parseInt(parts[2], 10);
        return new Date(year, month, day);
    }, 
    toTimestamp: function(dateString) {
        const timestampCET = DateTime.fromFormat(dateString, "dd.MM.yy-HH:mm", { zone: "Europe/Paris" }).toMillis();
    
        return timestampCET;
    },
    formatTimestampToDateString: function(timestamp) {
        // Convert the timestamp to a Luxon DateTime object in CET
        const dateTimeCET = DateTime.fromMillis(timestamp, { zone: "Europe/Paris" });

        // Format the DateTime object as the desired string format
        const formattedString = dateTimeCET.toFormat("dd.MM.yyyy") + " - " + dateTimeCET.toFormat("HH:mm");

        return formattedString;
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
};