import { ModelProvider } from "../types";
import { ProviderAdapter } from "./contracts";
import { anthropicAdapter } from "./anthropic";
import { geminiAdapter } from "./gemini";
import { ollamaAdapter } from "./ollama";
import { openAiAdapter } from "./openai";

export const providers: Record<ModelProvider, ProviderAdapter> = {
  openai: openAiAdapter(), meta: openAiAdapter(true), anthropic: anthropicAdapter,
  gemini: geminiAdapter, ollama: ollamaAdapter
};
