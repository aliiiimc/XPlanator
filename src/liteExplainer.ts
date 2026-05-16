import { CodeContext, ExplanationMode, UiLanguage } from "./types";

type LiteKind =
  | "function"
  | "class"
  | "import_export"
  | "conditional"
  | "loop"
  | "assignment"
  | "call"
  | "unknown";

interface LiteFacts {
  kind: LiteKind;
  names: string[];
  parameters: string[];
  returns: string[];
  exits: string[];
  branches: string[];
  loops: string[];
  asyncSignals: string[];
  calls: string[];
  imports: string[];
  exports: string[];
  assignments: string[];
  sideEffects: string[];
  risks: string[];
  importantIdentifiers: string[];
  lineCount: number;
  confidence: "high" | "medium" | "low";
}

interface DetectionResult {
  kind: LiteKind;
  names: string[];
  parameters: string[];
}

const callKeywordExclusions = new Set([
  "if",
  "for",
  "while",
  "switch",
  "catch",
  "function",
  "return",
  "class",
  "new",
  "super",
  "constructor",
  "sizeof",
  "typeof",
  "def",
  "func",
  "fn",
  "match"
]);

export function explainWithLite(context: CodeContext, mode: ExplanationMode, language: UiLanguage): string {
  const facts = analyzeLiteFacts(context);
  const isEnglish = language === "en";
  const labels = getLabels(language);
  const summary = buildSummary(facts, context, mode, isEnglish);
  const details = buildDetails(facts, context, mode, isEnglish);
  const takeaway = buildTakeaway(facts, mode, isEnglish);

  return `${labels.summary}:
${summary}

${labels.details}:
${details}

${labels.takeaway}:
${takeaway}`;
}

