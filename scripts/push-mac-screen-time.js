#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const sqlite3 = require("sqlite3").verbose();

const APPLE_EPOCH_SECONDS = 978307200;
const DEFAULT_APP_STREAMS = ["/app/usage"];
const EXTENDED_APP_STREAMS = ["/app/usage", "/app/webUsage", "/app/mediaUsage"];

function parseStreamNames(value, fallbackStreams = DEFAULT_APP_STREAMS) {
  const fallback = Array.isArray(fallbackStreams) && fallbackStreams.length
    ? fallbackStreams
    : DEFAULT_APP_STREAMS;
  const raw = String(value || "").trim();

  const streams = (raw ? raw.split(",") : fallback)
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("/") ? item : `/${item}`));

  const unique = Array.from(new Set(streams));
  return unique.length ? unique : fallback.slice();
}

function streamSqlParts(streamNames) {
  const normalized = parseStreamNames(streamNames, DEFAULT_APP_STREAMS);
  return {
    normalized,
    placeholders: normalized.map(() => "?").join(", ")
  };
}

function parseBooleanEnv(value, defaultValue = false) {
  const normalized = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (!normalized) {
    return defaultValue;
  }
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }
  return defaultValue;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultYesterdayDateString() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - 1);
  return formatLocalDate(date);
}

function parseDateString(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  const valid =
    parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
  return valid ? parsed : null;
}

function localDayBounds(dateString) {
  const parsed = parseDateString(dateString);
  if (!parsed) {
    throw new Error(`Ugyldig dato: ${dateString}. Forventet format: YYYY-MM-DD`);
  }

  parsed.setHours(0, 0, 0, 0);
  const start = parsed;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function ensureReadable(pathValue) {
  if (!fs.existsSync(pathValue)) {
    throw new Error(`Fant ikke database: ${pathValue}`);
  }

  try {
    fs.accessSync(pathValue, fs.constants.R_OK);
  } catch (_) {
    throw new Error(
      [
        `Mangler lesetilgang til: ${pathValue}`,
        "Gi Full Disk Access til appen som kjører scriptet (Terminal/iTerm/VSCode/Node), og prøv igjen."
      ].join("\n")
    );
  }
}

function runReadonlyQuery(databasePath, sql, params, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      database.close(() => {
        reject(new Error(timeoutMessage));
      });
    }, timeoutMs);

    database.all(sql, params, (queryErr, rows) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      database.close(() => {
        if (queryErr) {
          reject(queryErr);
          return;
        }
        resolve(Array.isArray(rows) ? rows : []);
      });
    });
  });
}

function queryUsageRows(databasePath, startAppleSeconds, endAppleSeconds, streamNames) {
  const { normalized, placeholders } = streamSqlParts(streamNames);
  const sql = `
    SELECT
      ZOBJECT.ZSTARTDATE AS start_date,
      ZOBJECT.ZENDDATE AS end_date,
      ZOBJECT.ZSTREAMNAME AS stream_name
    FROM ZOBJECT
    WHERE
      ZOBJECT.ZSTREAMNAME IN (${placeholders}) AND
      ZOBJECT.ZENDDATE > ? AND
      ZOBJECT.ZSTARTDATE < ? AND
      ZOBJECT.ZENDDATE > ZOBJECT.ZSTARTDATE
  `;

  return runReadonlyQuery(
    databasePath,
    sql,
    [...normalized, startAppleSeconds, endAppleSeconds],
    15000,
    "Timeout ved lesing av knowledgeC.db"
  );
}

function queryUsageRowsWithDevice(databasePath, startAppleSeconds, endAppleSeconds, streamNames) {
  const { normalized, placeholders } = streamSqlParts(streamNames);
  const sql = `
    SELECT
      ZOBJECT.ZSTARTDATE AS start_date,
      ZOBJECT.ZENDDATE AS end_date,
      ZOBJECT.ZSTREAMNAME AS stream_name,
      CASE
        WHEN ZSOURCE.ZDEVICEID IS NULL OR ZSOURCE.ZDEVICEID = '' THEN 'LOCAL'
        ELSE ZSOURCE.ZDEVICEID
      END AS device_id,
      CASE
        WHEN ZSOURCE.ZDEVICEID IS NULL OR ZSOURCE.ZDEVICEID = '' THEN 'This Mac (local)'
        ELSE COALESCE(ZSYNCPEER.ZMODEL, 'UNKNOWN')
      END AS device_model
    FROM ZOBJECT
    LEFT JOIN ZSOURCE ON ZOBJECT.ZSOURCE = ZSOURCE.Z_PK
    LEFT JOIN ZSYNCPEER ON ZSOURCE.ZDEVICEID = ZSYNCPEER.ZDEVICEID
    WHERE
      ZOBJECT.ZSTREAMNAME IN (${placeholders}) AND
      ZOBJECT.ZENDDATE > ? AND
      ZOBJECT.ZSTARTDATE < ? AND
      ZOBJECT.ZENDDATE > ZOBJECT.ZSTARTDATE
  `;

  return runReadonlyQuery(
    databasePath,
    sql,
    [...normalized, startAppleSeconds, endAppleSeconds],
    15000,
    "Timeout ved lesing av knowledgeC.db (device query)"
  );
}

