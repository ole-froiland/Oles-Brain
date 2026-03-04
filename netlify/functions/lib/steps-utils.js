const { isValidDateString, todayDateString } = require("./entries-utils");

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidSource(value) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= 120);
}

function normalizePayload(payload) {
  const { date, total_steps: totalStepsRaw, source } = payload || {};
  const dateValue = date === undefined || date === null || date === "" ? todayDateString() : date;

  if (!isValidDateString(dateValue) || !isNonNegativeInteger(totalStepsRaw) || !isValidSource(source)) {
    return { error: "Ugyldig payload" };
  }

  return {
    value: {
      date: dateValue,
      totalSteps: totalStepsRaw,
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
    total_steps: latest ? Number(latest.total_steps) : null,
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
  const headerKey = (event.headers && (event.headers["x-steps-key"] || event.headers["X-Steps-Key"])) || "";

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