function analyzeLiteFacts(context: CodeContext): LiteFacts {
  const code = context.selectedCode.trim();
  const lines = code.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const detection = detectPrimaryShape(code, context.languageId);
  const returns = collectMatches(code, /\breturn\s+([^;\n\r]+)/g, 1, 4);
  const arrowReturn = returns.length ? [] : collectMatches(code, /=>\s*([^{}\n\r;]+)/g, 1, 1);
  const exits = unique([
    ...findKeywordSignals(code, [
      ["throw", /\bthrow\b/],
      ["raise", /\braise\b/],
      ["yield", /\byield\b/],
      ["break", /\bbreak\b/],
      ["continue", /\bcontinue\b/]
    ])
  ]);
  const branches = unique(findKeywordSignals(code, [
    ["if", /\bif\b/],
    ["else", /\belse\b/],
    ["switch", /\bswitch\b/],
    ["case", /\bcase\b/],
    ["match", /\bmatch\b/],
    ["ternary", /\?.*:/s]
  ]));
  const loops = unique(findKeywordSignals(code, [
    ["for", /\bfor\b/],
    ["while", /\bwhile\b/],
    ["forEach", /\.forEach\s*\(/],
    ["map", /\.map\s*\(/],
    ["filter", /\.filter\s*\(/],
    ["reduce", /\.reduce\s*\(/]
  ]));
  const asyncSignals = unique(findKeywordSignals(code, [
    ["async", /\basync\b/],
    ["await", /\bawait\b/],
    ["Promise", /\bPromise\b/],
    ["Future", /\bFuture\b/],
    ["Task", /\bTask\b/]
  ]));
  const imports = lines.filter((line) =>
    /^(import\b|from\b.+\bimport\b|#include\b|using\b|require\s*\()/i.test(line)
  ).slice(0, 4);
  const exports = lines.filter((line) => /^export\b/i.test(line)).slice(0, 4);
  const assignments = detectAssignments(lines);
  const calls = detectCalls(code);
  const sideEffects = detectSideEffects(code, assignments);
  const risks = detectRisks(code, asyncSignals, sideEffects);
  const importantIdentifiers = unique([
    ...detection.names,
    ...detection.parameters,
    ...assignments,
    ...calls
  ]).slice(0, 8);

  return {
    kind: detection.kind,
    names: detection.names,
    parameters: detection.parameters,
    returns: unique([...returns, ...arrowReturn].map(cleanExpression)).slice(0, 4),
    exits,
    branches,
    loops,
    asyncSignals,
    calls,
    imports,
    exports,
    assignments,
    sideEffects,
    risks,
    importantIdentifiers,
    lineCount: lines.length,
    confidence: getConfidence(detection.kind, detection.names, branches, loops, assignments, calls)
  };
}

function detectPrimaryShape(code: string, languageId: string): DetectionResult {
  const patterns: Array<{ kind: LiteKind; regex: RegExp; nameIndex: number; paramsIndex?: number }> = [
    { kind: "function", regex: /\b(?:async\s+)?(?:export\s+)?(?:default\s+)?function\s+([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/, nameIndex: 1, paramsIndex: 2 },
    { kind: "function", regex: /\bdef\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:/, nameIndex: 1, paramsIndex: 2 },
    { kind: "function", regex: /\bfn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, nameIndex: 1, paramsIndex: 2 },
    { kind: "function", regex: /\bfunc(?:\s*\([^)]*\))?\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, nameIndex: 1, paramsIndex: 2 },
    { kind: "function", regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/, nameIndex: 1, paramsIndex: 2 },
    { kind: "function", regex: /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/, nameIndex: 1, paramsIndex: 2 },
    { kind: "function", regex: /\b(?:public|private|protected|internal|static|async|\s)+[\w<>\[\],?]+\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:[{=>]|$)/, nameIndex: 1, paramsIndex: 2 },
    { kind: "class", regex: /\b(class|interface|struct|enum|record|type)\s+([A-Za-z_$][\w$]*)/, nameIndex: 2 }
  ];

  for (const pattern of patterns) {
    const match = code.match(pattern.regex);
    if (!match) {
      continue;
    }

    return {
      kind: pattern.kind,
      names: match[pattern.nameIndex] ? [match[pattern.nameIndex]] : [],
      parameters: pattern.paramsIndex ? parseParameters(match[pattern.paramsIndex], languageId) : []
    };
  }

  if (/^\s*(import\b|from\b.+\bimport\b|export\b|#include\b|using\b|require\s*\()/im.test(code)) {
    return { kind: "import_export", names: [], parameters: [] };
  }

  if (/\b(if|else|switch|case|match)\b|\?.*:/s.test(code)) {
    return { kind: "conditional", names: [], parameters: [] };
  }

  if (/\b(for|while|foreach)\b|\.(map|filter|reduce|forEach)\s*\(/.test(code)) {
    return { kind: "loop", names: [], parameters: [] };
  }

  if (detectAssignments(code.split(/\r?\n/)).length > 0) {
    return { kind: "assignment", names: [], parameters: [] };
  }

  if (detectCalls(code).length > 0) {
    return { kind: "call", names: [], parameters: [] };
  }

  return { kind: "unknown", names: [], parameters: [] };
}

function parseParameters(value: string | undefined, languageId: string): string[] {
  if (!value?.trim()) {
    return [];
  }

  return unique(value
    .split(",")
    .map((parameter) => parameter.trim())
    .map((parameter) => parameter.replace(/=.*$/, "").trim())
    .map((parameter) => parameter.replace(/^\.\.\./, "").trim())
    .map((parameter) => {
      const colonIndex = parameter.indexOf(":");
      if (colonIndex > 0 && /typescript|javascript|tsx|jsx/.test(languageId)) {
        return parameter.slice(0, colonIndex).trim();
      }

      const parts = parameter.split(/\s+/).filter(Boolean);
      return parts.length > 1 ? parts[parts.length - 1] : parameter;
    })
    .map((parameter) => parameter.replace(/[^\w$]/g, ""))
    .filter((parameter) => Boolean(parameter) && parameter !== "self" && parameter !== "this"))
    .slice(0, 8);
}

function detectAssignments(lines: string[]): string[] {
  const names: string[] = [];

  for (const line of lines) {
    const declarationMatch = line.match(/\b(?:const|let|var|final|val)\s+([A-Za-z_$][\w$]*)/);
    if (declarationMatch?.[1]) {
      names.push(declarationMatch[1]);
      continue;
    }

    const assignmentMatch = line.match(/^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*(?:=|\+=|-=|\*=|\/=)/);
    if (assignmentMatch?.[1] && !/[=!<>]=|=>/.test(line)) {
      names.push(assignmentMatch[1]);
    }
  }

  return unique(names).slice(0, 8);
}

function detectCalls(code: string): string[] {
  const calls: string[] = [];
  const regex = /(?:^|[^\w$.])([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(code)) !== null) {
    const call = match[1];
    const baseName = call.split(".")[0];
    if (!callKeywordExclusions.has(baseName)) {
      calls.push(call);
    }
  }

  return unique(calls).slice(0, 8);
}

function detectSideEffects(code: string, assignments: string[]): string[] {
  const sideEffects = findKeywordSignals(code, [
    ["network request", /\b(fetch|axios|request|URLSession|HttpClient)\b|client\.(get|post|put|delete|patch)\s*\(|http\./i],
    ["file or database access", /\b(readFile|writeFile|appendFile|unlink|insert|update|delete|save|query|prisma|sql)\b/i],
    ["browser or DOM access", /\b(document|window|localStorage|sessionStorage)\./],
    ["VS Code API access", /\bvscode\./],
    ["state change", /\b(setState|dispatch|emit|push|pop|splice|append|remove)\s*\(/],
    ["logging", /\b(console\.(log|error|warn)|print|logger\.)/]
  ]);

  if (assignments.some((name) => name.includes("."))) {
    sideEffects.push("object mutation");
  }

  return unique(sideEffects);
}

function detectRisks(code: string, asyncSignals: string[], sideEffects: string[]): string[] {
  const risks: string[] = [];

  if ((asyncSignals.includes("await") || sideEffects.includes("network request")) && !/\btry\b|\bcatch\b|\.catch\s*\(/.test(code)) {
    risks.push("no visible error handling");
  }

  if (/\b(any)\b/.test(code)) {
    risks.push("loose any typing");
  }

  if (/https?:\/\//.test(code)) {
    risks.push("hardcoded URL");
  }

  if (/\beval\s*\(|innerHTML\s*=/.test(code)) {
    risks.push("unsafe dynamic execution or HTML injection");
  }

  if (/\bcatch\s*\([^)]*\)\s*{\s*}/s.test(code)) {
    risks.push("empty catch block");
  }

  return unique(risks);
}

function buildSummary(facts: LiteFacts, context: CodeContext, mode: ExplanationMode, isEnglish: boolean): string {
  const name = highlight(first(facts.names));
  const kind = getKindPhrase(facts.kind, isEnglish);
  const confidence = getConfidencePhrase(facts.confidence, isEnglish);

  if (mode === "simple") {
    if (isEnglish) {
      return facts.names.length
        ? `This looks like ${article(kind)} ${kind} named ${name}.`
        : `This looks like ${article(kind)} ${kind} in ${context.fileName}.`;
    }

    return facts.names.length
      ? `Ce code ressemble a ${articleFr(kind)} ${kind} nomme ${name}.`
      : `Ce code ressemble a ${articleFr(kind)} ${kind} dans ${context.fileName}.`;
  }

  const mainSignal = summarizeMainSignals(facts, isEnglish);

  if (isEnglish) {
    const subject = facts.names.length ? `${kind} named ${name}` : `${kind} in ${context.fileName}`;
    return `${confidence} this is ${article(kind)} ${subject}${mainSignal ? ` that ${mainSignal}` : ""}.`;
  }

  const subject = facts.names.length ? `${kind} nomme ${name}` : `${kind} dans ${context.fileName}`;
  return `${confidence}, c'est ${articleFr(kind)} ${subject}${mainSignal ? ` qui ${mainSignal}` : ""}.`;
}

function buildDetails(facts: LiteFacts, context: CodeContext, mode: ExplanationMode, isEnglish: boolean): string {
  if (mode === "simple") {
    return buildSimpleDetails(facts, context, isEnglish);
  }

  const lines: string[] = [];

  if (isEnglish) {
    lines.push(`Lite read this as ${article(getKindPhrase(facts.kind, true))} ${getKindPhrase(facts.kind, true)} from ${context.fileName}, around line ${context.startLine}.`);
    pushIf(lines, facts.names.length, `Main name: ${joinHighlighted(facts.names)}.`);
    pushIf(lines, facts.parameters.length, `Inputs it mentions: ${joinHighlighted(facts.parameters)}.`);
    pushIf(lines, facts.returns.length, `Visible output: ${facts.returns.map((value) => code(value)).join(", ")}.`);
    pushIf(lines, facts.branches.length, `Decision logic: ${facts.branches.join(", ")}.`);
    pushIf(lines, facts.loops.length, `Repeated work or data transformation: ${facts.loops.join(", ")}.`);
    pushIf(lines, facts.asyncSignals.length, `Async behavior: ${facts.asyncSignals.join(", ")}.`);
    pushIf(lines, facts.imports.length, `Imports it shows: ${facts.imports.map(code).join(", ")}.`);
    pushIf(lines, facts.exports.length, `Exports it shows: ${facts.exports.map(code).join(", ")}.`);
    pushIf(lines, facts.calls.length, `Calls it makes: ${joinCode(facts.calls)}.`);
    pushIf(lines, facts.assignments.length, `Values it creates or changes: ${joinHighlighted(facts.assignments)}.`);
    pushIf(lines, facts.exits.length, `Exit signals: ${facts.exits.join(", ")}.`);
    pushIf(lines, facts.sideEffects.length, `Possible side effects: ${facts.sideEffects.join(", ")}.`);
    pushIf(lines, mode === "detailed" && facts.risks.length, `Visible risks to review: ${facts.risks.join(", ")}.`);
    lines.push(getConfidenceNote(facts.confidence, true));
  } else {
    lines.push(`Lite lit ce bloc comme ${articleFr(getKindPhrase(facts.kind, false))} ${getKindPhrase(facts.kind, false)} dans ${context.fileName}, vers la ligne ${context.startLine}.`);
    pushIf(lines, facts.names.length, `Nom principal : ${joinHighlighted(facts.names)}.`);
    pushIf(lines, facts.parameters.length, `Entrees visibles : ${joinHighlighted(facts.parameters)}.`);
    pushIf(lines, facts.returns.length, `Sortie visible : ${facts.returns.map((value) => code(value)).join(", ")}.`);
    pushIf(lines, facts.branches.length, `Logique de decision : ${facts.branches.join(", ")}.`);
    pushIf(lines, facts.loops.length, `Repetition ou transformation : ${facts.loops.join(", ")}.`);
    pushIf(lines, facts.asyncSignals.length, `Comportement asynchrone : ${facts.asyncSignals.join(", ")}.`);
    pushIf(lines, facts.imports.length, `Imports visibles : ${facts.imports.map(code).join(", ")}.`);
    pushIf(lines, facts.exports.length, `Exports visibles : ${facts.exports.map(code).join(", ")}.`);
    pushIf(lines, facts.calls.length, `Appels detectes : ${joinCode(facts.calls)}.`);
    pushIf(lines, facts.assignments.length, `Valeurs creees ou modifiees : ${joinHighlighted(facts.assignments)}.`);
    pushIf(lines, facts.exits.length, `Signaux de sortie : ${facts.exits.join(", ")}.`);
    pushIf(lines, facts.sideEffects.length, `Effets de bord possibles : ${facts.sideEffects.join(", ")}.`);
    pushIf(lines, mode === "detailed" && facts.risks.length, `Risques visibles a verifier : ${facts.risks.join(", ")}.`);
    lines.push(getConfidenceNote(facts.confidence, false));
  }

  if (lines.length <= 2) {
    lines.push(...buildFallbackLines(context, isEnglish));
  }

  return lines.join("\n");
}

function buildSimpleDetails(facts: LiteFacts, context: CodeContext, isEnglish: boolean): string {
  const pieces: string[] = [];

  if (isEnglish) {
    pushIf(pieces, facts.parameters.length, `It uses ${joinHighlighted(facts.parameters)} as input.`);
    pushIf(pieces, facts.returns.length, `It gives back ${code(facts.returns[0])}.`);
    pushIf(pieces, facts.calls.length, `It calls ${code(facts.calls[0])}.`);
    pushIf(pieces, facts.branches.length, "It chooses between paths.");
    pushIf(pieces, facts.loops.length, "It repeats work or transforms a list.");
    pushIf(pieces, facts.asyncSignals.length, "It waits for asynchronous work.");
    pushIf(pieces, facts.sideEffects.length, `It may affect something outside itself: ${facts.sideEffects[0]}.`);
    return pieces.length ? pieces.join(" ") : buildFallbackLines(context, true).join(" ");
  }

  pushIf(pieces, facts.parameters.length, `Il utilise ${joinHighlighted(facts.parameters)} comme entree.`);
  pushIf(pieces, facts.returns.length, `Il renvoie ${code(facts.returns[0])}.`);
  pushIf(pieces, facts.calls.length, `Il appelle ${code(facts.calls[0])}.`);
  pushIf(pieces, facts.branches.length, "Il choisit entre plusieurs chemins.");
  pushIf(pieces, facts.loops.length, "Il repete une action ou transforme une liste.");
  pushIf(pieces, facts.asyncSignals.length, "Il attend un travail asynchrone.");
  pushIf(pieces, facts.sideEffects.length, `Il peut toucher quelque chose hors du bloc : ${facts.sideEffects[0]}.`);
  return pieces.length ? pieces.join(" ") : buildFallbackLines(context, false).join(" ");
}

function buildTakeaway(facts: LiteFacts, mode: ExplanationMode, isEnglish: boolean): string {
  const kind = getKindPhrase(facts.kind, isEnglish);
  const name = facts.names.length ? ` ${highlight(facts.names[0])}` : "";

  if (mode === "simple") {
    return isEnglish
      ? `Read ${name || "this block"} by following what goes in, what it calls, and what comes out.`
      : `Lis ${name || "ce bloc"} en suivant ce qui entre, ce qui est appele, puis ce qui sort.`;
  }

  if (isEnglish) {
    return `Lite can show the structure of this ${kind}${name}, then an AI provider can add deeper intent if needed.`;
  }

  return `Lite montre la structure de ${demonstrativeFr(kind)}${name}, puis un fournisseur IA peut ajouter l'intention plus profonde si besoin.`;
}

function summarizeMainSignals(facts: LiteFacts, isEnglish: boolean): string {
  if (facts.asyncSignals.length && facts.sideEffects.includes("network request")) {
    return isEnglish ? "waits for a network request" : "attend une requete reseau";
  }

  if (facts.returns.length) {
    return isEnglish ? `returns ${code(facts.returns[0])}` : `renvoie ${code(facts.returns[0])}`;
  }

  if (facts.branches.length) {
    return isEnglish ? "chooses between paths" : "choisit entre plusieurs chemins";
  }

  if (facts.loops.length) {
    return isEnglish ? "repeats work or transforms data" : "repete une action ou transforme des donnees";
  }

  if (facts.sideEffects.length) {
    return isEnglish ? `may cause ${facts.sideEffects[0]}` : `peut causer ${facts.sideEffects[0]}`;
  }

  return "";
}

function buildFallbackLines(context: CodeContext, isEnglish: boolean): string[] {
  const selectedLines = context.selectedCode.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4);
  if (isEnglish) {
    return [
      `Lite could not identify a strong code shape, so it is reading the visible structure only.`,
      `The selected block has ${selectedLines.length} non-empty line${selectedLines.length === 1 ? "" : "s"}.`,
      selectedLines.length ? `First visible line: ${code(selectedLines[0])}.` : "There is no visible non-empty line to summarize."
    ];
  }

  return [
    "Lite n'a pas identifie une forme de code forte, donc il lit seulement la structure visible.",
    `Le bloc selectionne contient ${selectedLines.length} ligne${selectedLines.length === 1 ? "" : "s"} non vide${selectedLines.length === 1 ? "" : "s"}.`,
    selectedLines.length ? `Premiere ligne visible : ${code(selectedLines[0])}.` : "Il n'y a pas de ligne non vide visible a resumer."
  ];
}

function getLabels(language: UiLanguage): { summary: string; details: string; takeaway: string } {
  if (language === "en") {
    return {
      summary: "Summary",
      details: "Details",
      takeaway: "Key takeaway"
    };
  }

  return {
    summary: "Resume",
    details: "Details",
    takeaway: "A retenir"
  };
}

function getKindPhrase(kind: LiteKind, isEnglish: boolean): string {
  if (isEnglish) {
    switch (kind) {
      case "function":
        return "function or method";
      case "class":
        return "type or class definition";
      case "import_export":
        return "import or export block";
      case "conditional":
        return "decision block";
      case "loop":
        return "loop or data transformation";
      case "assignment":
        return "value assignment";
      case "call":
        return "call expression";
      case "unknown":
      default:
        return "code block";
    }
  }

  switch (kind) {
    case "function":
      return "fonction ou methode";
    case "class":
      return "definition de type ou classe";
    case "import_export":
      return "bloc d'import ou d'export";
    case "conditional":
      return "bloc de decision";
    case "loop":
      return "boucle ou transformation de donnees";
    case "assignment":
      return "affectation de valeur";
    case "call":
      return "expression d'appel";
    case "unknown":
    default:
      return "bloc de code";
  }
}

function getConfidence(kind: LiteKind, names: string[], branches: string[], loops: string[], assignments: string[], calls: string[]): LiteFacts["confidence"] {
  if ((kind === "function" || kind === "class") && names.length > 0) {
    return "high";
  }

  if (kind !== "unknown" || branches.length || loops.length || assignments.length || calls.length) {
    return "medium";
  }

  return "low";
}

function getConfidencePhrase(confidence: LiteFacts["confidence"], isEnglish: boolean): string {
  if (isEnglish) {
    switch (confidence) {
      case "high":
        return "From the syntax";
      case "medium":
        return "From visible patterns";
      case "low":
      default:
        return "With limited confidence";
    }
  }

  switch (confidence) {
    case "high":
      return "D'apres la syntaxe";
    case "medium":
      return "D'apres les formes visibles";
    case "low":
    default:
      return "Avec une confiance limitee";
  }
}

function getConfidenceNote(confidence: LiteFacts["confidence"], isEnglish: boolean): string {
  if (confidence === "high") {
    return isEnglish
      ? "This is a structural Lite explanation, so it avoids guessing hidden business intent."
      : "C'est une explication structurelle Lite, donc elle evite d'inventer une intention metier cachee.";
  }

  if (confidence === "medium") {
    return isEnglish
      ? "Some meaning is inferred from visible syntax, so review the surrounding code for deeper intent."
      : "Une partie du sens est deduite de la syntaxe visible, donc verifie le contexte autour pour l'intention profonde.";
  }

  return isEnglish
    ? "Lite has low confidence here because the snippet does not expose a common code shape."
    : "Lite a une confiance faible ici car l'extrait ne montre pas une forme de code courante.";
}

function collectMatches(code: string, regex: RegExp, groupIndex: number, limit: number): string[] {
  const values: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(code)) !== null && values.length < limit) {
    if (match[groupIndex]) {
      values.push(match[groupIndex]);
    }
  }

  return values;
}

function findKeywordSignals(code: string, patterns: Array<[string, RegExp]>): string[] {
  return patterns.filter(([, regex]) => regex.test(code)).map(([label]) => label);
}

function cleanExpression(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[;{]+$/, "").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => Boolean(value?.trim()))));
}

function first(values: string[]): string {
  return values[0] ?? "";
}

function highlight(value: string): string {
  return value ? `[[${value}]]` : "";
}

function code(value: string): string {
  return `\`${value}\``;
}

function joinHighlighted(values: string[]): string {
  return values.map(highlight).join(", ");
}

function joinCode(values: string[]): string {
  return values.map(code).join(", ");
}

function pushIf(lines: string[], condition: unknown, value: string): void {
  if (condition) {
    lines.push(value);
  }
}

function article(kind: string): string {
  return /^[aeiou]/i.test(kind) ? "an" : "a";
}

function articleFr(kind: string): string {
  return /^(bloc|code|appel)/.test(kind) ? "un" : "une";
}

function demonstrativeFr(kind: string): string {
  if (/^(bloc|code|appel)/.test(kind)) {
    return `ce ${kind}`;
  }

  return `cette ${kind}`;
}
