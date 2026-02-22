const fs = require("fs/promises");
const path = require("path");
const { connectLambda, getStore } = require("@netlify/blobs");

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
const STORE_NAME = "oles-brain";
const SB1_STATE_KEY = "sb1-oauth-state";
const localStatePath = path.join(process.cwd(), "data", "netlify-sb1-state.json");

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

function hasBlobsContext(event) {
  try {
    connectLambda(event);
  } catch (_) {}

  return Boolean(process.env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext);
}

function getBlobStore(event) {
  try {
    connectLambda(event);
  } catch (_) {}

  return getStore(STORE_NAME);
}

async function readOAuthStateFromFile() {
  try {
    const raw = await fs.readFile(localStatePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return {};
    }

    throw err;
  }
}

async function writeOAuthStateToFile(value) {
  await fs.mkdir(path.dirname(localStatePath), { recursive: true });
  await fs.writeFile(localStatePath, JSON.stringify(value, null, 2));
}

async function readOAuthState(event) {
  if (hasBlobsContext(event)) {
    const store = getBlobStore(event);
    const value = await store.get(SB1_STATE_KEY, { type: "json" });
    return value && typeof value === "object" ? value : {};
  }

  return readOAuthStateFromFile();
}

async function writeOAuthState(event, value) {
  if (hasBlobsContext(event)) {
    const store = getBlobStore(event);
    await store.setJSON(SB1_STATE_KEY, value);
    return;
  }

  if (process.env.NETLIFY === "true") {
    // In production Netlify, Blobs should be used. Failing silently here avoids user-facing outage.
    return;
  }

  await writeOAuthStateToFile(value);
}

function uniqueNonEmpty(values) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

async function issueAccessTokenFromRefreshToken(event) {
  ensureConfig();

  let storedState = {};
  try {
    storedState = await readOAuthState(event);
  } catch (err) {
    console.error("Kunne ikke lese SB1 OAuth-state:", err && err.message ? err.message : err);
  }

  const storedRefreshToken =
    storedState && typeof storedState.refresh_token === "string" ? storedState.refresh_token.trim() : "";
  const candidateRefreshTokens = uniqueNonEmpty([storedRefreshToken, SB1_REFRESH_TOKEN]);

  let lastErr = null;
  for (const refreshTokenCandidate of candidateRefreshTokens) {
    const response = await fetch(`${SB1_API_BASE}/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        client_id: SB1_CLIENT_ID,
        client_secret: SB1_CLIENT_SECRET,
        refresh_token: refreshTokenCandidate,
        grant_type: "refresh_token"
      })
    });

    const body = await response.json().catch(() => ({}));
    const accessToken = typeof body.access_token === "string" ? body.access_token : "";
    if (!response.ok || !accessToken) {
      lastErr = new Error(body.error_description || body.error || "Kunne ikke hente SB1-token");
      lastErr.statusCode = response.status || 502;
      continue;
    }

    const rotatedRefreshToken =
      typeof body.refresh_token === "string" && body.refresh_token.trim() !== ""
        ? body.refresh_token.trim()
        : refreshTokenCandidate;
    if (rotatedRefreshToken !== storedRefreshToken) {
      try {
        await writeOAuthState(event, {
          refresh_token: rotatedRefreshToken,
          updated_at: new Date().toISOString()
        });
      } catch (err) {
        console.error("Kunne ikke lagre rotert SB1 refresh-token:", err && err.message ? err.message : err);
      }
    }

    return accessToken;
  }

  if (lastErr) {
    throw lastErr;
  }

  const err = new Error("Kunne ikke hente SB1-token");
  err.statusCode = 502;
  throw err;
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

async function fetchAccounts(event, preferredAccountKey) {
  const accessToken = await issueAccessTokenFromRefreshToken(event);
  const payload = await fetchSb1Json("/personal/banking/accounts", {
    accessToken,
    accept: "application/vnd.sparebank1.v5+json; charset=utf-8",
    queryParams: { includeNokAccounts: "true" }
  });
  return normalizeAccounts(payload, preferredAccountKey);
}

async function fetchTransactions(event, { accountKey, fromDate, toDate, rowLimit }) {
  const effectiveAccountKey = accountKey || SB1_DEFAULT_ACCOUNT_KEY;
  if (!effectiveAccountKey) {
    const err = new Error("Mangler accountKey");
    err.statusCode = 400;
    throw err;
  }

  const effectiveFromDate = isValidIsoDate(fromDate) ? fromDate : isoDateDaysAgo(30);
  const effectiveToDate = isValidIsoDate(toDate) ? toDate : todayIsoDate();
  const effectiveRowLimit = parseBankRowLimit(rowLimit);

  const accessToken = await issueAccessTokenFromRefreshToken(event);
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
  issueAccessTokenFromRefreshToken,
  fetchAccounts,
  fetchTransactions
};
