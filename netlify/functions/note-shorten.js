function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
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

async function shortenNoteWithOpenAI(rawText, apiKey, model) {
  if (!apiKey || typeof fetch !== "function") {
    return null;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
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

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        Allow: "POST",
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (_) {
    return json(400, { error: "Ugyldig payload" });
  }

  if (!payload || typeof payload.text !== "string") {
    return json(400, { error: "Ugyldig payload" });
  }

  const inputText = normalizeSingleLine(payload.text);
  if (!inputText) {
    return json(200, { short_text: "" });
  }

  const apiKey = typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
  const model = process.env.OPENAI_NOTE_MODEL || "gpt-4.1-mini";

  let shortText = shortenNoteHeuristic(inputText);
  if (apiKey) {
    try {
      const aiText = await shortenNoteWithOpenAI(inputText, apiKey, model);
      if (aiText) {
        shortText = shortenNoteHeuristic(aiText) || shortText;
      }
    } catch (err) {
      console.error("Kunne ikke forkorte notat med AI:", err && err.message ? err.message : err);
    }
  }

  return json(200, { short_text: shortText });
};
