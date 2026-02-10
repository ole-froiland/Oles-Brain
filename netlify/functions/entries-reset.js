const { readEntries, writeEntries } = require("./lib/entries-store");

const CSV_KEY = process.env.CSV_KEY || "DIN_KEY";
const RESET_KEY = process.env.RESET_KEY || CSV_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        Allow: "POST",
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  const key = event.queryStringParameters && event.queryStringParameters.key;
  if (key !== RESET_KEY) {
    return {
      statusCode: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Unauthorized" })
    };
  }

  try {
    const entries = await readEntries(event);
    const deleted = entries.length;
    await writeEntries(event, []);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: true, deleted })
    };
  } catch (err) {
    console.error("Kunne ikke nullstille entries:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "Kunne ikke nullstille" })
    };
  }
};
