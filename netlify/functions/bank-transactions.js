const { fetchTransactions } = require("./lib/sb1-api");

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
    const query = event.queryStringParameters || {};
    const result = await fetchTransactions(event, {
      accountKey: typeof query.accountKey === "string" ? query.accountKey.trim() : "",
      fromDate: typeof query.fromDate === "string" ? query.fromDate.trim() : "",
      toDate: typeof query.toDate === "string" ? query.toDate.trim() : "",
      rowLimit: query.rowLimit
    });

    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        account_key: result.accountKey,
        from_date: result.fromDate,
        to_date: result.toDate,
        row_limit: result.rowLimit,
        transactions: result.transactions,
        errors: result.errors
      })
    };
  } catch (err) {
    console.error("Kunne ikke hente banktransaksjoner:", err && err.message ? err.message : err);
    return {
      statusCode: err && err.statusCode ? err.statusCode : 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        error: err && err.message ? err.message : "Kunne ikke hente banktransaksjoner"
      })
    };
  }
};
