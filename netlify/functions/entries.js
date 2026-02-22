const { readEntries, writeEntries } = require("./lib/entries-store");
const { formatCreatedAt, getNextId, normalizePayload } = require("./lib/entries-utils");

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
    const entries = await readEntries(event);
    const createdAt = formatCreatedAt();
    const date = normalized.value.date;
    const latestIndex = findLatestIndexByDate(entries, date);
    const isUpdate = latestIndex >= 0;
    const existing = isUpdate ? entries[latestIndex] : null;
    const nextId = isUpdate ? numericIdOrFallback(existing, getNextId(entries)) : getNextId(entries);

    const entry = {
      id: nextId,
      date,
      dishwasher: normalized.value.dishwasher,
      creatine: normalized.value.creatine,
      omega3: normalized.value.omega3,
      multivitamin: normalized.value.multivitamin,
      water: normalized.value.water,
      workout: normalized.value.workout,
      bed: normalized.value.bed,
      note: normalized.value.note,
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

    await writeEntries(event, entries);

    return json(isUpdate ? 200 : 201, {
      id: entry.id,
      date: entry.date,
      dishwasher: entry.dishwasher,
      creatine: entry.creatine,
      omega3: entry.omega3,
      multivitamin: entry.multivitamin,
      water: entry.water,
      workout: entry.workout,
      bed: entry.bed,
      note: entry.note || null
    });
  } catch (err) {
    console.error("Kunne ikke lagre entry:", err);
    return json(500, { error: "Kunne ikke lagre" });
  }
};
