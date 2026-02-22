const SB1_API_BASE =
  typeof process.env.SB1_API_BASE === "string" && process.env.SB1_API_BASE.trim() !== ""
    ? process.env.SB1_API_BASE.trim()
    : "https://api.sparebank1.no";
const SB1_CLIENT_ID = typeof process.env.SB1_CLIENT_ID === "string" ? process.env.SB1_CLIENT_ID.trim() : "";
const SB1_CLIENT_SECRET =
  typeof process.env.SB1_CLIENT_SECRET === "string" ? process.env.SB1_CLIENT_SECRET.trim() : "";
const SB1_REFRESH_TOKEN =
  typeof process.env.SB1_REFRESH_TOKEN === "string" ? process.env.SB1_REFRESH_TOKEN.trim() : "";
const SB1_DEFAULT_ACCOUNT_KEY =
  typeof process.env.SB1_DEFAULT_ACCOUNT_KEY === "string" ? process.env.SB1_DEFAULT_ACCOUNT_KEY.trim() : "";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function isoDateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function isValidIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseBankRowLimit(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  if (!Number.isInteger(parsed)) {
    return 25;
  }
  return Math.max(1, Math.min(parsed, 200));
}

function ensureConfig() {
  if (!SB1_CLIENT_ID || !SB1_CLIENT_SECRET || !SB1_REFRESH_TOKEN) {
    const err = new Error("Manglende SB1-konfigurasjon på server");
    err.statusCode = 503;
    throw err;
  }
}

async function issueAccessTokenFromRefreshToken() {
  ensureConfig();

  const response = await fetch(`${SB1_API_BASE}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      client_id: SB1_CLIENT_ID,
      client_secret: SB1_CLIENT_SECRET,
      refresh_token: SB1_REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  });

  const body = await response.json().catch(() => ({}));
  const accessToken = typeof body.access_token === "string" ? body.access_token : "";
  if (!response.ok || !accessToken) {
    const err = new Error(body.error_description || body.error || "Kunne ikke hente SB1-token");
    err.statusCode = response.status || 502;
    throw err;
  }

  return accessToken;
}

async function fetchSb1Json(pathname, { accessToken, accept, queryParams }) {
  const url = new URL(pathname, SB1_API_BASE);
  if (queryParams && typeof queryParams === "object") {
    Object.entries(queryParams).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }
      url.searchParams.append(key, String(value));
    });
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: accept
    },
    cache: "no-store"
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.error_description || body.error || "SB1-kall feilet");
    err.statusCode = response.status || 502;
    throw err;
  }

  return body;
}

function normalizeAccounts(payload, preferredAccountKey) {
  const accounts = Array.isArray(payload.accounts)
    ? payload.accounts.map((account) => ({
        key: account && typeof account.key === "string" ? account.key : "",
        accountNumber: account && typeof account.accountNumber === "string" ? account.accountNumber : "",
        name: account && typeof account.name === "string" ? account.name : "",
        balance: typeof account.balance === "number" ? account.balance : null,
        availableBalance: typeof account.availableBalance === "number" ? account.availableBalance : null,
        currencyCode: account && typeof account.currencyCode === "string" ? account.currencyCode : "NOK",
        type: account && typeof account.type === "string" ? account.type : ""
      }))
    : [];

  const selectedAccountKey = preferredAccountKey || SB1_DEFAULT_ACCOUNT_KEY || (accounts[0] && accounts[0].key) || "";

  return {
    accounts,
    selectedAccountKey,
    errors: Array.isArray(payload.errors) ? payload.errors : []
  };
}

function normalizeTransactions(payload) {
  const transactions = Array.isArray(payload.transactions)
    ? payload.transactions.map((item) => ({
        id: item && typeof item.id === "string" ? item.id : "",
        date:
          item && (typeof item.accountingDate === "number" || typeof item.accountingDate === "string")
            ? item.accountingDate
            : item && (typeof item.date === "number" || typeof item.date === "string")
              ? item.date
              : item && (typeof item.transactionDate === "number" || typeof item.transactionDate === "string")
                ? item.transactionDate
                : null,
        text:
          item && typeof item.text === "string"
            ? item.text
            : item && typeof item.description === "string"
              ? item.description
              : item && typeof item.transactionText === "string"
                ? item.transactionText
                : "",
        amount: item && typeof item.amount === "number" ? item.amount : null,
        currencyCode: item && typeof item.currencyCode === "string" ? item.currencyCode : "NOK"
      }))
    : [];

  return {
    transactions,
    errors: Array.isArray(payload.errors) ? payload.errors : []
  };
}

async function fetchAccounts(preferredAccountKey) {
  const accessToken = await issueAccessTokenFromRefreshToken();
  const payload = await fetchSb1Json("/personal/banking/accounts", {
    accessToken,
    accept: "application/vnd.sparebank1.v5+json; charset=utf-8",
    queryParams: { includeNokAccounts: "true" }
  });
  return normalizeAccounts(payload, preferredAccountKey);
}

async function fetchTransactions({ accountKey, fromDate, toDate, rowLimit }) {
  const effectiveAccountKey = accountKey || SB1_DEFAULT_ACCOUNT_KEY;
  if (!effectiveAccountKey) {
    const err = new Error("Mangler accountKey");
    err.statusCode = 400;
    throw err;
  }

  const effectiveFromDate = isValidIsoDate(fromDate) ? fromDate : isoDateDaysAgo(30);
  const effectiveToDate = isValidIsoDate(toDate) ? toDate : todayIsoDate();
  const effectiveRowLimit = parseBankRowLimit(rowLimit);

  const accessToken = await issueAccessTokenFromRefreshToken();
  const payload = await fetchSb1Json("/personal/banking/transactions", {
    accessToken,
    accept: "application/vnd.sparebank1.v1+json; charset=utf-8",
    queryParams: {
      accountKey: effectiveAccountKey,
      fromDate: effectiveFromDate,
      toDate: effectiveToDate,
      rowLimit: String(effectiveRowLimit)
    }
  });

  return {
    accountKey: effectiveAccountKey,
    fromDate: effectiveFromDate,
    toDate: effectiveToDate,
    rowLimit: effectiveRowLimit,
    ...normalizeTransactions(payload)
  };
}

module.exports = {
  fetchAccounts,
  fetchTransactions
};
