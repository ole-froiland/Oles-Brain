const express = require("express");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const CSV_KEY = process.env.CSV_KEY || "DIN_KEY";
const RESET_KEY = process.env.RESET_KEY || CSV_KEY;

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

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
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

  db.get("SELECT id FROM entries WHERE date = ? ORDER BY id DESC LIMIT 1", [date], (selectErr, row) => {
    if (selectErr) {
      res.status(500).json({ error: "Kunne ikke lagre" });
      return;
    }

    const respondSaved = (id, statusCode) => {
      res.status(statusCode).json({
        id,
        date,
        dishwasher,
        creatine,
        omega3: omega3Value,
        bed,
        note: noteValue
      });
    };

    const existingId = Number(row && row.id);
    if (Number.isFinite(existingId)) {
      db.run(
        `
          UPDATE entries
          SET dishwasher = ?, creatine = ?, omega3 = ?, bed = ?, note = ?, created_at = datetime('now')
          WHERE id = ?
        `,
        [dishwasher, creatine, omega3Value, bed, noteValue, existingId],
        (updateErr) => {
          if (updateErr) {
            res.status(500).json({ error: "Kunne ikke lagre" });
            return;
          }

          db.run("DELETE FROM entries WHERE date = ? AND id <> ?", [date, existingId], (deleteErr) => {
            if (deleteErr) {
              console.error("Kunne ikke rydde duplikater for dato:", date, deleteErr.message);
            }
            respondSaved(existingId, 200);
          });
        }
      );
      return;
    }

    db.run(
      "INSERT INTO entries (date, dishwasher, creatine, omega3, bed, note) VALUES (?, ?, ?, ?, ?, ?)",
      [date, dishwasher, creatine, omega3Value, bed, noteValue],
      function onInsert(insertErr) {
        if (insertErr) {
          res.status(500).json({ error: "Kunne ikke lagre" });
          return;
        }

        respondSaved(this.lastID, 201);
      }
    );
  });
});

app.get("/entries/today", (req, res) => {
  const date = req.query.date || todayDateString();

  if (!isValidDateString(date)) {
    res.status(400).json({ error: "Ugyldig dato" });
    return;
  }

  db.get(
    `
      SELECT
        dishwasher,
        creatine,
        COALESCE(omega3, 0) AS omega3,
        bed
      FROM entries
      WHERE date = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [date],
    (err, row) => {
      if (err) {
        res.status(500).json({ error: "Kunne ikke hente dagens status" });
        return;
      }

      const status = {
        date,
        dishwasher: row && row.dishwasher === 1 ? 1 : 0,
        creatine: row && row.creatine === 1 ? 1 : 0,
        omega3: row && row.omega3 === 1 ? 1 : 0,
        bed: row && row.bed === 1 ? 1 : 0
      };

      res.status(200).json({
        ...status,
        all_done:
          status.dishwasher === 1 &&
          status.creatine === 1 &&
          status.omega3 === 1 &&
          status.bed === 1
      });
    }
  );
});

app.post("/entries/reset", (req, res) => {
  const key = req.query.key;

  if (key !== RESET_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  db.run("DELETE FROM entries", function onDelete(err) {
    if (err) {
      res.status(500).json({ error: "Kunne ikke nullstille" });
      return;
    }

    res.status(200).json({ ok: true, deleted: this.changes || 0 });
  });
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
    `
      SELECT
        e.date AS date,
        e.dishwasher AS dishwasher,
        e.creatine AS creatine,
        COALESCE(e.omega3, 0) AS omega3,
        e.bed AS bed,
        COALESCE(e.note, '') AS note
      FROM entries e
      INNER JOIN (
        SELECT date, MAX(id) AS latest_id
        FROM entries
        GROUP BY date
      ) latest ON latest.latest_id = e.id
      ORDER BY e.date ASC
    `,
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
