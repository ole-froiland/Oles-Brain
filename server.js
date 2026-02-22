const express = require("express");
const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const CSV_KEY = process.env.CSV_KEY || "DIN_KEY";
const RESET_KEY = process.env.RESET_KEY || CSV_KEY;
const SCREEN_TIME_KEY = process.env.SCREEN_TIME_KEY || CSV_KEY;
const OPENAI_API_KEY = typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
const OPENAI_NOTE_MODEL = process.env.OPENAI_NOTE_MODEL || "gpt-4.1-mini";

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
      multivitamin INTEGER NOT NULL CHECK (multivitamin IN (0, 1)),
      water INTEGER NOT NULL CHECK (water IN (0, 1)),
      workout INTEGER NOT NULL CHECK (workout IN (0, 1)),
      bed INTEGER NOT NULL CHECK (bed IN (0, 1)),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS screen_time_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      total_minutes INTEGER NOT NULL CHECK (total_minutes >= 0),
      pickups INTEGER CHECK (pickups >= 0),
      source TEXT,
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

  db.run("ALTER TABLE entries ADD COLUMN multivitamin INTEGER NOT NULL DEFAULT 0", (err) => {
    if (err && !/duplicate column name: multivitamin/.test(err.message)) {
      console.error("Kunne ikke migrere entries.multivitamin:", err.message);
    }
  });

  db.run("ALTER TABLE entries ADD COLUMN water INTEGER NOT NULL DEFAULT 0", (err) => {
    if (err && !/duplicate column name: water/.test(err.message)) {
      console.error("Kunne ikke migrere entries.water:", err.message);
    }
  });

  db.run("ALTER TABLE entries ADD COLUMN workout INTEGER NOT NULL DEFAULT 0", (err) => {
    if (err && !/duplicate column name: workout/.test(err.message)) {
      console.error("Kunne ikke migrere entries.workout:", err.message);
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

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isValidSource(value) {
  return value === undefined || value === null || (typeof value === "string" && value.length <= 120);
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

function allDoneForDate(status, date) {
  const baseDone =
    status.dishwasher === 1 &&
    status.creatine === 1 &&
    status.omega3 === 1 &&
    status.multivitamin === 1 &&
    status.water === 1 &&
    status.bed === 1;

  if (!baseDone) {
    return false;
  }

  return workoutRequiredForDate(date) ? status.workout === 1 : true;
}

function normalizeScreenTimePayload(payload) {
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

function screenTimeKeyFromRequest(req) {
  const queryKey = req.query && req.query.key;
  const headerKey = req.get("x-screen-time-key");

  if (typeof queryKey === "string" && queryKey.trim() !== "") {
    return queryKey.trim();
  }

  if (typeof headerKey === "string" && headerKey.trim() !== "") {
    return headerKey.trim();
  }

  return "";
}

function escapeCsvValue(value) {
  const stringValue = value === undefined || value === null ? "" : String(value);

  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, "\"\"")}"`;
  }

  return stringValue;
}

function normalizeSingleLine(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenNoteHeuristic(inputText) {
  let text = normalizeSingleLine(inputText);
  if (!text) {
    return "";
  }

  const removablePhrases = [
    /\bom du skjønner\b/gi,
    /\bhvis du skjønner\b/gi,
    /\bpå en måte\b/gi,
    /\bfor å si det sånn\b/gi,
    /\bhva skal jeg si\b/gi
  ];

  removablePhrases.forEach((pattern) => {
    text = text.replace(pattern, " ");
  });

  text = text.replace(/\b(eh|ehh|ehm|mmm|liksom|lissom|altså|asså|typ|sånn)\b/gi, " ");
  text = text.replace(/\s+/g, " ").trim();

  const words = text.split(" ").filter(Boolean);
  const dedupedWords = [];
  let previousKey = "";
  words.forEach((word) => {
    const key = word.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (key && key === previousKey) {
      return;
    }
    dedupedWords.push(word);
    if (key) {
      previousKey = key;
    }
  });

  text = dedupedWords.join(" ").trim();

  const compactWords = text.split(" ").filter(Boolean);
  const MAX_WORDS = 14;
  if (compactWords.length > MAX_WORDS) {
    text = compactWords.slice(0, MAX_WORDS).join(" ");
  }

  text = text
    .replace(/^[•*-]\s*/, "")
    .replace(/[;:,.\-–\s]+$/g, "")
    .trim();

  if (!text) {
    return "";
  }

  return text[0].toUpperCase() + text.slice(1);
}

function extractResponseOutputText(data) {
  if (data && typeof data.output_text === "string" && data.output_text.trim() !== "") {
    return data.output_text.trim();
  }

  if (!data || !Array.isArray(data.output)) {
    return "";
  }

  const pieces = [];
  data.output.forEach((item) => {
    if (!item || !Array.isArray(item.content)) {
      return;
    }

    item.content.forEach((contentItem) => {
      if (contentItem && typeof contentItem.text === "string") {
        pieces.push(contentItem.text);
      } else if (contentItem && typeof contentItem.output_text === "string") {
        pieces.push(contentItem.output_text);
      }
    });
  });

  return pieces.join(" ").trim();
}

async function shortenNoteWithOpenAI(rawText) {
  if (!OPENAI_API_KEY || typeof fetch !== "function") {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: OPENAI_NOTE_MODEL,
      instructions:
        "Skriv om brukerens tale/notat til ett kort punkt på norsk bokmål. Fjern fyllord og gjentakelser, behold konkrete fakta (hvem/hva/når/tall). Returner bare selve teksten.",
      input: rawText,
      max_output_tokens: 60,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI svarte ${response.status}`);
  }

  const data = await response.json();
  const outputText = extractResponseOutputText(data);
  return outputText || null;
}

app.post("/notes/shorten", async (req, res) => {
  const { text } = req.body || {};
  if (typeof text !== "string") {
    res.status(400).json({ error: "Ugyldig payload" });
    return;
  }

  const inputText = normalizeSingleLine(text);
  if (!inputText) {
    res.status(200).json({ short_text: "" });
    return;
  }

  let shortText = shortenNoteHeuristic(inputText);
  if (OPENAI_API_KEY) {
    try {
      const aiText = await shortenNoteWithOpenAI(inputText);
      if (aiText) {
        shortText = shortenNoteHeuristic(aiText) || shortText;
      }
    } catch (err) {
      console.error("Kunne ikke forkorte notat med AI:", err && err.message ? err.message : err);
    }
  }

  res.status(200).json({ short_text: shortText });
});

app.post("/entries", (req, res) => {
  const { date, dishwasher, creatine, omega3, multivitamin, water, workout, bed, note } = req.body || {};
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
        multivitamin: multivitaminValue,
        water: waterValue,
        workout: workoutValue,
        bed,
        note: noteValue
      });
    };

    const existingId = Number(row && row.id);
    if (Number.isFinite(existingId)) {
      db.run(
        `
          UPDATE entries
          SET dishwasher = ?, creatine = ?, omega3 = ?, multivitamin = ?, water = ?, workout = ?, bed = ?, note = ?, created_at = datetime('now')
          WHERE id = ?
        `,
        [dishwasher, creatine, omega3Value, multivitaminValue, waterValue, workoutValue, bed, noteValue, existingId],
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
      "INSERT INTO entries (date, dishwasher, creatine, omega3, multivitamin, water, workout, bed, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [date, dishwasher, creatine, omega3Value, multivitaminValue, waterValue, workoutValue, bed, noteValue],
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
        COALESCE(multivitamin, 0) AS multivitamin,
        COALESCE(water, 0) AS water,
        COALESCE(workout, 0) AS workout,
        bed,
        COALESCE(note, '') AS note
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
        multivitamin: row && row.multivitamin === 1 ? 1 : 0,
        water: row && row.water === 1 ? 1 : 0,
        workout: row && row.workout === 1 ? 1 : 0,
        bed: row && row.bed === 1 ? 1 : 0,
        note: row && typeof row.note === "string" ? row.note : ""
      };

      res.status(200).json({
        ...status,
        all_done: allDoneForDate(status, date)
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

app.post("/screen-time", (req, res) => {
  const key = screenTimeKeyFromRequest(req);
  if (key !== SCREEN_TIME_KEY) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const normalized = normalizeScreenTimePayload(req.body);
  if (normalized.error) {
    res.status(400).json({ error: normalized.error });
    return;
  }

  const { date, totalMinutes, pickups, source } = normalized.value;

  db.get("SELECT id FROM screen_time_entries WHERE date = ? ORDER BY id DESC LIMIT 1", [date], (selectErr, row) => {
    if (selectErr) {
      res.status(500).json({ error: "Kunne ikke lagre skjermtid" });
      return;
    }

    const respondSaved = (id, statusCode) => {
      res.status(statusCode).json({
        id,
        date,
        total_minutes: totalMinutes,
        pickups,
        source
      });
    };

    const existingId = Number(row && row.id);
    if (Number.isFinite(existingId)) {
      db.run(
        `
          UPDATE screen_time_entries
          SET total_minutes = ?, pickups = ?, source = ?, created_at = datetime('now')
          WHERE id = ?
        `,
        [totalMinutes, pickups, source, existingId],
        (updateErr) => {
          if (updateErr) {
            res.status(500).json({ error: "Kunne ikke lagre skjermtid" });
            return;
          }

          db.run("DELETE FROM screen_time_entries WHERE date = ? AND id <> ?", [date, existingId], (deleteErr) => {
            if (deleteErr) {
              console.error("Kunne ikke rydde skjermtid-duplikater for dato:", date, deleteErr.message);
            }

            respondSaved(existingId, 200);
          });
        }
      );
      return;
    }

    db.run(
      "INSERT INTO screen_time_entries (date, total_minutes, pickups, source) VALUES (?, ?, ?, ?)",
      [date, totalMinutes, pickups, source],
      function onInsert(insertErr) {
        if (insertErr) {
          res.status(500).json({ error: "Kunne ikke lagre skjermtid" });
          return;
        }

        respondSaved(this.lastID, 201);
      }
    );
  });
});

app.get("/screen-time/today", (req, res) => {
  const date = req.query.date || todayDateString();

  if (!isValidDateString(date)) {
    res.status(400).json({ error: "Ugyldig dato" });
    return;
  }

  db.get(
    `
      SELECT
        total_minutes,
        pickups,
        COALESCE(source, '') AS source,
        created_at
      FROM screen_time_entries
      WHERE date = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [date],
    (err, row) => {
      if (err) {
        res.status(500).json({ error: "Kunne ikke hente skjermtid" });
        return;
      }

      res.status(200).json({
        date,
        total_minutes: row ? Number(row.total_minutes) : null,
        pickups: row && row.pickups !== null && row.pickups !== undefined ? Number(row.pickups) : null,
        source: row && typeof row.source === "string" ? row.source : "",
        created_at: row && typeof row.created_at === "string" ? row.created_at : null,
        has_data: Boolean(row)
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
    `
      SELECT
        e.date AS date,
        e.dishwasher AS dishwasher,
        e.creatine AS creatine,
        COALESCE(e.omega3, 0) AS omega3,
        COALESCE(e.multivitamin, 0) AS multivitamin,
        COALESCE(e.water, 0) AS water,
        COALESCE(e.workout, 0) AS workout,
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
        "Dato,Oppvaskmaskin tømt,Kreatin tatt,Omega-3 tatt,Multivitamin tatt,2L vann drukket,Trening gjennomført,Seng redd,Kommentar",
        ...rows.map((row) =>
          [
            escapeCsvValue(row.date),
            escapeCsvValue(row.dishwasher),
            escapeCsvValue(row.creatine),
            escapeCsvValue(row.omega3),
            escapeCsvValue(row.multivitamin),
            escapeCsvValue(row.water),
            escapeCsvValue(row.workout),
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

app.get("/notes.csv", (req, res) => {
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
        COALESCE(e.note, '') AS note
      FROM entries e
      INNER JOIN (
        SELECT date, MAX(id) AS latest_id
        FROM entries
        GROUP BY date
      ) latest ON latest.latest_id = e.id
      WHERE TRIM(COALESCE(e.note, '')) <> ''
      ORDER BY e.date ASC
    `,
    (err, rows) => {
      if (err) {
        res.status(500).type("text/plain; charset=utf-8").send("Kunne ikke hente notat-CSV");
        return;
      }

      const lines = [
        "Dato,Notat",
        ...rows.map((row) => [escapeCsvValue(row.date), escapeCsvValue(row.note)].join(","))
      ];

      const csv = `\uFEFF${lines.join("\r\n")}`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'inline; filename="notes.csv"');
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
