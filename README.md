# Oles-Brain

Minimumsløsning med frontend + backend:

- Frontend: én side med checkbokser for Oppvaskmaskin, Kreatin og Seng + knapp `Lagre`
- Backend: `POST /entries` + `GET /entries.csv?key=...`
- Database: SQLite (`data/entries.db`) med tabell `entries`

## Kjør

```bash
npm install
npm start
```

Åpne `http://localhost:3000`.

For CSV-endepunkt med nøkkel:

```bash
CSV_KEY=din-hemmelige-nokkel npm start
```

## Endepunkter

`POST /entries`

JSON body:

```json
{
  "date": "YYYY-MM-DD",
  "dishwasher": 0,
  "creatine": 1,
  "bed": 0,
  "note": "valgfri kommentar"
}
```

`GET /entries.csv?key=DIN_KEY`

Returnerer CSV med kolonner:

`Dato,Oppvaskmaskin tømt,Kreatin tatt,Seng redd,Kommentar`
