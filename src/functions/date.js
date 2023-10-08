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
        const parts = dateString.split('-');
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1; // Months in JavaScript are zero-based
        const year = parseInt(parts[2], 10);
        return new Date(year, month, day);
    }, 
	toTimestamp: function(dateString) {
        const timestampCET = DateTime.fromFormat(dateString, 'dd.MM.yy-HH:mm', { zone: 'Europe/Paris' }).toMillis();
    
        return timestampCET;
    },
	formatTimestampToDateString: function(timestamp) {
        // Convert the timestamp to a Luxon DateTime object in CET
        const dateTimeCET = DateTime.fromMillis(timestamp, { zone: 'Europe/Paris' });
    
        // Format the DateTime object as the desired string format
        const formattedString = dateTimeCET.toFormat('dd.MM.yyyy') + ' - ' + dateTimeCET.toFormat('HH:mm');
    
        return formattedString;
    },
}