const { isValidDateString, todayDateString } = require("./entries-utils");

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidSource(value) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= 120);
}

function normalizePayload(payload) {
  const { date, total_minutes: totalMinutesRaw, pickups: pickupsRaw, source } = payload || {};
  const dateValue = date === undefined || date === null || date === "" ? todayDateString() : date;

  if (!isValidDateString(dateValue) || !isNonNegativeInteger(totalMinutesRaw) || !isValidSource(source)) {
    return { error: "Ugyldig payload" };
  }

  let pickupsValue = null;
  if (pickupsRaw !== undefined && pickupsRaw !== null && pickupsRaw !== "") {
    if (!isNonNegativeInteger(pickupsRaw)) {
      return { error: "Ugyldig payload" };
    }
    pickupsValue = pickupsRaw;
  }

  return {
    value: {
      date: dateValue,
      totalMinutes: totalMinutesRaw,
      pickups: pickupsValue,
      source: typeof source === "string" && source.trim() !== "" ? source.trim() : null
    }
  };
}

function dailyStatus(entries, date = todayDateString()) {
  let latest = null;
  let latestKey = Number.NEGATIVE_INFINITY;

  entries.forEach((entry, index) => {
    if (!entry || entry.date !== date) {
      return;
    }

    const entryId = Number(entry.id);
    const key = Number.isFinite(entryId) ? entryId : index;
    if (latest === null || key > latestKey) {
      latest = entry;
      latestKey = key;
    }
  });

  return {
    date,
    total_minutes: latest ? Number(latest.total_minutes) : null,
    pickups:
      latest && latest.pickups !== null && latest.pickups !== undefined ? Number(latest.pickups) : null,
    source: latest && typeof latest.source === "string" ? latest.source : "",
    created_at: latest && typeof latest.created_at === "string" ? latest.created_at : null,
    has_data: Boolean(latest)
  };
}

function getNextId(entries) {
  if (entries.length === 0) {
    return 1;
  }

  const maxId = entries.reduce((acc, entry) => {
    const current = Number(entry && entry.id);
    return Number.isFinite(current) && current > acc ? current : acc;
  }, 0);

  return maxId + 1;
}

function formatCreatedAt(date = new Date()) {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function keyFromEvent(event) {
  const queryKey = event.queryStringParameters && event.queryStringParameters.key;
  const headerKey =
    (event.headers && (event.headers["x-screen-time-key"] || event.headers["X-Screen-Time-Key"])) || "";

  if (typeof queryKey === "string" && queryKey.trim() !== "") {
    return queryKey.trim();
  }

  if (typeof headerKey === "string" && headerKey.trim() !== "") {
    return headerKey.trim();
  }

  return "";
}

module.exports = {
  dailyStatus,
  formatCreatedAt,
  getNextId,
  keyFromEvent,
  normalizePayload
};
