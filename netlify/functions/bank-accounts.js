const { fetchAccounts } = require("./lib/sb1-api");

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        ...JSON_HEADERS,
        Allow: "GET"
      },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  try {
    const preferredAccountKey =
      event.queryStringParameters && typeof event.queryStringParameters.accountKey === "string"
        ? event.queryStringParameters.accountKey.trim()
        : "";

    const result = await fetchAccounts(preferredAccountKey);

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        accounts: result.accounts,
        selected_account_key: result.selectedAccountKey,
        errors: result.errors
      })
    };
  } catch (err) {
    console.error("Kunne ikke hente bankkontoer:", err && err.message ? err.message : err);
    return {
      statusCode: err && err.statusCode ? err.statusCode : 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: err && err.message ? err.message : "Kunne ikke hente bankkontoer"
      })
    };
  }
};
