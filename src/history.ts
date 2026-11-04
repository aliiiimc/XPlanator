import { randomUUID } from "node:crypto";
import { ConversationTurn } from "./conversation";
import { CodeContext, ExplanationMode } from "./types";

export interface HistoryEntry {
  id: string;
  updatedAt: string;
  context: CodeContext;
  model: string;
  profileName: string;
  mode: ExplanationMode;
  originalExplanation: string;
  turns: ConversationTurn[];
  usageInfo?: string;
}

interface Store { get<T>(key: string): T | undefined; update(key: string, value: unknown): Thenable<void> }
const storageKey = "xplanator.history.v1";

/** Local, opt-in history. Source snapshots are retained only after explicit opt-in. */
export class HistoryRepository {
  constructor(private readonly state: Store) {}
  list(): HistoryEntry[] { return this.state.get<HistoryEntry[]>(storageKey) ?? []; }

  async save(entry: Omit<HistoryEntry, "id" | "updatedAt"> & { id?: string }, enabled: boolean, limit: number): Promise<HistoryEntry | undefined> {
    const answers = [entry.originalExplanation, ...entry.turns.flatMap(turn => [turn.question, turn.answer])].join("\n");
    if (!enabled || looksSensitive(entry.context) || containsCredential(answers)) return undefined;
    const item: HistoryEntry = { ...entry, id: entry.id ?? randomUUID(), updatedAt: new Date().toISOString() };
    const count = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit))) : 20;
    await this.state.update(storageKey, [item, ...this.list().filter(existing => existing.id !== item.id)].slice(0, count));
    return item;
  }

  async remove(id: string): Promise<void> { await this.state.update(storageKey, this.list().filter(entry => entry.id !== id)); }
  async clear(): Promise<void> { await this.state.update(storageKey, []); }
}

/** Best effort only: this cannot identify every sensitive document or credential. */
export function looksSensitive(context: CodeContext): boolean {
  const paths = [context.filePath, ...context.relatedSnippets.map(snippet => snippet.filePath)];
  if (paths.some(value => /(?:^|[\\/])(?:\.env(?:\..*)?|\.aws|\.ssh|credentials|secrets?)(?:[\\/]|$)/i.test(value))) return true;
  const text = [context.selectedCode, context.surroundingCode, ...context.relatedSnippets.map(snippet => snippet.code)].join("\n");
  return containsCredential(text);
}

function containsCredential(text: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/i.test(text);
}

export function historyAsMarkdown(entry: HistoryEntry): string {
  const lines = [
    `# ${entry.context.fileName.replace(/[\r\n]/g, " ")}`,
    "", `- Date: ${entry.updatedAt}`, `- Model: ${entry.model}`, `- Profile: ${entry.profileName}`,
    `- Lines: ${entry.context.startLine}–${entry.context.endLine}`, "", "## Explanation", "", entry.originalExplanation
  ];
  for (const turn of entry.turns) lines.push("", "## Question", "", turn.question, "", "## Answer", "", turn.answer);
  return `${lines.join("\n")}\n`;
}
