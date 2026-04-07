import { embedAllNotes } from "../embedding/pipeline.js";
export async function reindexVault(vaultPath) {
    const count = await embedAllNotes(vaultPath);
    return {
        content: [{ type: "text", text: `Reindex complete. Embedded ${count} notes.` }],
    };
}
