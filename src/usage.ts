import { GenerationUsage } from "./aiStream";
import { UiLanguage } from "./types";

/** Only provider-reported counters are presented as measured usage. */
export function formatUsage(usage: GenerationUsage, durationMs: number, language: UiLanguage): string {
  const fr = language === "fr";
  const values: string[] = [];
  if (usage.model) values.push(`${fr ? "Modèle déclaré" : "Reported model"}: ${usage.model}`);
  const add = (label: string, value: number | undefined): void => {
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) values.push(`${label}: ${value}`);
  };
  add(fr ? "Tokens entrée" : "Input tokens", usage.inputTokens);
  add(fr ? "Tokens sortie" : "Output tokens", usage.outputTokens);
  add(fr ? "Tokens raisonnement" : "Reasoning tokens", usage.reasoningTokens);
  values.push(`${fr ? "Durée" : "Duration"}: ${(Math.max(0, durationMs) / 1000).toFixed(1)} s`);
  values.push(fr ? "Coût indisponible" : "Cost unavailable");
  return values.join(" · ");
}
