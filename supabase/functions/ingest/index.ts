import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders, json } from "../_shared/cors.ts";
import { embedTexts } from "../_shared/gemini.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MAX_TITLE_LEN = 200;
const MAX_CONTENT_LEN = 200000;
const MAX_CHUNKS = 200;
const CHUNK_SIZE = 1400;
const CHUNK_OVERLAP = 150;
const BATCH_SIZE = 90; // max requests per batchEmbedContents call

/** Split long text into overlapping chunks, breaking on paragraph/sentence/word boundaries. */
export function chunkText(text: string): string[] {
  const cleaned = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "");
  if (cleaned.length <= CHUNK_SIZE) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    let end = Math.min(start + CHUNK_SIZE, cleaned.length);
    if (end < cleaned.length) {
      // back off to a sentence, paragraph or word boundary
      const cut = cleaned.lastIndexOf("\n\n", end);
      const sent = cut > start + 200 ? cut : cleaned.lastIndexOf(". ", end);
      const wb = sent > start + 200 ? sent : cleaned.lastIndexOf(" ", end);
      if (wb > start + 100) end = wb + 1;
    }
    chunks.push(cleaned.slice(start, end).trim());
    if (end >= cleaned.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
    if (cleaned.length - start <= 0) break;
  }
  return chunks.filter((c) => c.length > 0).slice(0, MAX_CHUNKS);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function extractPdfText(pdfBase64: string): Promise<string> {
  const pdfjsLib: any = await import(
    "https://esm.sh/pdfjs-dist@3.11.174/legacy/build/pdf.mjs?deps=esm.sh,v138"
  );
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://esm.sh/pdfjs-dist@3.11.174/legacy/build/pdf.worker.min.mjs?deps=esm.sh,v138";

  const data = base64ToBytes(pdfBase64);
  const pdf = await pdfjsLib.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    disableWorker: true,
  }).promise;

  const pages: string[] = [];
  for (let p = 1; p <= pdf.numPages; p += 1) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => (typeof item.str === "string" ? item.str : ""))
      .join(" ");
    pages.push(text);
  }
  await pdf.destroy().catch(() => {});
  return pages.join("\n");
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new Error("Missing authorization header");
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) throw new Error("Unauthorized");
    var user = data.user;
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad JSON body" }, 400);
  }

  const title = String(body?.title ?? "").trim();
  if (!title) return json({ error: "title is required" }, 400);
  if (title.length > MAX_TITLE_LEN) {
    return json({ error: `title must be under ${MAX_TITLE_LEN} characters` }, 400);
  }

  let content = "";
  if (typeof body?.content === "string" && body.content.trim()) {
    content = body.content.trim();
  } else if (typeof body?.pdfBase64 === "string" && body.pdfBase64) {
    try {
      content = await extractPdfText(body.pdfBase64);
    } catch (e) {
      return json({
        error: "Couldn't read this PDF: " + (e instanceof Error ? e.message : "parse failed"),
      }, 400);
    }
  }
  if (!content.trim()) return json({ error: "content or pdfBase64 is required" }, 400);
  if (content.length > MAX_CONTENT_LEN) {
    return json({ error: `content is too long (max ${MAX_CONTENT_LEN} characters)` }, 400);
  }

  // Chunk + embed + insert
  const chunks = chunkText(content);
  const rows: Array<{
    title: string;
    content: string;
    embedding: number[];
    uploaded_by: string;
  }> = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const slice = chunks.slice(i, i + BATCH_SIZE);
    let vectors: number[][];
    try {
      vectors = await embedTexts(slice);
    } catch (e) {
      return json({ error: "Embedding service unavailable: " + (e as Error).message }, 500);
    }
    for (let j = 0; j < slice.length; j += 1) {
      rows.push({ title, content: slice[j], embedding: vectors[j] ?? [], uploaded_by: user.id });
    }
  }

  const { error: insertErr } = await supabase.from("documents").insert(rows);
  if (insertErr) {
    return json({ error: "Failed to store documents: " + insertErr.message }, 500);
  }

  return json({ chunksStored: rows.length, title });
}