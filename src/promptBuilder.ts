import { ExplanationMode, PromptInput, ResponseStyle } from "./types";

export function buildPrompt(input: PromptInput, mode: ExplanationMode): string {
  const basePrompt = buildBasePrompt(input);

  if (mode === "simple") {
    return `${basePrompt}

Instruction supplementaire :
Explique ce code comme si j'etais debutant complet.
Utilise des phrases tres simples.
Evite le jargon.
Utilise une analogie seulement si elle aide vraiment.
Reponse courte.`;
  }

  if (mode === "detailed") {
    const format = getResponseFormat(input.responseLanguage);

    return `${basePrompt}

Instruction supplementaire :
Explique ce code plus en profondeur, mais mets ce detail uniquement dans la section ${format.detailsLabel}.
Decris dans ${format.detailsLabel} :
1. son role ;
2. ses entrees ;
3. ses sorties ;
4. les etapes importantes ;
5. les effets de bord possibles ;
6. les bugs ou risques possibles si tu en vois.
Garde la section ${format.takeawayLabel} tres courte : une seule phrase de rappel, sans liste ni nouveaux details.
Reste pedagogique et clair.`;
  }

  return basePrompt;
}

function buildBasePrompt(input: PromptInput): string {
  const { context, responseLanguage, responseStyle } = input;
  const styleInstruction = getStyleInstruction(responseStyle);
  const symbolLine = context.symbolUnderCursor
    ? `Symbole sous le curseur : ${context.symbolUnderCursor}`
    : "Symbole sous le curseur : non detecte";
  const format = getResponseFormat(responseLanguage);
  const relatedContextBlock = context.relatedSnippets.length
    ? `Contexte lie dans le workspace :
${context.relatedSnippets
  .map(
    (snippet, index) => `Extrait ${index + 1} :
- Type : ${snippet.reason}
- Fichier : ${snippet.fileName}
- Langage : ${snippet.languageId}
- Lignes : ${snippet.startLine}-${snippet.endLine}
\`\`\`
${snippet.code}
\`\`\``
  )
  .join("\n\n")}`
    : "Contexte lie dans le workspace : aucun extrait supplementaire utile n'a ete trouve.";

  return `Tu es un assistant pedagogique qui aide des debutants a comprendre du code.
Ton role n'est pas de modifier le code, mais de l'expliquer clairement.

Regles :
- Reponds en ${responseLanguage}.
- Sois clair, simple et direct.
- Explique ce que fait le code.
- Explique pourquoi il existe probablement.
- Si c'est une fonction, explique son role, ses entrees et sa sortie.
- Si c'est une variable, explique ce qu'elle represente.
- Si c'est une ligne, explique ce qu'elle fait dans le contexte.
- Ne sois pas trop long.
- Ne donne pas un cours general inutile.
- Si le contexte est insuffisant, dis-le.
- Ne pretends pas etre sur si tu ne peux pas l'etre.
- Si les extraits lies aident, utilise-les pour expliquer les dependances ou appels voisins.
- Utilise du texte brut. N'ajoute pas de markdown en gras, pas d'etoiles, pas de listes decorees autour des titres.
- Quand un terme est vraiment important pour comprendre le code (fonction, variable, classe, concept cle), entoure-le avec [[double crochets]].
- N'abuse pas de cette mise en valeur : environ 3 a 8 termes importants maximum.
- ${styleInstruction}

Informations :
Langage : ${context.languageId}
Fichier : ${context.fileName}
Ligne : ${context.lineNumber}
${symbolLine}

Code cible :
\`\`\`
${context.selectedCode}
\`\`\`

Contexte autour :
\`\`\`
${context.surroundingCode}
\`\`\`

${relatedContextBlock}

Reponds avec exactement ce format :

${format.summaryLabel}:
[explication tres courte, 1 phrase]

${format.detailsLabel}:
[l'explication principale. Si l'utilisateur demande plus de detail, ajoute le detail ici uniquement]

${format.takeawayLabel}:
[une seule phrase simple qui reformule l'idee principale. Pas de liste. Pas de nouveaux details]`;
}

function getStyleInstruction(style: ResponseStyle): string {
  switch (style) {
    case "technical":
      return "Tu peux etre un peu plus precis techniquement, mais reste lisible pour un debutant motive.";
    case "simple":
      return "Reste tres compact et tres simple, meme si tu dois sacrifier du detail.";
    case "beginner":
    default:
      return "Parle comme a un debutant qui lit du code genere par IA et veut juste comprendre l'essentiel.";
  }
}

function getResponseFormat(language: string): {
  summaryLabel: string;
  detailsLabel: string;
  takeawayLabel: string;
} {
  if (language.toLowerCase().startsWith("en")) {
    return {
      summaryLabel: "Summary",
      detailsLabel: "Details",
      takeawayLabel: "Key takeaway"
    };
  }

  return {
    summaryLabel: "Resume",
    detailsLabel: "Details",
    takeawayLabel: "A retenir"
  };
}
