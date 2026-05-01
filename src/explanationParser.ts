import { UiLanguage } from "./types";

export interface ExplanationSections {
  summary: string;
  details: string;
  takeaway: string;
}

interface TakeawayNormalization {
  details: string;
  takeaway: string;
}

export function parseExplanation(raw: string, language: UiLanguage): ExplanationSections {
  const normalized = sanitizeModelOutput(raw.replace(/\r\n/g, "\n").trim());
  const summary = extractSection(normalized, ["Resume", "Résumé", "Summary"]);
  const details = extractSection(normalized, ["Details", "Détails"]);
  const takeaway = extractSection(normalized, ["A retenir", "À retenir", "Key takeaway", "Takeaway"]);
  const text = getParserText(language);
  const normalizedTakeaway = keepTakeawayShort(details, takeaway);

  if (summary || details || takeaway) {
    return {
      summary: summary || text.noDistinctSummary,
      details: normalizedTakeaway.details || normalized,
      takeaway: normalizedTakeaway.takeaway || text.defaultTakeaway
    };
  }

  return {
    summary: normalized.split("\n")[0] || text.explanationAvailableBelow,
    details: normalized,
    takeaway: text.reviewTakeaway
  };
}

export function stripHighlightMarkers(value: string): string {
  return value.replace(/\[\[([^[\]]+)\]\]/g, "$1");
}

function keepTakeawayShort(details: string, takeaway: string): TakeawayNormalization {
  if (!takeaway) {
    return {
      details,
      takeaway
    };
  }

  const { compact, overflow } = splitTakeawayOverflow(takeaway);
  return {
    details: appendOverflowToDetails(details, overflow),
    takeaway: compact
  };
}

function splitTakeawayOverflow(value: string): { compact: string; overflow: string } {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return {
      compact: "",
      overflow: ""
    };
  }

  const splitFirstLine = splitCompactSentence(lines[0]);
  const overflowLines = [splitFirstLine.overflow, ...lines.slice(1)].filter(Boolean);

  return {
    compact: splitFirstLine.compact,
    overflow: overflowLines.join("\n")
  };
}

function splitCompactSentence(value: string): { compact: string; overflow: string } {
  const maxTakeawayLength = 180;
  const singleLine = value.replace(/\s+/g, " ").trim();
  const sentenceMatch = singleLine.match(/^(.+?[.!?])\s+(.+)$/);

  if (sentenceMatch) {
    return {
      compact: sentenceMatch[1].trim(),
      overflow: sentenceMatch[2].trim()
    };
  }

  if (singleLine.length <= maxTakeawayLength) {
    return {
      compact: singleLine,
      overflow: ""
    };
  }

  const cutAt = singleLine.lastIndexOf(" ", maxTakeawayLength);
  const safeCutAt = cutAt > 80 ? cutAt : maxTakeawayLength;

  return {
    compact: singleLine.slice(0, safeCutAt).trim(),
    overflow: singleLine.slice(safeCutAt).trim()
  };
}

function appendOverflowToDetails(details: string, overflow: string): string {
  if (!overflow) {
    return details;
  }

  if (!details) {
    return overflow;
  }

  return `${details}\n\n${overflow}`;
}

function extractSection(content: string, labels: string[]): string {
  const alternation = labels
    .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(
    `(?:^|\\n)\\*{0,2}\\s*(?:${alternation})\\s*:?\\s*\\*{0,2}\\s*([\\s\\S]*?)(?=\\n\\*{0,2}\\s*(?:Resume|Résumé|Summary|Details|Détails|A retenir|À retenir|Key takeaway|Takeaway)\\s*:?\\s*\\*{0,2}|$)`,
    "i"
  );
  const match = content.match(regex);
  return sanitizeModelOutput(match?.[1]?.trim() ?? "");
}

function sanitizeModelOutput(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/^[*-]\s+/gm, "")
    .trim();
}

function getParserText(language: UiLanguage): Record<string, string> {
  if (language === "en") {
    return {
      noDistinctSummary: "The model did not provide a separate summary.",
      defaultTakeaway: "The main idea is already captured in the details above.",
      explanationAvailableBelow: "Explanation available below.",
      reviewTakeaway: "Re-read the target snippet and the details to confirm your understanding."
    };
  }

  return {
    noDistinctSummary: "Le modèle n'a pas fourni de résumé distinct.",
    defaultTakeaway: "L'idée principale est déjà dans les détails ci-dessus.",
    explanationAvailableBelow: "Explication disponible ci-dessous.",
    reviewTakeaway: "Relis surtout le bloc cible et les détails pour confirmer ton intuition."
  };
}
