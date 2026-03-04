function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

function normalizeMakerText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeMakerMessages(payloadMessages) {
  if (!Array.isArray(payloadMessages)) {
    return { error: "Ugyldig payload" };
  }

  const normalized = payloadMessages
    .map((item) => {
      const role = item && typeof item.role === "string" ? item.role.trim() : "";
      const textRaw = item && typeof item.text === "string" ? item.text : "";
      const text = normalizeMakerText(textRaw);
      return { role, text };
    })
    .filter((item) => (item.role === "user" || item.role === "assistant") && item.text !== "");

  if (normalized.length === 0) {
    return { error: "Ugyldig payload" };
  }

  const clipped = normalized.slice(-20).map((item) => ({
    role: item.role,
    text: item.text.slice(0, 5000)
  }));

  return { value: clipped };
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

function makerMessagesToInput(messages) {
  return messages
    .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.text}`)
    .join("\n\n");
}

const MAKER_SYSTEM_INSTRUCTIONS = `
Du er Maker, en avansert AI-assistent for idéarbeid, planlegging, koding og prompt engineering.
Skriv alltid på samme språk som brukeren.

Arbeidsflyt:
1) Når brukeren ber om hjelp til noe nytt: still nøyaktig 3 korte, enkle og relevante avklaringsspørsmål (nummerert 1-3).
2) Når brukeren svarer på spørsmålene: lag én superproff, ferdig prompt de kan bruke direkte.

Kvalitetskrav:
- Vær konkret, praktisk og tydelig.
- Tenk grundig internt, men ikke vis intern resonnementstekst.
- Ikke bruk fyllord. Ingen unødvendige forbehold.
- Hvis informasjon mangler, gjør rimelige antagelser og marker dem tydelig.
`.trim();

async function generateMakerReplyWithOpenAI({ apiKey, model, messages }) {
  if (!apiKey || typeof fetch !== "function") {
    const err = new Error("Maker AI er ikke konfigurert (mangler OPENAI_API_KEY)");
    err.statusCode = 503;
    throw err;
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      instructions: MAKER_SYSTEM_INSTRUCTIONS,
      input: makerMessagesToInput(messages),
      max_output_tokens: 900,
      temperature: 0.5
    })
  });

  if (!response.ok) {
    const err = new Error(`Maker AI svarte ${response.status}`);
    err.statusCode = response.status;
    throw err;
  }

  const data = await response.json();
  const outputText = extractResponseOutputText(data);
  if (!outputText) {
    const err = new Error("Maker AI returnerte tomt svar");
    err.statusCode = 502;
    throw err;
  }

  return outputText;
}

function makerApiKeyFromEvent(event) {
  const envKey = typeof process.env.OPENAI_API_KEY === "string" ? process.env.OPENAI_API_KEY.trim() : "";
  if (envKey) {
    return envKey;
  }

  const headers = event && event.headers && typeof event.headers === "object" ? event.headers : {};
  const headerValue = headers["x-openai-api-key"] || headers["X-OpenAI-Api-Key"] || headers["X-OPENAI-API-KEY"];
  if (typeof headerValue === "string" && headerValue.trim() !== "") {
    return headerValue.trim();
  }

  return "";
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

  const normalized = normalizeMakerMessages(payload && payload.messages);
  if (normalized.error) {
    return json(400, { error: normalized.error });
  }

  const apiKey = makerApiKeyFromEvent(event);
  const model = process.env.OPENAI_MAKER_MODEL || "gpt-4.1";

  try {
    const reply = await generateMakerReplyWithOpenAI({
      apiKey,
      model,
      messages: normalized.value
    });

    return json(200, {
      reply,
      model
    });
  } catch (err) {
    const statusCode = err && err.statusCode ? err.statusCode : 500;
    const message = err && err.message ? err.message : "Maker AI feilet";
    console.error("Maker AI-feil:", message);
    return json(statusCode, { error: message });
  }
};
