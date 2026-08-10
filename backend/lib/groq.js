// Groq LLM client (OpenAI-compatible chat completions).
// The API key never leaves the backend — the frontend only talks to our API.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const chatCompletion = async ({
  system,
  messages = [],
  temperature = 0.2,
  maxTokens = 700,
}) => {
  if (!process.env.GROQ_API_KEY) {
    return { ok: false, error: "GROQ_API_KEY is not configured on the server." };
  }

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
        temperature,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages],
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const message = json?.error?.message || `Groq request failed (${res.status})`;
      console.error("Groq error:", message);
      return { ok: false, error: message };
    }

    return {
      ok: true,
      answer: json.choices?.[0]?.message?.content || "",
      model: json.model,
      usage: json.usage || null,
    };
  } catch (err) {
    console.error("Groq exception:", err.message);
    return { ok: false, error: "Could not reach the AI service." };
  }
};

module.exports = { chatCompletion };
