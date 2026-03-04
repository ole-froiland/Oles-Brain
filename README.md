# Oles-Brain

En enkel tracker med:

- frontend i `public/index.html`
- lokal backend i `server.js` (Express + SQLite)
- Netlify backend i `netlify/functions` (lagrer i Netlify Blobs)
- kalenderknapp for å velge tidligere dato og registrere glemt oppgave

## Lokal bruk (dev/test)

Start:

```bash
npm install
npm start
```

Valgfritt (for egen nøkkel på skjermtid lokalt):

```bash
SCREEN_TIME_KEY=DIN_KEY npm start
```

Bruk app:

- `http://localhost:3000/`

Hent CSV:

- `http://localhost:3000/entries.csv?key=DIN_KEY`
- `http://localhost:3000/notes.csv?key=DIN_KEY`

Stopp:

```bash
kill $(lsof -ti tcp:3000) 2>/dev/null || true
```

## Netlify bruk (prod)

Deploy repoet til Netlify (publish: `public`, functions: `netlify/functions`).

Sett env var i Netlify:

- `CSV_KEY=DIN_KEY` (eller din egen nøkkel)
- `RESET_KEY=DIN_KEY` (eller egen nøkkel for reset)
- `SCREEN_TIME_KEY=DIN_KEY` (egen nøkkel for skjermtid-import fra mobil)

Bruk app i prod:

- `https://oles-brain.netlify.app/`

Hent CSV i prod:

- `https://oles-brain.netlify.app/entries.csv?key=DIN_KEY`
- `https://oles-brain.netlify.app/notes.csv?key=DIN_KEY`

Google Sheets:

```gs
=IMPORTDATA("https://oles-brain.netlify.app/entries.csv?key=DIN_KEY")
```

Google Sheets (egen fane `Notater`):

```gs
=IMPORTDATA("https://oles-brain.netlify.app/notes.csv?key=DIN_KEY")
```

## Endepunkter

`POST /entries`

```json
{
  "date": "YYYY-MM-DD",
  "dishwasher": 0,
  "creatine": 1,
  "omega3": 1,
  "bed": 0,
  "note": "valgfri kommentar"
}
```

`GET /entries.csv?key=DIN_KEY`

`GET /notes.csv?key=DIN_KEY`

`POST /entries/reset?key=DIN_KEY` nullstiller alle lagrede entries.

`GET /entries/today?date=YYYY-MM-DD` returnerer dagens status (for å skjule ferdige oppgaver i UI).

`POST /screen-time?key=DIN_KEY`

```json
{
  "date": "YYYY-MM-DD",
  "total_minutes": 182,
  "pickups": 74,
  "source": "ios-shortcuts"
}
```

- `date` er valgfri (default = i dag)
- `pickups` er valgfri

`GET /screen-time/today?date=YYYY-MM-DD` returnerer skjermtid for valgt dato.

## iPhone Shortcut (skjermtid til Oles-Brain)

1. Lag en Shortcut som henter dagens skjermtid (f.eks. total minutter + antall pickups).
2. Legg til `Get Contents of URL` med:
   - URL: `https://oles-brain.netlify.app/screen-time?key=DIN_KEY`
   - Method: `POST`
   - Request Body (JSON):
     - `date`: `Current Date` formatert som `yyyy-MM-dd`
     - `total_minutes`: heltall
     - `pickups`: heltall (valgfri)
     - `source`: `"ios-shortcuts"`
3. Kjør shortcuten manuelt eller via automasjon (f.eks. hver kveld).

## Automatisk fra Mac (uten manuell input)

Dette sender gårsdagens skjermtid til Oles-Brain hver morgen.

Moduser:
- `mac-db` (default): leser fra `knowledgeC.db` på Mac.
- `iphone-db`: leser iPhone-data fra `knowledgeC.db` med streams `/app/usage,/app/webUsage,/app/mediaUsage`, filter `iphone`, strategi `best-stream`. Hvis DB ikke har iPhone-rader, fallbacker den automatisk til `iphone-ui`.
- `iphone-ui`: åpner Skjermtid i System Settings, velger iPhone + `I går`, og leser `Bruk`-tallet.

Merk:
- Hvis `iphone-db` ikke finner iPhone-rader i DB, bruk `iphone-ui` som fallback.

Valgfrie flagg i install-script:
- `--streams "/app/usage,/app/webUsage,/app/mediaUsage"`
- `--aggregation best-stream` eller `--aggregation sum`
- `--device-filter iphone`
- `--ui-fallback true|false` (default `true` i `iphone-db`)

1. Gi nødvendige rettigheter:
   - `System Settings` -> `Privacy & Security` -> `Full Disk Access`
   - For `iphone-ui` trenger du også `Accessibility` for appen/binæren som kjører jobben (`node`/Terminal, og ved behov `/usr/bin/osascript`).
   - For `iphone-ui` må Mac være innlogget med aktiv brukerøkt når jobben kjører.
2. Installer daglig jobb kl. 07:00:

```bash
cd /Users/ole-froiland/Desktop/Oles-Brain
./scripts/install-screen-time-launchd.sh --key DIN_KEY --url https://oles-brain.netlify.app --hour 7 --minute 0
```

3. iPhone-only (UI-modus):

```bash
cd /Users/ole-froiland/Desktop/Oles-Brain
./scripts/install-screen-time-launchd.sh --key DIN_KEY --url https://oles-brain.netlify.app --hour 7 --minute 0 --mode iphone-ui --ui-device iphone
```

4. iPhone-only (DB-modus, anbefalt først):

```bash
cd /Users/ole-froiland/Desktop/Oles-Brain
./scripts/install-screen-time-launchd.sh --key DIN_KEY --url https://oles-brain.netlify.app --hour 7 --minute 0 --mode iphone-db
```

5. Kjør test med en gang:

```bash
launchctl kickstart -k gui/$(id -u)/com.olesbrain.screen-time-sync
```

6. Se logg:

```bash
tail -n 80 data/screen-time-sync.log
tail -n 80 data/screen-time-sync.err.log
```
