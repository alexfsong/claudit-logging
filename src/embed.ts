/**
 * Embeddings via Ollama (optional). Falls back gracefully — search still works
 * via FTS5 when Ollama is unavailable.
 */

const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";

let ollamaAvailable: boolean | null = null;

async function checkOllama(): Promise<boolean> {
  if (ollamaAvailable !== null) return ollamaAvailable;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    ollamaAvailable = res.ok;
  } catch {
    ollamaAvailable = false;
  }
  return ollamaAvailable;
}

export async function embed(text: string): Promise<number[] | null> {
  if (!(await checkOllama())) return null;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[] };
    return data.embedding ?? null;
  } catch {
    return null;
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Generate embedding text from a knowledge item for indexing.
 */
export function knowledgeEmbedText(args: {
  title: string;
  content: string;
  code?: string | null;
  tags?: string[] | null;
}): string {
  const parts = [args.title, args.content];
  if (args.code) parts.push(args.code.slice(0, 500));
  if (args.tags?.length) parts.push(args.tags.join(" "));
  return parts.join("\n");
}
