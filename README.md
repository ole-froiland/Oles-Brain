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

Google Sheets:

```gs
=IMPORTDATA("https://oles-brain.netlify.app/entries.csv?key=DIN_KEY")
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