function queryUsageRowsWithDeviceAndApp(databasePath, startAppleSeconds, endAppleSeconds, streamNames) {
  const { normalized, placeholders } = streamSqlParts(streamNames);
  const sql = `
    SELECT
      ZOBJECT.ZSTARTDATE AS start_date,
      ZOBJECT.ZENDDATE AS end_date,
      ZOBJECT.ZSTREAMNAME AS stream_name,
      COALESCE(ZOBJECT.ZVALUESTRING, 'UNKNOWN_APP') AS app_name,
      CASE
        WHEN ZSOURCE.ZDEVICEID IS NULL OR ZSOURCE.ZDEVICEID = '' THEN 'LOCAL'
        ELSE ZSOURCE.ZDEVICEID
      END AS device_id,
      CASE
        WHEN ZSOURCE.ZDEVICEID IS NULL OR ZSOURCE.ZDEVICEID = '' THEN 'This Mac (local)'
        ELSE COALESCE(ZSYNCPEER.ZMODEL, 'UNKNOWN')
      END AS device_model
    FROM ZOBJECT
    LEFT JOIN ZSOURCE ON ZOBJECT.ZSOURCE = ZSOURCE.Z_PK
    LEFT JOIN ZSYNCPEER ON ZSOURCE.ZDEVICEID = ZSYNCPEER.ZDEVICEID
    WHERE
      ZOBJECT.ZSTREAMNAME IN (${placeholders}) AND
      ZOBJECT.ZENDDATE > ? AND
      ZOBJECT.ZSTARTDATE < ? AND
      ZOBJECT.ZENDDATE > ZOBJECT.ZSTARTDATE
  `;

  return runReadonlyQuery(
    databasePath,
    sql,
    [...normalized, startAppleSeconds, endAppleSeconds],
    15000,
    "Timeout ved app/device debug-lesing av knowledgeC.db"
  );
}

function overlapSeconds(row, dayStartMs, dayEndMs) {
  const startSeconds = Number(row && row.start_date);
  const endSeconds = Number(row && row.end_date);

  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
    return 0;
  }

  const rowStartMs = (startSeconds + APPLE_EPOCH_SECONDS) * 1000;
  const rowEndMs = (endSeconds + APPLE_EPOCH_SECONDS) * 1000;
  const overlapStart = Math.max(dayStartMs, rowStartMs);
  const overlapEnd = Math.min(dayEndMs, rowEndMs);

  return overlapEnd > overlapStart ? (overlapEnd - overlapStart) / 1000 : 0;
}

function aggregateByDevice(rows, dayStartMs, dayEndMs) {
  const byDevice = new Map();

  rows.forEach((row) => {
    const seconds = overlapSeconds(row, dayStartMs, dayEndMs);
    if (seconds <= 0) {
      return;
    }

    const deviceId = String((row && row.device_id) || "UNKNOWN");
    const deviceModel = String((row && row.device_model) || "UNKNOWN");
    const key = `${deviceId}__${deviceModel}`;
    const current = byDevice.get(key) || {
      device_id: deviceId,
      device_model: deviceModel,
      total_seconds: 0,
      rows_count: 0
    };

    current.total_seconds += seconds;
    current.rows_count += 1;
    byDevice.set(key, current);
  });

  return Array.from(byDevice.values())
    .map((item) => ({
      ...item,
      total_minutes: Math.round(item.total_seconds / 60)
    }))
    .sort((a, b) => b.total_seconds - a.total_seconds);
}

function aggregateByStream(rows, dayStartMs, dayEndMs) {
  const byStream = new Map();

  rows.forEach((row) => {
    const seconds = overlapSeconds(row, dayStartMs, dayEndMs);
    if (seconds <= 0) {
      return;
    }

    const streamName = String((row && row.stream_name) || "UNKNOWN");
    const current = byStream.get(streamName) || {
      stream_name: streamName,
      total_seconds: 0,
      rows_count: 0
    };

    current.total_seconds += seconds;
    current.rows_count += 1;
    byStream.set(streamName, current);
  });

  return Array.from(byStream.values())
    .map((item) => ({
      ...item,
      total_minutes: Math.round(item.total_seconds / 60)
    }))
    .sort((a, b) => b.total_seconds - a.total_seconds);
}

