const { isValidDateString, todayDateString } = require("./lib/entries-utils");
const { readStepEntries } = require("./lib/steps-store");
const { dailyStatus } = require("./lib/steps-utils");

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        Allow: "GET",
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  const requestedDate = event.queryStringParameters && event.queryStringParameters.date;
  const date = requestedDate || todayDateString();

  if (!isValidDateString(date)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Ugyldig dato" })
    };
  }

  try {
    const entries = await readStepEntries(event);
    const status = dailyStatus(entries, date);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(status)
    };
  } catch (err) {
    console.error("Kunne ikke hente steg:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Kunne ikke hente steg" })
    };
  }
};
