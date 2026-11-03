import { UiLanguage } from "./types";

/** Classify known errors without exposing arbitrary provider text or credentials. */
export async function describeHttpError(response: Response, language: UiLanguage): Promise<string> {
  let details = "";
  try {
    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (details.length < 8192) {
        const chunk = await reader.read();
        if (chunk.done) break;
        details += decoder.decode(chunk.value, { stream: true });
      }
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  } catch { /* Status remains useful even if the error body is unavailable. */ }
  const text = details.toLowerCase();
  const fr = language === "fr";
  if (response.status === 401) return fr ? "Authentification refusée : vérifiez la clé API." : "Authentication failed: check the API key.";
  if (response.status === 403) return fr ? "Accès refusé : vérifiez les droits de la clé et du modèle." : "Access denied: check key and model permissions.";
  if (response.status === 404) return fr ? "Modèle ou endpoint introuvable : vérifiez leur identifiant et leur URL." : "Model or endpoint not found: check the identifier and URL.";
  if (response.status === 402 || /insufficient[_ -]?(quota|credit)|billing|credit balance/.test(text)) return fr ? "Quota ou crédit insuffisant : vérifiez la facturation du fournisseur." : "Insufficient quota or credit: check provider billing.";
  if (response.status === 429) return fr ? "Limite de requêtes ou quota atteint : réessayez plus tard ou vérifiez votre compte." : "Rate limit or quota reached: retry later or check your account.";
  if (response.status === 400 || response.status === 422) return fr ? "La requête ou ses paramètres ne sont pas acceptés par ce modèle." : "The model rejected the request or its parameters.";
  return fr ? `Le fournisseur a renvoyé une erreur HTTP ${response.status}.` : `The provider returned HTTP ${response.status}.`;
}