function normalizeVisibleText(value) {
  return String(value || "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMinutesFromUsageText(value) {
  const normalized = normalizeVisibleText(value).toLowerCase();
  if (!normalized || !/\d/.test(normalized)) {
    return null;
  }

  let hours = 0;
  let minutes = 0;
  const hourRegex = /(\d+)\s*(?:t|h|hr|hrs|hour|hours|tim|timer)\b/g;
  const minuteRegex = /(\d+)\s*(?:m|min|mins|minute|minutes)\b/g;
  let match = null;

  while ((match = hourRegex.exec(normalized)) !== null) {
    hours += Number(match[1]) || 0;
  }

  while ((match = minuteRegex.exec(normalized)) !== null) {
    minutes += Number(match[1]) || 0;
  }

  const total = hours * 60 + minutes;
  return total > 0 ? total : null;
}

function pickUsageTextCandidate(staticTexts) {
  const values = Array.isArray(staticTexts) ? staticTexts : [];
  let fallback = null;

  for (const rawValue of values) {
    const normalized = normalizeVisibleText(rawValue);
    if (!normalized) {
      continue;
    }

    const lower = normalized.toLowerCase();
    if (lower.includes("snitt") || lower.includes("oppdatert")) {
      continue;
    }

    const parsedMinutes = parseMinutesFromUsageText(normalized);
    if (!parsedMinutes) {
      continue;
    }

    const isSecondsOnly =
      /\b\d+\s*s\b/.test(lower) &&
      !/(?:\b\d+\s*(?:m|min|mins|minute|minutes)\b|\b\d+\s*(?:t|h|hr|hrs|hour|hours|tim|timer)\b)/.test(
        lower
      );
    if (isSecondsOnly) {
      continue;
    }

    if (!fallback) {
      fallback = { usageText: normalized, totalMinutes: parsedMinutes };
    }

    // The total usage usually appears before per-app rows in the accessibility tree.
    return { usageText: normalized, totalMinutes: parsedMinutes };
  }

  return fallback;
}

function parseAppleScriptKeyValueOutput(outputText) {
  return String(outputText || "")
    .split(/\r?\n/)
    .reduce((acc, line) => {
      const idx = line.indexOf("=");
      if (idx <= 0) {
        return acc;
      }
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      acc[key] = value;
      return acc;
    }, {});
}

function readIphoneScreenTimeViaUi(deviceMatchInput) {
  const deviceMatch = normalizeVisibleText(deviceMatchInput || "iphone").toLowerCase();
  const escapedDeviceMatch = deviceMatch.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const appleScript = `
use scripting additions

on lowerText(s)
  return do shell script "printf %s " & quoted form of s & " | tr '[:upper:]' '[:lower:]'"
end lowerText

on roleOfElem(e)
  try
    tell application "System Events" to return value of attribute "AXRole" of e
  on error
    return ""
  end try
end roleOfElem

on nameOfElem(e)
  try
    tell application "System Events"
      if name of e is missing value then
        return ""
      end if
      return name of e as text
    end tell
  on error
    return ""
  end try
end nameOfElem

on valueOfElem(e)
  try
    tell application "System Events"
      if value of e is missing value then
        return ""
      end if
      return value of e as text
    end tell
  on error
    return ""
  end try
end valueOfElem

on parentElem(e)
  try
    tell application "System Events" to return value of attribute "AXParent" of e
  on error
    return missing value
  end try
end parentElem

on nearestRow(e)
  set currentElem to e
  repeat with i from 1 to 8
    set currentElem to my parentElem(currentElem)
    if currentElem is missing value then
      return missing value
    end if
    if my roleOfElem(currentElem) is "AXRow" then
      return currentElem
    end if
  end repeat
  return missing value
end nearestRow

on rowContainsActivityLabel(rowElem)
  try
    tell application "System Events"
      set rowItems to entire contents of rowElem
    end tell
  on error
    return false
  end try

  repeat with ri in rowItems
    if my roleOfElem(ri) is "AXStaticText" then
      set txt to my lowerText(my nameOfElem(ri))
      if txt contains "appbruk" or txt contains "app- og nettstedsaktivitet" or txt contains "app and website activity" then
        return true
      end if
    end if
  end repeat

  return false
end rowContainsActivityLabel

on openScreenTimeSection(uiElems)
  repeat with e in uiElems
    if my roleOfElem(e) is "AXStaticText" then
      set txt to my lowerText(my nameOfElem(e))
      if txt is "skjermtid" or txt is "screen time" then
        set rowElem to my nearestRow(e)
        tell application "System Events"
          if rowElem is not missing value then
            try
              set selected of rowElem to true
            on error
              click rowElem
            end try
          else
            click e
          end if
        end tell
        return true
      end if
    end if
  end repeat

  return false
end openScreenTimeSection

on findPopup(uiElems, nameHint, valueHintA, valueHintB, skipNameHint)
  repeat with e in uiElems
    if my roleOfElem(e) is "AXPopUpButton" then
      set nm to my lowerText(my nameOfElem(e))
      set val to my lowerText(my valueOfElem(e))
      if not (skipNameHint is not "" and nm contains skipNameHint) then
        if nameHint is not "" and nm contains nameHint then
          return e
        end if
        if valueHintA is not "" and val contains valueHintA then
          return e
        end if
        if valueHintB is not "" and val contains valueHintB then
          return e
        end if
      end if
    end if
  end repeat

  return missing value
end findPopup

on openActivityReport(uiElems)
  repeat with e in uiElems
    if my roleOfElem(e) is "AXRow" then
      if my rowContainsActivityLabel(e) then
        tell application "System Events"
          try
            set selected of e to true
          on error
            click e
          end try
          delay 0.15
          key code 36
        end tell
        return true
      end if
    end if
  end repeat

  repeat with e in uiElems
    if my roleOfElem(e) is "AXStaticText" then
      set txt to my lowerText(my nameOfElem(e))
      if txt contains "appbruk" or txt contains "app- og nettstedsaktivitet" or txt contains "app and website activity" then
        set rowElem to my nearestRow(e)
        tell application "System Events"
          if rowElem is not missing value then
            try
              set selected of rowElem to true
            on error
              click rowElem
            end try
            delay 0.15
            key code 36
          else
            click e
            delay 0.15
            key code 36
          end if
        end tell
        return true
      end if
    end if
  end repeat

  -- Fallback: row index that opens "App- og nettstedsaktivitet" in current macOS layout.
  try
    set fallbackRow to item 39 of uiElems
    if my roleOfElem(fallbackRow) is "AXRow" then
      tell application "System Events"
        try
          set selected of fallbackRow to true
        on error
          click fallbackRow
        end try
        delay 0.15
        key code 36
      end tell
      return true
    end if
  end try

  return false
end openActivityReport

on selectMenuItemContaining(thePopup, needleA, needleB)
  tell application "System Events"
    click thePopup
    delay 0.45
    set chosen to ""

    tell menu 1 of thePopup
      repeat with mi in menu items
        set nm to name of mi as text
        set low to my lowerText(nm)
        if (needleA is not "" and low contains needleA) or (needleB is not "" and low contains needleB) then
          click mi
          set chosen to nm
          exit repeat
        end if
      end repeat
    end tell

    if chosen is "" then
      key code 53
    end if

    return chosen
  end tell
end selectMenuItemContaining

on selectMenuItemStartingWith(thePopup, prefixA, prefixB)
  tell application "System Events"
    click thePopup
    delay 0.45
    set chosen to ""

    tell menu 1 of thePopup
      repeat with mi in menu items
        set nm to name of mi as text
        set low to my lowerText(nm)
        if (prefixA is not "" and low starts with prefixA) or (prefixB is not "" and low starts with prefixB) then
          click mi
          set chosen to nm
          exit repeat
        end if
      end repeat
    end tell

    if chosen is "" then
      key code 53
    end if

    return chosen
  end tell
end selectMenuItemStartingWith

on collectStaticTexts(uiElems)
  set values to {}
  repeat with e in uiElems
    if my roleOfElem(e) is "AXStaticText" then
      set txt to my nameOfElem(e)
      if txt is not "" then
        set end of values to txt
      end if
    end if
  end repeat
  return values
end collectStaticTexts

on previewStaticTexts(uiElems, maxCount)
  set values to {}
  set seen to 0
  repeat with e in uiElems
    if my roleOfElem(e) is "AXStaticText" then
      set txt to my nameOfElem(e)
      if txt is not "" then
        set end of values to txt
        set seen to seen + 1
        if seen ≥ maxCount then
          exit repeat
        end if
      end if
    end if
  end repeat

  set AppleScript's text item delimiters to " | "
  set previewLine to values as text
  set AppleScript's text item delimiters to ""
  return previewLine
end previewStaticTexts

set deviceNeedle to "${escapedDeviceMatch}"

try
  tell application "System Settings"
    activate
  end tell

  do shell script "open 'x-apple.systempreferences:com.apple.Screen-Time-Settings.extension'"
  delay 2

  tell application "System Events"
    tell process "System Settings"
      set frontmost to true
      delay 0.4

      if (count of windows) = 0 then
        error "Fant ikke et åpent System Settings-vindu. Åpne Skjermtid manuelt én gang først."
      end if

      set uiElems to entire contents of window 1
      set openedScreenTime to my openScreenTimeSection(uiElems)
      if openedScreenTime then
        delay 0.8
        set uiElems to entire contents of window 1
      end if

      set devicePopup to my findPopup(uiElems, "enhet", "enheter", "devices", "")
      if devicePopup is missing value then
        set devicePopup to my findPopup(uiElems, "device", "enheter", "devices", "")
      end if
      if devicePopup is missing value then
        set opened to my openActivityReport(uiElems)
        if opened then
          delay 0.8
          set uiElems to entire contents of window 1
          set devicePopup to my findPopup(uiElems, "enhet", "enheter", "devices", "")
          if devicePopup is missing value then
            set devicePopup to my findPopup(uiElems, "device", "enheter", "devices", "")
          end if
        end if
      end if

      if devicePopup is missing value then
        set previewLine to my previewStaticTexts(uiElems, 20)
        error "Fant ikke enhetsvelgeren i App- og nettstedsaktivitet. UI-preview: " & previewLine
      end if

      set selectedDevice to my selectMenuItemContaining(devicePopup, deviceNeedle, "iphone")
      if selectedDevice is "" then
        error "Fant ikke iPhone i enhetslisten."
      end if

      delay 0.7
      set uiElems to entire contents of window 1
      set datePopup to my findPopup(uiElems, "", "i dag", "today", "enhet")
      if datePopup is missing value then
        set datePopup to my findPopup(uiElems, "", "i går", "yesterday", "enhet")
      end if
      if datePopup is missing value then
        error "Fant ikke datovelgeren (I dag / I går)."
      end if

      set selectedDate to my selectMenuItemStartingWith(datePopup, "i går", "yesterday")
      if selectedDate is "" then
        error "Fant ikke menyvalg for I går / Yesterday."
      end if

      delay 0.8
      set uiElems to entire contents of window 1
      set texts to my collectStaticTexts(uiElems)

      set AppleScript's text item delimiters to "|||"
      set packedTexts to texts as text
      set AppleScript's text item delimiters to ""

      return "DEVICE=" & selectedDevice & linefeed & "DATE=" & selectedDate & linefeed & "TEXTS=" & packedTexts
    end tell
  end tell
on error errMsg number errNum
  return "ERROR=" & errNum & "|" & errMsg
end try
`;

  if (String(process.env.SCREEN_TIME_UI_DUMP_SCRIPT || "").toLowerCase() === "true") {
    console.log(appleScript);
  }

  let output = "";
  try {
    output = execFileSync("osascript", ["-"], { input: appleScript, encoding: "utf8" }).trim();
  } catch (error) {
    const stderr = normalizeVisibleText(error && error.stderr ? error.stderr : "");
    const stdout = normalizeVisibleText(error && error.stdout ? error.stdout : "");
    const combined = `${stderr} ${stdout}`.toLowerCase();
    if (combined.includes("tilgang til hjelp") || combined.includes("accessibility")) {
      throw new Error(
        [
          "UI-lesing av iPhone feilet: mangler Accessibility-tilgang for osascript/node.",
          "Gå til System Settings -> Privacy & Security -> Accessibility, legg til og aktiver appen som kjører jobben (Terminal + node + eventuelt Codex).",
          "Kjør deretter launchctl kickstart på nytt."
        ].join(" ")
      );
    }
    throw new Error(`UI-lesing av iPhone feilet. ${stderr || stdout || String(error.message || error)}`);
  }

  const parsed = parseAppleScriptKeyValueOutput(output);
  if (parsed.ERROR) {
    const lowerError = String(parsed.ERROR).toLowerCase();
    if (lowerError.includes("-25211") || lowerError.includes("tilgang til hjelp")) {
      throw new Error(
        [
          "UI-lesing av iPhone feilet: mangler Accessibility-tilgang for osascript/node.",
          "Gå til System Settings -> Privacy & Security -> Accessibility, legg til og aktiver appen som kjører jobben (Terminal + node + eventuelt Codex).",
          "Kjør deretter launchctl kickstart på nytt."
        ].join(" ")
      );
    }
    throw new Error(`UI-lesing av iPhone feilet. ${parsed.ERROR}`);
  }

  const staticTexts = String(parsed.TEXTS || "")
    .split("|||")
    .map((item) => normalizeVisibleText(item))
    .filter(Boolean);
  const picked = pickUsageTextCandidate(staticTexts);
  if (!picked || !Number.isFinite(picked.totalMinutes)) {
    throw new Error("Fant ikke brukstid i Skjermtid-vinduet etter valg av iPhone + I går.");
  }

  return {
    totalMinutes: picked.totalMinutes,
    usageText: picked.usageText,
    selectedDevice: normalizeVisibleText(parsed.DEVICE || ""),
    selectedDate: normalizeVisibleText(parsed.DATE || ""),
    sampleStaticTexts: staticTexts.slice(0, 12)
  };
}

async function runIphoneUiImport({
  targetDate,
  source,
  baseUrl,
  key,
  dryRun,
  uiDeviceMatch,
  contextNote
}) {
  const yesterday = defaultYesterdayDateString();
  if (targetDate !== yesterday) {
    console.warn(
      [
        `Advarsel: iphone-ui leser alltid tallet for 'I går' i Skjermtid-vinduet.`,
        `Payload lagres fortsatt på dato ${targetDate}.`,
        `Hvis du vil unngå mismatch, sett SCREEN_TIME_DATE=${yesterday} eller la den være tom.`
      ].join(" ")
    );
  }

  if (contextNote) {
    console.warn(contextNote);
  }

  const uiResult = readIphoneScreenTimeViaUi(uiDeviceMatch);
  const selectedDateLower = normalizeVisibleText(uiResult.selectedDate).toLowerCase();
  if (!(selectedDateLower.startsWith("i går") || selectedDateLower.startsWith("yesterday"))) {
    console.warn(
      `Advarsel: Datovelger i UI ser ut til å være '${uiResult.selectedDate}'. Forventer normalt 'I går' / 'Yesterday'.`
    );
  }

  const payload = {
    date: targetDate,
    total_minutes: uiResult.totalMinutes,
    source
  };

  console.log("Mode: iphone-ui");
  console.log(`Dato (payload): ${targetDate}`);
  console.log(`UI-enhet: ${uiResult.selectedDevice || "(ukjent)"}`);
  console.log(`UI-dato: ${uiResult.selectedDate || "(ukjent)"}`);
  console.log(`UI-bruk: ${uiResult.usageText} -> ${uiResult.totalMinutes} min`);
  await postScreenTime(baseUrl, key, payload, dryRun);
}

async function postScreenTime(baseUrl, key, payload, dryRun) {
  if (dryRun) {
    console.log("DRY_RUN=true, sender ikke.");
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const normalizedBase = String(baseUrl || "").replace(/\/+$/, "");
  const url = `${normalizedBase}/screen-time?key=${encodeURIComponent(key)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const bodyText = await response.text();
  if (!response.ok) {
    throw new Error(`POST feilet (${response.status}): ${bodyText}`);
  }

  console.log(bodyText);
}

function queryStreamBreakdown(databasePath, startAppleSeconds, endAppleSeconds) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
    let settled = false;

    const sql = `
      SELECT
        ZSTREAMNAME AS stream_name,
        SUM(ZENDDATE - ZSTARTDATE) AS raw_seconds,
        COUNT(*) AS rows_count
      FROM ZOBJECT
      WHERE
        ZENDDATE > ? AND
        ZSTARTDATE < ? AND
        ZENDDATE > ZSTARTDATE
      GROUP BY ZSTREAMNAME
      ORDER BY raw_seconds DESC
      LIMIT 20
    `;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      database.close(() => {
        reject(new Error("Timeout ved debug-stream-lesing av knowledgeC.db"));
      });
    }, 15000);

    database.all(sql, [startAppleSeconds, endAppleSeconds], (queryErr, rows) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      database.close(() => {
        if (queryErr) {
          reject(queryErr);
          return;
        }
        resolve(Array.isArray(rows) ? rows : []);
      });
    });
  });
}

function queryAppStreamRowsWithDevice(databasePath, startAppleSeconds, endAppleSeconds) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
    let settled = false;

    const sql = `
      SELECT
        ZOBJECT.ZSTREAMNAME AS stream_name,
        ZOBJECT.ZSTARTDATE AS start_date,
        ZOBJECT.ZENDDATE AS end_date,
        CASE
          WHEN ZSOURCE.ZDEVICEID IS NULL OR ZSOURCE.ZDEVICEID = '' THEN 'LOCAL'
          ELSE ZSOURCE.ZDEVICEID
        END AS device_id,
        CASE
          WHEN ZSOURCE.ZDEVICEID IS NULL OR ZSOURCE.ZDEVICEID = '' THEN 'This Mac (local)'
          ELSE COALESCE(ZSYNCPEER.ZMODEL, 'UNKNOWN')
        END AS device_model
      FROM ZOBJECT
      LEFT JOIN ZSOURCE ON ZOBJECT.ZSOURCE = ZSOURCE.Z_PK
      LEFT JOIN ZSYNCPEER ON ZSOURCE.ZDEVICEID = ZSYNCPEER.ZDEVICEID
      WHERE
        ZOBJECT.ZSTREAMNAME LIKE '/app/%' AND
        ZOBJECT.ZENDDATE > ? AND
        ZOBJECT.ZSTARTDATE < ? AND
        ZOBJECT.ZENDDATE > ZOBJECT.ZSTARTDATE
    `;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      database.close(() => {
        reject(new Error("Timeout ved debug app-stream-lesing av knowledgeC.db"));
      });
    }, 15000);

    database.all(sql, [startAppleSeconds, endAppleSeconds], (queryErr, rows) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      database.close(() => {
        if (queryErr) {
          reject(queryErr);
          return;
        }
        resolve(Array.isArray(rows) ? rows : []);
      });
    });
  });
}

function queryAllStreamsForDevice(databasePath, startAppleSeconds, endAppleSeconds, deviceFilterLower) {
  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY);
    let settled = false;

    const sql = `
      SELECT
        ZOBJECT.ZSTREAMNAME AS stream_name,
        ZOBJECT.ZSTARTDATE AS start_date,
        ZOBJECT.ZENDDATE AS end_date,
        CASE
          WHEN ZSOURCE.ZDEVICEID IS NULL OR ZSOURCE.ZDEVICEID = '' THEN 'LOCAL'
          ELSE ZSOURCE.ZDEVICEID
        END AS device_id,
        CASE
          WHEN ZSOURCE.ZDEVICEID IS NULL OR ZSOURCE.ZDEVICEID = '' THEN 'This Mac (local)'
          ELSE COALESCE(ZSYNCPEER.ZMODEL, 'UNKNOWN')
        END AS device_model
      FROM ZOBJECT
      LEFT JOIN ZSOURCE ON ZOBJECT.ZSOURCE = ZSOURCE.Z_PK
      LEFT JOIN ZSYNCPEER ON ZSOURCE.ZDEVICEID = ZSYNCPEER.ZDEVICEID
      WHERE
        ZOBJECT.ZENDDATE > ? AND
        ZOBJECT.ZSTARTDATE < ? AND
        ZOBJECT.ZENDDATE > ZOBJECT.ZSTARTDATE
    `;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      database.close(() => {
        reject(new Error("Timeout ved debug all-stream-lesing av knowledgeC.db"));
      });
    }, 20000);

    database.all(sql, [startAppleSeconds, endAppleSeconds], (queryErr, rows) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      database.close(() => {
        if (queryErr) {
          reject(queryErr);
          return;
        }

        const filtered = (Array.isArray(rows) ? rows : []).filter((row) => {
          const id = String((row && row.device_id) || "").toLowerCase();
          const model = String((row && row.device_model) || "").toLowerCase();
          return id.includes(deviceFilterLower) || model.includes(deviceFilterLower);
        });

        resolve(filtered);
      });
    });
  });
}

async function main() {
  const targetDate = process.env.SCREEN_TIME_DATE || defaultYesterdayDateString();
  const mode = String(process.env.SCREEN_TIME_MODE || "mac-db")
    .trim()
    .toLowerCase();
  const defaultSourceByMode =
    mode === "iphone-ui"
      ? "iphone-system-settings-ui"
      : mode === "iphone-db"
        ? "iphone-knowledge-db"
        : "mac-knowledge-db";
  const source = process.env.SCREEN_TIME_SOURCE || defaultSourceByMode;
  const baseUrl = process.env.OLES_BRAIN_BASE_URL || "https://oles-brain.netlify.app";
  const key = process.env.SCREEN_TIME_KEY;
  const databasePath =
    process.env.KNOWLEDGE_DB_PATH ||
    path.join(os.homedir(), "Library", "Application Support", "Knowledge", "knowledgeC.db");
  const uiDeviceMatch = String(process.env.SCREEN_TIME_UI_DEVICE_MATCH || "iphone").trim();
  const defaultStreams = mode === "iphone-db" ? EXTENDED_APP_STREAMS : DEFAULT_APP_STREAMS;
  const appStreams = parseStreamNames(process.env.SCREEN_TIME_STREAMS, defaultStreams);
  const streamAggregation = String(
    process.env.SCREEN_TIME_STREAM_AGGREGATION || (mode === "iphone-db" ? "best-stream" : "sum")
  )
    .trim()
    .toLowerCase();
  const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";
  const debugStreams = String(process.env.SCREEN_TIME_DEBUG_STREAMS || "").toLowerCase() === "true";
  const debugDevices = String(process.env.SCREEN_TIME_DEBUG_DEVICES || "").toLowerCase() === "true";
  const debugAppStreams = String(process.env.SCREEN_TIME_DEBUG_APP_STREAMS || "").toLowerCase() === "true";
  const debugTopApps = String(process.env.SCREEN_TIME_DEBUG_TOP_APPS || "").toLowerCase() === "true";
  const debugAllStreamsForDevice = String(process.env.SCREEN_TIME_DEBUG_ALL_STREAMS_FOR_DEVICE || "")
    .trim()
    .toLowerCase();
  const runToken = String(process.env.SCREEN_TIME_RUN_TOKEN || "").trim();
  const rawDeviceFilter = String(process.env.SCREEN_TIME_DEVICE_FILTER || "").trim().toLowerCase();
  const deviceFilter = mode === "iphone-db" ? rawDeviceFilter || "iphone" : rawDeviceFilter;
  const iphoneDbFallbackToUi = parseBooleanEnv(
    process.env.SCREEN_TIME_FALLBACK_TO_UI,
    mode === "iphone-db"
  );

  if (!key) {
    throw new Error("SCREEN_TIME_KEY mangler.");
  }

  if (!["mac-db", "iphone-ui", "iphone-db"].includes(mode)) {
    throw new Error(`Ugyldig SCREEN_TIME_MODE='${mode}'. Bruk 'mac-db', 'iphone-db' eller 'iphone-ui'.`);
  }

  if (!["sum", "best-stream"].includes(streamAggregation)) {
    throw new Error(
      `Ugyldig SCREEN_TIME_STREAM_AGGREGATION='${streamAggregation}'. Bruk 'sum' eller 'best-stream'.`
    );
  }

  if (runToken) {
    console.log(`Run token: ${runToken}`);
  }

  if (mode === "iphone-ui") {
    await runIphoneUiImport({
      targetDate,
      source,
      baseUrl,
      key,
      dryRun,
      uiDeviceMatch
    });
    return;
  }

  ensureReadable(databasePath);
  const { start, end } = localDayBounds(targetDate);
  const dayStartMs = start.getTime();
  const dayEndMs = end.getTime();
  const startAppleSeconds = dayStartMs / 1000 - APPLE_EPOCH_SECONDS;
  const endAppleSeconds = dayEndMs / 1000 - APPLE_EPOCH_SECONDS;

  const needsDeviceRows = debugDevices || Boolean(deviceFilter);
  let rows = [];
  if (needsDeviceRows) {
    rows = await queryUsageRowsWithDevice(databasePath, startAppleSeconds, endAppleSeconds, appStreams);
  } else {
    rows = await queryUsageRows(databasePath, startAppleSeconds, endAppleSeconds, appStreams);
  }

  const rowsBeforeFilter = rows.length;
  if (deviceFilter) {
    rows = rows.filter((row) => {
      const deviceId = String((row && row.device_id) || "").toLowerCase();
      const deviceModel = String((row && row.device_model) || "").toLowerCase();
      return deviceId.includes(deviceFilter) || deviceModel.includes(deviceFilter);
    });

    if (rowsBeforeFilter > 0 && rows.length === 0) {
      if (mode !== "iphone-db") {
        throw new Error(`Fant ingen rader for SCREEN_TIME_DEVICE_FILTER='${deviceFilter}'.`);
      }
    }
  }

  const streamTotals = aggregateByStream(rows, dayStartMs, dayEndMs);
  let totalSeconds = rows.reduce((sum, row) => sum + overlapSeconds(row, dayStartMs, dayEndMs), 0);
  let selectedStream = "";
  if (streamAggregation === "best-stream") {
    const best = streamTotals[0] || null;
    totalSeconds = best ? best.total_seconds : 0;
    selectedStream = best ? best.stream_name : "";
  }
  const totalMinutes = Math.max(0, Math.round(totalSeconds / 60));

  if (mode === "iphone-db" && rows.length === 0) {
    if (iphoneDbFallbackToUi) {
      const fallbackSource = `${source}:fallback=iphone-ui`;
      await runIphoneUiImport({
        targetDate,
        source: fallbackSource,
        baseUrl,
        key,
        dryRun,
        uiDeviceMatch,
        contextNote:
          "iphone-db fant ingen iPhone-rader i DB. Prøver automatisk fallback til iphone-ui (lesing fra Skjermtid-vinduet)."
      });
      return;
    }

    throw new Error(
      [
        `Fant ingen iPhone-rader i streams: ${appStreams.join(", ")}`,
        "Sjekk at 'Del på tvers av enheter' er aktiv i Skjermtid på iPhone/Mac.",
        "Du kan også bruke SCREEN_TIME_MODE=iphone-ui eller sett SCREEN_TIME_FALLBACK_TO_UI=true."
      ].join(" ")
    );
  }

  console.log(`Mode: ${mode}`);
  console.log(`App streams: ${appStreams.join(", ")}`);
  if (deviceFilter) {
    console.log(`Device filter: ${deviceFilter}`);
  }
  if (streamAggregation === "best-stream") {
    if (selectedStream) {
      console.log(`Stream-strategi: best-stream -> ${selectedStream}`);
    } else {
      console.log("Stream-strategi: best-stream -> ingen treff");
    }
  }
  if (streamTotals.length > 0 && (streamAggregation === "best-stream" || debugDevices)) {
    console.log("Stream totals (etter filter):");
    streamTotals.slice(0, 10).forEach((item) => {
      console.log(`- ${item.stream_name}: ${item.total_minutes} min (${item.rows_count} rader)`);
    });
  }

  if (debugStreams) {
    const streamRows = await queryStreamBreakdown(databasePath, startAppleSeconds, endAppleSeconds);
    console.log("Stream breakdown:");
    streamRows.forEach((row) => {
      const streamName = String(row.stream_name || "UNKNOWN");
      const minutes = Math.round((Number(row.raw_seconds) || 0) / 60);
      const count = Number(row.rows_count) || 0;
      console.log(`- ${streamName}: ${minutes} min (${count} rader)`);
    });
  }

  if (debugDevices) {
    const devices = aggregateByDevice(rows, dayStartMs, dayEndMs);
    console.log(`Device breakdown (${appStreams.join(", ")}):`);
    devices.forEach((item) => {
      console.log(
        [
          `- ${item.device_model}`,
          `[${item.device_id}]`,
          `${item.total_minutes} min`,
          `(${item.rows_count} rader)`
        ].join(" ")
      );
    });
  }

  if (debugAppStreams) {
    const appRows = await queryAppStreamRowsWithDevice(databasePath, startAppleSeconds, endAppleSeconds);
    const grouped = new Map();

    appRows.forEach((row) => {
      const seconds = overlapSeconds(row, dayStartMs, dayEndMs);
      if (seconds <= 0) {
        return;
      }

      const stream = String((row && row.stream_name) || "UNKNOWN");
      const model = String((row && row.device_model) || "UNKNOWN");
      const deviceId = String((row && row.device_id) || "UNKNOWN");
      const key = `${stream}||${model}||${deviceId}`;
      const current = grouped.get(key) || {
        stream_name: stream,
        device_model: model,
        device_id: deviceId,
        total_seconds: 0,
        rows_count: 0
      };
      current.total_seconds += seconds;
      current.rows_count += 1;
      grouped.set(key, current);
    });

    const lines = Array.from(grouped.values())
      .map((item) => ({ ...item, total_minutes: Math.round(item.total_seconds / 60) }))
      .sort((a, b) => b.total_seconds - a.total_seconds)
      .slice(0, 50);

    console.log("App stream + device breakdown:");
    lines.forEach((item) => {
      console.log(
        [
          `- ${item.stream_name}`,
          `${item.device_model}`,
          `[${item.device_id}]`,
          `${item.total_minutes} min`,
          `(${item.rows_count} rader)`
        ].join(" | ")
      );
    });
  }

  if (debugTopApps) {
    const appRows = await queryUsageRowsWithDeviceAndApp(
      databasePath,
      startAppleSeconds,
      endAppleSeconds,
      appStreams
    );
    const grouped = new Map();

    appRows.forEach((row) => {
      const seconds = overlapSeconds(row, dayStartMs, dayEndMs);
      if (seconds <= 0) {
        return;
      }

      const stream = String((row && row.stream_name) || "UNKNOWN");
      const app = String((row && row.app_name) || "UNKNOWN_APP");
      const model = String((row && row.device_model) || "UNKNOWN");
      const deviceId = String((row && row.device_id) || "UNKNOWN");
      if (deviceFilter) {
        const modelLower = model.toLowerCase();
        const idLower = deviceId.toLowerCase();
        if (!modelLower.includes(deviceFilter) && !idLower.includes(deviceFilter)) {
          return;
        }
      }
      const key = `${model}||${deviceId}||${stream}||${app}`;
      const current = grouped.get(key) || {
        device_model: model,
        device_id: deviceId,
        stream_name: stream,
        app_name: app,
        total_seconds: 0
      };
      current.total_seconds += seconds;
      grouped.set(key, current);
    });

    const byDevice = new Map();
    Array.from(grouped.values()).forEach((item) => {
      const key = `${item.device_model}||${item.device_id}`;
      const list = byDevice.get(key) || [];
      list.push(item);
      byDevice.set(key, list);
    });

    console.log("Top apps per device (/app/usage):");
    Array.from(byDevice.entries()).forEach(([key, items]) => {
      const [model, deviceId] = key.split("||");
      const sorted = items
        .map((item) => ({ ...item, total_minutes: Math.round(item.total_seconds / 60) }))
        .sort((a, b) => b.total_seconds - a.total_seconds)
        .slice(0, 10);

      console.log(`- ${model} [${deviceId}]`);
      sorted.forEach((item) => {
        console.log(`  • [${item.stream_name}] ${item.app_name}: ${item.total_minutes} min`);
      });
    });
  }

  if (debugAllStreamsForDevice) {
    const streamRows = await queryAllStreamsForDevice(
      databasePath,
      startAppleSeconds,
      endAppleSeconds,
      debugAllStreamsForDevice
    );
    const grouped = new Map();

    streamRows.forEach((row) => {
      const seconds = overlapSeconds(row, dayStartMs, dayEndMs);
      if (seconds <= 0) {
        return;
      }

      const stream = String((row && row.stream_name) || "UNKNOWN");
      const model = String((row && row.device_model) || "UNKNOWN");
      const deviceId = String((row && row.device_id) || "UNKNOWN");
      const key = `${stream}||${model}||${deviceId}`;
      const current = grouped.get(key) || {
        stream_name: stream,
        device_model: model,
        device_id: deviceId,
        total_seconds: 0,
        rows_count: 0
      };
      current.total_seconds += seconds;
      current.rows_count += 1;
      grouped.set(key, current);
    });

    const lines = Array.from(grouped.values())
      .map((item) => ({ ...item, total_minutes: Math.round(item.total_seconds / 60) }))
      .sort((a, b) => b.total_seconds - a.total_seconds)
      .slice(0, 80);

    console.log(`All streams for device filter '${debugAllStreamsForDevice}':`);
    lines.forEach((item) => {
      console.log(
        [
          `- ${item.stream_name}`,
          `${item.device_model}`,
          `[${item.device_id}]`,
          `${item.total_minutes} min`,
          `(${item.rows_count} rader)`
        ].join(" | ")
      );
    });
  }

  let sourceLabel = source;
  if (deviceFilter) {
    sourceLabel = `${sourceLabel}:filter=${deviceFilter}`;
  }
  if (streamAggregation === "best-stream" && selectedStream) {
    sourceLabel = `${sourceLabel}:stream=${selectedStream}`;
  }
  const payload = {
    date: targetDate,
    total_minutes: totalMinutes,
    source: sourceLabel
  };

  console.log(`Dato: ${targetDate}`);
  console.log(`Total skjermtid: ${totalMinutes} min`);
  await postScreenTime(baseUrl, key, payload, dryRun);
}

main().catch((error) => {
  console.error(error && error.message ? error.message : String(error));
  process.exit(1);
});
