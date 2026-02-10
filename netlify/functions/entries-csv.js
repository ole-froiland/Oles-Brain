const { readEntries } = require("./lib/entries-store");
const { toCsv } = require("./lib/entries-utils");

const CSV_KEY = process.env.CSV_KEY || "DIN_KEY";

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        Allow: "GET",
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: "Method Not Allowed"
    };
  }

  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (key !== CSV_KEY) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Unauthorized"
    };
  }

  try {
    const entries = await readEntries(event);
    const csv = toCsv(entries);

    return {
      statusCode: 200,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Content-Disposition": 'inline; filename="entries.csv"',
        "Content-Type": "text/csv; charset=utf-8",
        Expires: "0",
        Pragma: "no-cache",
        "Surrogate-Control": "no-store"
      },
      body: csv
    };
  } catch (err) {
    console.error("Kunne ikke bygge CSV:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
      body: "Kunne ikke hente CSV"
    };
  }
};
