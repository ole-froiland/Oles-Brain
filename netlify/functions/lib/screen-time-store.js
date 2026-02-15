const fs = require("fs/promises");
const path = require("path");
const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "oles-brain";
const SCREEN_TIME_KEY = "screen-time-entries";
const localDbPath = path.join(process.cwd(), "data", "netlify-screen-time.json");

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

async function readFromFile() {
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

async function writeToFile(entries) {
  await fs.mkdir(path.dirname(localDbPath), { recursive: true });
  await fs.writeFile(localDbPath, JSON.stringify(entries, null, 2));
}

async function readScreenTimeEntries(event) {
  if (hasBlobsContext(event)) {
    const store = getBlobStore(event);
    const entries = await store.get(SCREEN_TIME_KEY, { type: "json" });
    return Array.isArray(entries) ? entries : [];
  }

  return readFromFile();
}

async function writeScreenTimeEntries(event, entries) {
  if (hasBlobsContext(event)) {
    const store = getBlobStore(event);
    await store.setJSON(SCREEN_TIME_KEY, entries);
    return;
  }

  if (process.env.NETLIFY === "true") {
    throw new Error("Netlify Blobs context mangler. Aktiver Blobs for siten i Netlify.");
  }

  await writeToFile(entries);
}

module.exports = {
  readScreenTimeEntries,
  writeScreenTimeEntries
};
