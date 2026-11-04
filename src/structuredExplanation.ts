export const explanationSchema = {
  type: "object",
  properties: { summary: { type: "string" }, details: { type: "string" }, takeaway: { type: "string" } },
  required: ["summary", "details", "takeaway"],
  additionalProperties: false
} as const;

/** Validate provider output before converting it to the panel's existing section format. */
export function formatStructuredExplanation(raw: string): string {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("La réponse structurée n'est pas un JSON valide."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("La réponse structurée est invalide.");
  const record = value as Record<string, unknown>;
  const keys = ["summary", "details", "takeaway"] as const;
  if (Object.keys(record).some(key => !keys.includes(key as typeof keys[number])) || keys.some(key => typeof record[key] !== "string")) {
    throw new Error("La réponse structurée ne respecte pas le format attendu.");
  }
  const entries = keys.map(key => [key, (record[key] as string).trim()] as const).filter(([, text]) => text);
  if (!entries.length) throw new Error("La réponse structurée est vide.");
  const labels = { summary: "Résumé", details: "Détails", takeaway: "À retenir" };
  return entries.map(([key, text]) => `${labels[key]}:\n${text}`).join("\n\n");
}
