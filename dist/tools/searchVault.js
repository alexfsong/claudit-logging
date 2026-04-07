import { chromaQuery } from "../embedding/pipeline.js";
export async function searchVault(vaultPath, args) {
    const { query, k = 5, filter_area, filter_type } = args;
    const where = {};
    if (filter_area)
        where.area = filter_area;
    if (filter_type)
        where.type = filter_type;
    const results = await chromaQuery(query, k, Object.keys(where).length > 0 ? where : undefined);
    if (results.length === 0) {
        return {
            content: [{ type: "text", text: `No results found for: "${query}"` }],
        };
    }
    // Group by source note to avoid duplicate paths
    const byPath = new Map();
    for (const r of results) {
        const p = r.metadata.path;
        if (!byPath.has(p) || r.distance < byPath.get(p).distance) {
            byPath.set(p, r);
        }
    }
    const lines = [`SEARCH RESULTS for: "${query}"\n`];
    for (const [notePath, r] of byPath) {
        const score = (1 - r.distance).toFixed(2);
        const meta = r.metadata;
        const preview = r.document.slice(0, 200).replace(/\n/g, " ").trim();
        lines.push(`[${meta.type?.toUpperCase() ?? "NOTE"}] ${notePath}  (relevance: ${score})`);
        if (meta.date)
            lines.push(`  Date: ${meta.date}`);
        if (meta.area)
            lines.push(`  Area: ${meta.area}`);
        lines.push(`  Preview: ${preview}...`);
        lines.push("");
    }
    return {
        content: [{ type: "text", text: lines.join("\n") }],
    };
}
