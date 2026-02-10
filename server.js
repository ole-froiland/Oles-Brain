const express = require("express");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const CSV_KEY = process.env.CSV_KEY || "DIN_KEY";

const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "entries.db");
fs.mkdirSync(dataDir, { recursive: true });

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      dishwasher INTEGER NOT NULL CHECK (dishwasher IN (0, 1)),
      creatine INTEGER NOT NULL CHECK (creatine IN (0, 1)),
      omega3 INTEGER NOT NULL CHECK (omega3 IN (0, 1)),
      bed INTEGER NOT NULL CHECK (bed IN (0, 1)),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Backfill for existing DB files that were created before "note" existed.
  db.run("ALTER TABLE entries ADD COLUMN note TEXT", (err) => {
    if (err && !/duplicate column name: note/.test(err.message)) {
      console.error("Kunne ikke migrere entries.note:", err.message);
    }
  });

  db.run("ALTER TABLE entries ADD COLUMN omega3 INTEGER NOT NULL DEFAULT 0", (err) => {
    if (err && !/duplicate column name: omega3/.test(err.message)) {
      console.error("Kunne ikke migrere entries.omega3:", err.message);
    }
  });
});

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

function isValidNote(value) {
  return value === undefined || value === null || typeof value === "string";
}

function escapeCsvValue(value) {
  const stringValue = value === undefined || value === null ? "" : String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }

  return stringValue;
}

app.post("/entries", (req, res) => {
  const { date, dishwasher, creatine, omega3, bed, note } = req.body || {};
  const omega3Value = omega3 === undefined ? 0 : omega3;

  if (
    !isValidDateString(date) ||
    !isZeroOrOne(dishwasher) ||
    !isZeroOrOne(creatine) ||
    !isZeroOrOne(omega3Value) ||
    !isZeroOrOne(bed) ||
    !isValidNote(note)
  ) {
    res.status(400).json({ error: "Ugyldig payload" });
    return;
  }

  const noteValue = typeof note === "string" && note.trim() !== "" ? note : null;

  db.run(
    "INSERT INTO entries (date, dishwasher, creatine, omega3, bed, note) VALUES (?, ?, ?, ?, ?, ?)",
    [date, dishwasher, creatine, omega3Value, bed, noteValue],
    function onInsert(err) {
      if (err) {
        res.status(500).json({ error: "Kunne ikke lagre" });
        return;
      }

      res.status(201).json({
        id: this.lastID,
        date,
        dishwasher,
        creatine,
        omega3: omega3Value,
        bed,
        note: noteValue
      });
    }
  );
});

app.get("/entries.csv", (req, res) => {
  const key = req.query.key;

  if (key !== CSV_KEY) {
    res.status(401).type("text/plain; charset=utf-8").send("Unauthorized");
    return;
  }

  // Avoid stale results through intermediate caches (Sheets/tunnel/CDN).
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Surrogate-Control", "no-store");

  db.all(
    "SELECT id, date, dishwasher, creatine, COALESCE(omega3, 0) AS omega3, bed, COALESCE(note, '') AS note FROM entries ORDER BY date ASC, id ASC",
    (err, rows) => {
      if (err) {
        res.status(500).type("text/plain; charset=utf-8").send("Kunne ikke hente CSV");
        return;
      }

      const lines = [
        "Dato,Oppvaskmaskin tømt,Kreatin tatt,Omega-3 tatt,Seng redd,Kommentar",
        ...rows.map((row) =>
          [
            escapeCsvValue(row.date),
            escapeCsvValue(row.dishwasher),
            escapeCsvValue(row.creatine),
            escapeCsvValue(row.omega3),
            escapeCsvValue(row.bed),
            escapeCsvValue(row.note)
          ].join(",")
        )
      ];

      const csv = `\uFEFF${lines.join("\r\n")}`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="entries.csv"');
      res.status(200).send(csv);
    }
  );
});

const server = app.listen(PORT, () => {
  console.log(`Server kjører på http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} er opptatt. Stopp annen server som bruker porten og start på nytt.`);
    process.exit(1);
  }

  console.error("Serverfeil:", err);
  process.exit(1);
});
