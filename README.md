# Oles-Brain

En enkel tracker med:

- frontend i `public/index.html`
- lokal backend i `server.js` (Express + SQLite)
- Netlify backend i `netlify/functions` (lagrer i Netlify Blobs)

## Lokal bruk (dev/test)

Start:

```bash
npm install
npm start
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
