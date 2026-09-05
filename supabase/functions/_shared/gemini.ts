const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";

export const EMBED_MODEL = Deno.env.get("EMBEDDING_MODEL") ?? "text-embedding-004";
export const CHAT_MODEL = Deno.env.get("GEMINI_MODEL") ?? "gemini-2.0-flash";

function geminiBase() {
  return `https://generativelanguage.googleapis.com/v1beta/models`;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `${geminiBase()}/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBED_MODEL}`,
          content: { parts: [{ text }] },
        })),
      }),
    }
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${msg.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.embeddings ?? []).map((entry: any) => entry.values as number[]);
}

export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(
    `${geminiBase()}/${EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text }] },
      }),
    }
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Embedding failed (${res.status}): ${msg.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.embedding?.values as number[] | undefined ?? [];
}