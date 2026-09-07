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

const KB_BUCKET = "kb-files";
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"]);
const OFFICE_EXTS = new Set([".docx", ".pptx", ".xlsx"]);

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

function officeMimeOf(ext: string): string {
  switch (ext) {
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default:
      return "application/octet-stream";
  }
}

function randomUuid(): string {
  return crypto.randomUUID();
}

async function describeImage(imageBase64: string, mime: string): Promise<string> {
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash";
  const key = Deno.env.get("GEMINI_API_KEY") ?? "";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              text:
                "Describe this image in detail for a searchable knowledge base. " +
                "Include all readable text, subjects, context, and purpose.",
            },
            { inline_data: { mime_type: mime, data: imageBase64 } },
          ],
        }],
      }),
    }
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(`Vision failed (${res.status}): ${msg.slice(0, 200)}`);
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts)
    ? parts.map((p: any) => (typeof p?.text === "string" ? p.text : "")).join(" ")
    : "";
  return text.trim() || "(An image that could not be described automatically.)";
}

async function extractOfficeText(b64: string, kind: string): Promise<string> {
  const JSZip: any = await import("https://esm.sh/jszip@3.10.1");
  const zip = await JSZip.loadAsync(base64ToBytes(b64));
  const strip = (xml: string) =>
    xml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

  if (kind === "docx") {
    const file = zip.file("word/document.xml");
    if (!file) return "";
    const xml: string = await file.async("text");
    return xml.split(/<\/w:p>/).map((p) => strip(p)).filter(Boolean).join("\n");
  }

  if (kind === "pptx") {
    const names = Object.keys(zip.files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => {
        const na = parseInt(a.match(/slide(\d+)/)?.[1] ?? "0", 10);
        const nb = parseInt(b.match(/slide(\d+)/)?.[1] ?? "0", 10);
        return na - nb;
      });
    const out: string[] = [];
    for (const name of names) {
      const xml: string = await zip.file(name)!.async("text");
      out.push(strip(xml));
    }
    return out.join("\n");
  }

  if (kind === "xlsx") {
    const shared = zip.file("xl/sharedStrings.xml");
    const texts: string[] = [];
    const seen = new Set<string>();
    if (shared) {
      const xml: string = await shared.async("text");
      for (const m of xml.matchAll(/<t[^<]*>([\s\S]*?)<\/t>/g)) {
        const t = strip(m[1]);
        if (t && !seen.has(t)) {
          seen.add(t);
          texts.push(t);
        }
      }
    }
    if (texts.length) return texts.join("\n");
    const cells: string[] = [];
    const sheets = Object.keys(zip.files)
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort();
    for (const name of sheets) {
      const xml: string = await zip.file(name)!.async("text");
      for (const m of xml.matchAll(/<v>([^<]*)<\/v>/g)) {
        const v = m[1].trim();
        if (v) cells.push(v);
      }
    }
    return cells.join("\n");
  }
  return "";
}

async function storeOriginal(
  b64: string,
  mime: string,
  name: string,
  userId: string,
  kind: string
): Promise<{
  file_path: string;
  file_mime: string;
  file_size: number;
  file_name: string;
  file_kind: string;
  url: string;
}> {
  const ext = extOf(name) || ".bin";
  const path = `${userId}/${randomUuid()}${ext}`;
  const bytes = base64ToBytes(b64);
  const { error } = await supabase.storage.from(KB_BUCKET).upload(path, bytes, {
    contentType: mime,
    upsert: true,
  });
  if (error) throw new Error("Failed to store original file: " + error.message);
  return {
    file_path: path,
    file_mime: mime,
    file_size: bytes.length,
    file_name: name,
    file_kind: kind,
    url: `${SUPABASE_URL}/storage/v1/object/public/${KB_BUCKET}/${path}`,
  };
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

async function handler(req: Request): Promise<Response> {
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
  let file:
    | {
        file_path: string;
        file_mime: string;
        file_size: number;
        file_name: string;
        file_kind: string;
        url: string;
      }
    | undefined;

  const fileName = String(body?.fileName ?? title);
  const ext = extOf(fileName);
  const isOffice = OFFICE_EXTS.has(ext);
  const isImage = IMAGE_EXTS.has(ext) || (typeof body?.imageBase64 === "string" && !!body.imageBase64);

  try {
    if (typeof body?.content === "string" && body.content.trim()) {
      content = body.content.trim();
    } else if (typeof body?.pdfBase64 === "string" && body.pdfBase64) {
      content = await extractPdfText(body.pdfBase64);
      file = await storeOriginal(body.pdfBase64, "application/pdf", fileName, user.id, "pdf");
    } else if (typeof body?.imageBase64 === "string" && body.imageBase64) {
      const mime = typeof body?.mime === "string" && body.mime
        ? body.mime
        : (isImage && ext ? "image/" + ext.slice(1) : "image/png");
      content = await describeImage(body.imageBase64, mime);
      file = await storeOriginal(body.imageBase64, mime, fileName, user.id, "image");
    } else if (typeof body?.officeBase64 === "string" && body.officeBase64 && isOffice) {
      const kind = ext.slice(1); // docx | pptx | xlsx
      const mime = typeof body?.mime === "string" && body.mime ? body.mime : officeMimeOf(ext);
      content = await extractOfficeText(body.officeBase64, kind);
      if (!content.trim()) throw new Error("Couldn't extract any text from this document");
      file = await storeOriginal(body.officeBase64, mime, fileName, user.id, kind);
    }
  } catch (e) {
    return json({
      error: "Couldn't read this file: " + (e instanceof Error ? e.message : "parse failed"),
    }, 400);
  }

  if (!content.trim()) {
    return json({ error: "content, pdfBase64, imageBase64, or officeBase64 is required" }, 400);
  }
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
      rows.push({
        title,
        content: slice[j],
        embedding: vectors[j] ?? [],
        uploaded_by: user.id,
        ...(file
          ? {
              file_path: file.file_path,
              file_mime: file.file_mime,
              file_size: file.file_size,
              file_name: file.file_name,
              file_kind: file.file_kind,
            }
          : {}),
      });
    }
  }

  const { error: insertErr } = await supabase.from("documents").insert(rows);
  if (insertErr) {
    return json({ error: "Failed to store documents: " + insertErr.message }, 500);
  }

  if (file) {
    return json({
      chunksStored: rows.length,
      title,
      url: file.url,
      mime: file.file_mime,
      name: file.file_name,
      kind: file.file_kind,
    });
  }
  return json({ chunksStored: rows.length, title });
}

Deno.serve(handler);