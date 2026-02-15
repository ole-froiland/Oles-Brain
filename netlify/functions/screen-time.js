const { readScreenTimeEntries, writeScreenTimeEntries } = require("./lib/screen-time-store");
const { formatCreatedAt, getNextId, keyFromEvent, normalizePayload } = require("./lib/screen-time-utils");

const SCREEN_TIME_KEY = process.env.SCREEN_TIME_KEY || process.env.CSV_KEY || "DIN_KEY";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

function numericIdOrFallback(entry, fallback) {
  const id = Number(entry && entry.id);
  return Number.isFinite(id) ? id : fallback;
}

function findLatestIndexByDate(entries, date) {
  let latestIndex = -1;
  let latestKey = Number.NEGATIVE_INFINITY;

  entries.forEach((entry, index) => {
    if (!entry || entry.date !== date) {
      return;
    }

    const key = numericIdOrFallback(entry, index);
    if (latestIndex === -1 || key > latestKey) {
      latestIndex = index;
      latestKey = key;
    }
  });

  return latestIndex;
}

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

  const key = keyFromEvent(event);
  if (key !== SCREEN_TIME_KEY) {
    return json(401, { error: "Unauthorized" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return json(400, { error: "Ugyldig payload" });
  }

  const normalized = normalizePayload(payload);
  if (normalized.error) {
    return json(400, { error: normalized.error });
  }

  try {
    const entries = await readScreenTimeEntries(event);
    const createdAt = formatCreatedAt();
    const date = normalized.value.date;
    const latestIndex = findLatestIndexByDate(entries, date);
    const isUpdate = latestIndex >= 0;
    const existing = isUpdate ? entries[latestIndex] : null;
    const nextId = isUpdate ? numericIdOrFallback(existing, getNextId(entries)) : getNextId(entries);

    const entry = {
      id: nextId,
      date,
      total_minutes: normalized.value.totalMinutes,
      pickups: normalized.value.pickups,
      source: normalized.value.source,
      created_at: createdAt
    };

    if (isUpdate) {
      entries[latestIndex] = entry;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (index !== latestIndex && entries[index] && entries[index].date === date) {
          entries.splice(index, 1);
        }
      }
    } else {
      entries.push(entry);
    }

    await writeScreenTimeEntries(event, entries);

    return json(isUpdate ? 200 : 201, {
      id: entry.id,
      date: entry.date,
      total_minutes: entry.total_minutes,
      pickups: entry.pickups,
      source: entry.source
    });
  } catch (err) {
    console.error("Kunne ikke lagre skjermtid:", err);
    return json(500, { error: "Kunne ikke lagre skjermtid" });
  }
};
