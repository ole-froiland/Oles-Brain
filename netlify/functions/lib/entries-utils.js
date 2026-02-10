const CSV_HEADER = "Dato,Oppvaskmaskin tømt,Kreatin tatt,Omega-3 tatt,Seng redd,Kommentar";

function isValidDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isZeroOrOne(value) {
  return value === 0 || value === 1;
}

function normalizePayload(payload) {
  const { date, dishwasher, creatine, omega3, bed, note } = payload || {};
  const omega3Value = omega3 === undefined ? 0 : omega3;

  if (
    !isValidDateString(date) ||
    !isZeroOrOne(dishwasher) ||
    !isZeroOrOne(creatine) ||
    !isZeroOrOne(omega3Value) ||
    !isZeroOrOne(bed)
  ) {
    return { error: "Ugyldig payload" };
  }

  if (note !== undefined && note !== null && typeof note !== "string") {
    return { error: "Ugyldig payload" };
  }

  return {
    value: {
      date,
      dishwasher,
      creatine,
      omega3: omega3Value,
      bed,
      note: typeof note === "string" ? note : ""
    }
  };
}

function getNextId(entries) {
  if (entries.length === 0) {
    return 1;
  }

  const maxId = entries.reduce((acc, entry) => {
    const current = Number(entry.id);
    return Number.isFinite(current) && current > acc ? current : acc;
  }, 0);

  return maxId + 1;
}

function formatCreatedAt(date = new Date()) {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function escapeCsvValue(value) {
  const stringValue = value === undefined || value === null ? "" : String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }

  return stringValue;
}

function toCsv(entries) {
  const sorted = [...entries].sort((a, b) => {
    if (a.date !== b.date) {
      return String(a.date).localeCompare(String(b.date));
    }

    return Number(a.id) - Number(b.id);
  });

  const lines = [
    CSV_HEADER,
    ...sorted.map((entry) =>
      [
        escapeCsvValue(entry.date),
        escapeCsvValue(entry.dishwasher),
        escapeCsvValue(entry.creatine),
        escapeCsvValue(entry.omega3 ?? 0),
        escapeCsvValue(entry.bed),
        escapeCsvValue(entry.note)
      ].join(",")
    )
  ];

  return `\uFEFF${lines.join("\r\n")}`;
}

module.exports = {
  formatCreatedAt,
  getNextId,
  normalizePayload,
  toCsv
};
