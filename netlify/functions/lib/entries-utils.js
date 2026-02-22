const CSV_HEADER =
  "Dato,Oppvaskmaskin tømt,Kreatin tatt,Omega-3 tatt,Multivitamin tatt,2L vann drukket,Trening gjennomført,Seng redd,Kommentar";
const NOTES_CSV_HEADER = "Dato,Notat";

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

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function workoutRequiredForDate(date) {
  if (!isValidDateString(date)) {
    return false;
  }

  // Saturday (6) is the rest day.
  return new Date(`${date}T00:00:00Z`).getUTCDay() !== 6;
}

function normalizePayload(payload) {
  const { date, dishwasher, creatine, omega3, multivitamin, water, workout, bed, note } = payload || {};
  const omega3Value = omega3 === undefined ? 0 : omega3;
  const multivitaminValue = multivitamin === undefined ? 0 : multivitamin;
  const waterValue = water === undefined ? 0 : water;
  const workoutValue = workout === undefined ? 0 : workout;

  if (
    !isValidDateString(date) ||
    !isZeroOrOne(dishwasher) ||
    !isZeroOrOne(creatine) ||
    !isZeroOrOne(omega3Value) ||
    !isZeroOrOne(multivitaminValue) ||
    !isZeroOrOne(waterValue) ||
    !isZeroOrOne(workoutValue) ||
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
      multivitamin: multivitaminValue,
      water: waterValue,
      workout: workoutValue,
      bed,
      note: typeof note === "string" ? note : ""
    }
  };
}

function numericIdOrFallback(entry, fallback) {
  const id = Number(entry && entry.id);
  return Number.isFinite(id) ? id : fallback;
}

function latestEntryForDate(entries, date) {
  let latest = null;
  let latestKey = Number.NEGATIVE_INFINITY;

  entries.forEach((entry, index) => {
    if (!entry || entry.date !== date) {
      return;
    }

    const key = numericIdOrFallback(entry, index);
    if (!latest || key > latestKey) {
      latest = entry;
      latestKey = key;
    }
  });

  return latest;
}

function latestEntriesByDate(entries) {
  const byDate = new Map();

  entries.forEach((entry, index) => {
    if (!entry || !isValidDateString(entry.date)) {
      return;
    }

    const key = numericIdOrFallback(entry, index);
    const current = byDate.get(entry.date);
    if (!current || key > current.key) {
      byDate.set(entry.date, { entry, key });
    }
  });

  return Array.from(byDate.values()).map((item) => item.entry);
}

function dailyStatus(entries, date = todayDateString()) {
  const latest = latestEntryForDate(entries, date);

  const status = {
    dishwasher: latest && latest.dishwasher === 1 ? 1 : 0,
    creatine: latest && latest.creatine === 1 ? 1 : 0,
    omega3: latest && (latest.omega3 ?? 0) === 1 ? 1 : 0,
    multivitamin: latest && (latest.multivitamin ?? 0) === 1 ? 1 : 0,
    water: latest && (latest.water ?? 0) === 1 ? 1 : 0,
    workout: latest && (latest.workout ?? 0) === 1 ? 1 : 0,
    bed: latest && latest.bed === 1 ? 1 : 0,
    note: latest && typeof latest.note === "string" ? latest.note : ""
  };

  const baseDone =
    status.dishwasher === 1 &&
    status.creatine === 1 &&
    status.omega3 === 1 &&
    status.multivitamin === 1 &&
    status.water === 1 &&
    status.bed === 1;

  return {
    date,
    ...status,
    all_done: baseDone && (workoutRequiredForDate(date) ? status.workout === 1 : true)
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
  const sorted = latestEntriesByDate(entries).sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const lines = [
    CSV_HEADER,
    ...sorted.map((entry) =>
      [
        escapeCsvValue(entry.date),
        escapeCsvValue(entry.dishwasher),
        escapeCsvValue(entry.creatine),
        escapeCsvValue(entry.omega3 ?? 0),
        escapeCsvValue(entry.multivitamin ?? 0),
        escapeCsvValue(entry.water ?? 0),
        escapeCsvValue(entry.workout ?? 0),
        escapeCsvValue(entry.bed),
        escapeCsvValue(entry.note)
      ].join(",")
    )
  ];

  return `\uFEFF${lines.join("\r\n")}`;
}

function toNotesCsv(entries) {
  const sorted = latestEntriesByDate(entries).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const rows = sorted.filter((entry) => typeof entry.note === "string" && entry.note.trim() !== "");

  const lines = [
    NOTES_CSV_HEADER,
    ...rows.map((entry) => [escapeCsvValue(entry.date), escapeCsvValue(entry.note)].join(","))
  ];

  return `\uFEFF${lines.join("\r\n")}`;
}

module.exports = {
  dailyStatus,
  formatCreatedAt,
  getNextId,
  isValidDateString,
  normalizePayload,
  todayDateString,
  toCsv,
  toNotesCsv
};
