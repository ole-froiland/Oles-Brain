const { readEntries, writeEntries } = require("./lib/entries-store");
const { formatCreatedAt, getNextId, normalizePayload } = require("./lib/entries-utils");

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
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
    const id = getNextId(entries);
    const createdAt = formatCreatedAt();
    const entry = {
      id,
      date: normalized.value.date,
      dishwasher: normalized.value.dishwasher,
      creatine: normalized.value.creatine,
      bed: normalized.value.bed,
      note: normalized.value.note,
      created_at: createdAt
    };

    entries.push(entry);
    await writeEntries(event, entries);

    return json(201, {
      id: entry.id,
      date: entry.date,
      dishwasher: entry.dishwasher,
      creatine: entry.creatine,
      bed: entry.bed,
      note: entry.note || null
    });
  } catch (err) {
    console.error("Kunne ikke lagre entry:", err);
    return json(500, { error: "Kunne ikke lagre" });
  }
};
