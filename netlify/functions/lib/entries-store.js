const fs = require("fs/promises");
const path = require("path");
const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "oles-brain";
const ENTRIES_KEY = "entries";
const localDbPath = path.join(process.cwd(), "data", "netlify-entries.json");

function hasBlobsContext(event) {
  try {
    connectLambda(event);
  } catch (_) {
    // Ignore: connectLambda is only needed in Lambda compatibility mode.
  }

  return Boolean(process.env.NETLIFY_BLOBS_CONTEXT || globalThis.netlifyBlobsContext);
}

function getBlobStore(event) {
  try {
    connectLambda(event);
  } catch (_) {
    // Ignore: connectLambda is only needed in Lambda compatibility mode.
  }

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
  if (hasBlobsContext(event)) {
    const store = getBlobStore(event);
    const entries = await store.get(ENTRIES_KEY, { type: "json" });
    return Array.isArray(entries) ? entries : [];
  }

  return readEntriesFromFile();
}

async function writeEntries(event, entries) {
  if (hasBlobsContext(event)) {
    const store = getBlobStore(event);
    await store.setJSON(ENTRIES_KEY, entries);
    return;
  }

  if (process.env.NETLIFY === "true") {
    throw new Error("Netlify Blobs context mangler. Aktiver Blobs for siten i Netlify.");
  }

  await writeEntriesToFile(entries);
}

module.exports = {
  readEntries,
  writeEntries
};
