const fs = require("fs/promises");
const path = require("path");
const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "oles-brain";
const ENTRIES_KEY = "entries";
const localDbPath = path.join(process.cwd(), "data", "netlify-entries.json");

function hasBlobsContext() {
  return Boolean(process.env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext);
}

function getBlobStore(event) {
  connectLambda(event);
  return getStore(STORE_NAME);
}

async function readEntriesFromFile() {
  try {
    const raw = await fs.readFile(localDbPath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") {
      return [];
    }

    throw err;
  }
}

async function writeEntriesToFile(entries) {
  await fs.mkdir(path.dirname(localDbPath), { recursive: true });
  await fs.writeFile(localDbPath, JSON.stringify(entries, null, 2));
}

async function readEntries(event) {
  if (hasBlobsContext()) {
    const store = getBlobStore(event);
    const entries = await store.get(ENTRIES_KEY, { type: "json" });
    return Array.isArray(entries) ? entries : [];
  }

  return readEntriesFromFile();
}

async function writeEntries(event, entries) {
  if (hasBlobsContext()) {
    const store = getBlobStore(event);
    await store.setJSON(ENTRIES_KEY, entries);
    return;
  }

  await writeEntriesToFile(entries);
}

module.exports = {
  readEntries,
  writeEntries
};
