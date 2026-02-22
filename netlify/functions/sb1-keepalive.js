const { issueAccessTokenFromRefreshToken } = require("./lib/sb1-api");

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

exports.handler = async (event) => {
  try {
    const accessToken = await issueAccessTokenFromRefreshToken(event);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: Boolean(accessToken),
        refreshed_at: new Date().toISOString()
      })
    };
  } catch (err) {
    console.error("SB1 keepalive feilet:", err && err.message ? err.message : err);
    return {
      statusCode: err && err.statusCode ? err.statusCode : 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: false,
        error: err && err.message ? err.message : "SB1 keepalive feilet"
      })
    };
  }
};

exports.config = {
  schedule: "@daily"
};
