import fs from "fs-extra";
import path from "path";
import matter from "gray-matter";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const CHROMA_URL = process.env.CHROMA_URL || "http://localhost:8000";
// ---------------------------------------------------------------------------
// Ollama embedding
// ---------------------------------------------------------------------------
export async function ollamaEmbed(text) {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, prompt: text }),
    });
    if (!res.ok)
        throw new Error(`Ollama embed failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.embedding;
}
export async function ollamaGenerate(prompt, model) {
    const m = model || process.env.OLLAMA_MODEL || "llama3.2";
    const res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m, prompt, stream: false }),
    });
    if (!res.ok)
        throw new Error(`Ollama generate failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return data.response;
}
// ---------------------------------------------------------------------------
// ChromaDB client (REST)
// ---------------------------------------------------------------------------
const COLLECTION = "vault";
const CHROMA_TENANT = "default_tenant";
const CHROMA_DATABASE = "default_database";
function chromaBase() {
    return `${CHROMA_URL}/api/v2/tenants/${CHROMA_TENANT}/databases/${CHROMA_DATABASE}`;
}
async function ensureCollection() {
    const base = chromaBase();
    // get_or_create
    const res = await fetch(`${base}/collections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: COLLECTION, get_or_create: true }),
    });
    if (!res.ok && res.status !== 409) {
        throw new Error(`ChromaDB collection error: ${res.status} ${await res.text()}`);
    }
    // Fetch to get id
    const getRes = await fetch(`${base}/collections/${COLLECTION}`);
    if (!getRes.ok)
        throw new Error(`ChromaDB get collection failed: ${getRes.status}`);
    const col = await getRes.json();
    return col.id;
}
export async function chromaUpsert(chunks) {
    const colId = await ensureCollection();
    const embeddings = await Promise.all(chunks.map((c) => ollamaEmbed(c.text)));
    const res = await fetch(`${chromaBase()}/collections/${colId}/upsert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            ids: chunks.map((c) => c.id),
            embeddings,
            documents: chunks.map((c) => c.text),
            metadatas: chunks.map((c) => c.metadata),
        }),
    });
    if (!res.ok)
        throw new Error(`ChromaDB upsert failed: ${res.status} ${await res.text()}`);
}
export async function chromaQuery(queryText, k = 5, where) {
    const colId = await ensureCollection();
    const embedding = await ollamaEmbed(queryText);
    const body = { query_embeddings: [embedding], n_results: k, include: ["documents", "metadatas", "distances"] };
    if (where)
        body.where = where;
    const res = await fetch(`${chromaBase()}/collections/${colId}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok)
        throw new Error(`ChromaDB query failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    const results = [];
    for (let i = 0; i < data.ids[0].length; i++) {
        results.push({
            id: data.ids[0][i],
            document: data.documents[0][i],
            metadata: data.metadatas[0][i],
            distance: data.distances[0][i],
        });
    }
    return results;
}
export async function chromaDeleteByPath(notePath) {
    const colId = await ensureCollection();
    const res = await fetch(`${chromaBase()}/collections/${colId}/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ where: { path: notePath } }),
    });
    if (!res.ok)
        throw new Error(`ChromaDB delete failed: ${res.status} ${await res.text()}`);
}
function chunkNote(frontmatter, body, noteType) {
    const chunks = [];
    // Frontmatter as one dense chunk — highly searchable
    const fmText = Object.entries(frontmatter)
        .filter(([, v]) => v !== null && v !== "" && v !== false)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("\n");
    if (fmText.trim()) {
        chunks.push({ index: 0, text: fmText, type: "frontmatter" });
    }
    // Body split by H2 headings
    const sections = body.split(/^## /m).filter(Boolean);
    sections.forEach((section, i) => {
        const trimmed = section.trim();
        if (trimmed.length > 50) {
            const chunkType = noteType === "solution" ? "solution" : noteType === "context" ? "context" : "body";
            chunks.push({ index: i + 1, text: trimmed, type: chunkType });
        }
    });
    return chunks;
}
// ---------------------------------------------------------------------------
// Public: embed a single note
// ---------------------------------------------------------------------------
export async function embedNote(vaultPath, notePath) {
    const absPath = path.isAbsolute(notePath) ? notePath : path.join(vaultPath, notePath);
    if (!(await fs.pathExists(absPath)))
        return;
    const raw = await fs.readFile(absPath, "utf-8");
    const { data: frontmatter, content: body } = matter(raw);
    // Determine note type from path
    let noteType = "body";
    if (notePath.includes("/solutions/"))
        noteType = "solution";
    else if (notePath.includes("/contexts/"))
        noteType = "context";
    else if (notePath.includes("/sessions/"))
        noteType = "session";
    const chunks = chunkNote(frontmatter, body, noteType);
    const relPath = path.relative(vaultPath, absPath);
    await chromaUpsert(chunks.map((c) => ({
        id: `${relPath}::${c.index}`,
        text: c.text,
        metadata: {
            path: relPath,
            area: frontmatter.area ?? "unknown",
            type: noteType,
            chunk_type: c.type,
            date: frontmatter.date ?? "",
            project: frontmatter.project ?? "",
            title: frontmatter.title ?? path.basename(relPath, ".md"),
        },
    })));
}
// ---------------------------------------------------------------------------
// Public: embed all notes in vault (for reindex)
// ---------------------------------------------------------------------------
export async function embedAllNotes(vaultPath) {
    const dirs = ["sessions", "solutions", "contexts", "patterns"];
    let count = 0;
    for (const dir of dirs) {
        const dirPath = path.join(vaultPath, dir);
        if (!(await fs.pathExists(dirPath)))
            continue;
        const files = await walkDir(dirPath);
        for (const file of files) {
            if (file.endsWith(".md")) {
                await embedNote(vaultPath, path.relative(vaultPath, file));
                count++;
            }
        }
    }
    return count;
}
async function walkDir(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory())
            files.push(...(await walkDir(full)));
        else
            files.push(full);
    }
    return files;
}
