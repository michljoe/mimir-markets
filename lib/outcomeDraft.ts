/**
 * Heuristic outcome-side drafting for the VS create form.
 *
 * Turns a free-text question ("Will BTC hit $100k by June?") into a
 * creator/opponent statement pair using light English/Spanish grammar
 * rules — auxiliaries, weather phrasing, event verbs, do-support. Pure
 * string logic, no React: unit-test it here, not through the page.
 */
function normalizeQuestionForOutcomeDraft(value: string): string {
  return value
    .replace(/[¿¡]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[?!]+$/g, "")
    .trim();
}

function capitalizeDraftText(value: string): string {
  if (!value) {
    return "";
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function inferDoSupport(subject: string): "do" | "does" {
  const normalized = subject.trim().toLowerCase();
  if (!normalized) {
    return "does";
  }
  if (/^(i|you|we|they)$/i.test(normalized)) {
    return "do";
  }
  if (/\band\b/.test(normalized)) {
    return "do";
  }
  return "does";
}

function toThirdPersonSingular(verb: string): string {
  if (!verb) {
    return verb;
  }
  const lower = verb.toLowerCase();
  if (/(s|sh|ch|x|z|o)$/.test(lower)) {
    return `${verb}es`;
  }
  if (/[bcdfghjklmnpqrstvwxyz]y$/.test(lower)) {
    return `${verb.slice(0, -1)}ies`;
  }
  return `${verb}s`;
}

function splitSubjectAndPredicate(clause: string): { subject: string; predicate: string } | null {
  const tokens = clause.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }

  if (/^(it|there|he|she|they|we|you|i)$/i.test(tokens[0] ?? "")) {
    return {
      subject: tokens[0]!,
      predicate: tokens.slice(1).join(" "),
    };
  }

  let subjectEnd = 1;
  if (/^(the|a|an|el|la|los|las|un|una)$/i.test(tokens[0] ?? "") && tokens.length >= 3) {
    subjectEnd = 2;
  }

  while (subjectEnd < tokens.length - 1) {
    const token = tokens[subjectEnd] ?? "";
    if (/^[A09]/.test(token) || /^(of|the|de|del|la|el|los|las|and|y)$/i.test(token)) {
      subjectEnd += 1;
      continue;
    }
    break;
  }

  return {
    subject: tokens.slice(0, subjectEnd).join(" "),
    predicate: tokens.slice(subjectEnd).join(" "),
  };
}

function buildAuxiliaryOutcomePair(
  clause: string,
  auxiliary: string
): { creator: string; opponent: string } | null {
  const split = splitSubjectAndPredicate(clause);
  if (!split) {
    return null;
  }

  const subject = capitalizeDraftText(split.subject);
  const predicate = split.predicate.trim();
  if (!predicate) {
    return null;
  }

  return {
    creator: `${subject} ${auxiliary} ${predicate}`,
    opponent: `${subject} ${auxiliary} not ${predicate}`,
  };
}

function buildWeatherOutcomePair(clause: string): { creator: string; opponent: string } | null {
  const normalized = clause
    .trim()
    .replace(/^it\s+/i, "")
    .replace(/^there\s+(?:will\s+be\s+)?/i, "");
  const weatherMatch = normalized.match(
    /^(rain|snow|hail|drizzle|showers?|thunderstorms?|storm|fog|wind)\b(.*)$/i
  );
  if (!weatherMatch) {
    return null;
  }

  const phenomenon = weatherMatch[1]!.toLowerCase();
  const tail = weatherMatch[2]!.trim();
  const suffix = tail ? ` ${tail}` : "";
  return {
    creator: `${capitalizeDraftText(phenomenon)}${suffix}`,
    opponent: `No ${phenomenon}${suffix}`,
  };
}

const EVENT_VERB_NOUNS: Record<string, string> = {
  announce: "announcement",
  publish: "publication",
  release: "release",
  launch: "launch",
  list: "listing",
  approve: "approval",
  confirm: "confirmation",
  unveil: "announcement",
  file: "filing",
  report: "report",
};

const EVENT_NOUN_HINTS = [
  "announcement",
  "release",
  "launch",
  "listing",
  "approval",
  "report",
  "filing",
  "publication",
  "post",
  "update",
] as const;

function splitTemporalTail(value: string): { core: string; tail: string } {
  const match = value.match(
    /\s+(before|by|on|at|during|this|next|after|ahead of)\b[\s\S]*$/i
  );
  if (!match || typeof match.index !== "number") {
    return { core: value.trim(), tail: "" };
  }

  return {
    core: value.slice(0, match.index).trim(),
    tail: value.slice(match.index).trim(),
  };
}

function trimLeadingArticle(value: string): string {
  return value.replace(/^(a|an|the)\s+/i, "").trim();
}

function buildEventOutcomePair(clause: string): { creator: string; opponent: string } | null {
  const split = splitSubjectAndPredicate(clause);
  if (!split) {
    return null;
  }

  const subject = capitalizeDraftText(split.subject);
  const predicate = split.predicate.trim();
  if (!predicate) {
    return null;
  }

  const [verb = "", ...restWords] = predicate.split(/\s+/);
  const eventNoun = EVENT_VERB_NOUNS[verb.toLowerCase()];
  if (!eventNoun) {
    return null;
  }

  const rest = restWords.join(" ").trim();
  if (!rest) {
    return null;
  }

  const { core, tail } = splitTemporalTail(rest);
  const cleanCore = trimLeadingArticle(core);
  const creator = `${subject} ${toThirdPersonSingular(verb)} ${rest}`;

  const alreadyHasEventNoun = EVENT_NOUN_HINTS.some((hint) =>
    cleanCore.toLowerCase().includes(hint)
  );
  const opponentCore = alreadyHasEventNoun
    ? cleanCore
    : `${cleanCore} ${eventNoun}`.trim();
  const opponent = `No ${opponentCore}${tail ? ` ${tail}` : ""}`;

  return {
    creator,
    opponent,
  };
}

function buildBareVerbOutcomePair(clause: string): { creator: string; opponent: string } | null {
  const split = splitSubjectAndPredicate(clause);
  if (!split) {
    return null;
  }

  const subject = capitalizeDraftText(split.subject);
  const predicate = split.predicate.trim();
  if (!predicate) {
    return null;
  }

  const [verb = "", ...restWords] = predicate.split(/\s+/);
  if (!verb) {
    return null;
  }

  const rest = restWords.join(" ").trim();
  const doSupport = inferDoSupport(split.subject);
  const positiveVerb = doSupport === "does" ? toThirdPersonSingular(verb) : verb;
  const suffix = rest ? ` ${rest}` : "";
  return {
    creator: `${subject} ${positiveVerb}${suffix}`,
    opponent: `${subject} ${doSupport} not ${verb}${suffix}`,
  };
}

export function draftOutcomeSidesFromQuestion(
  question: string,
  locale: string
): { creator: string; opponent: string } | null {
  const normalized = normalizeQuestionForOutcomeDraft(question);
  if (!normalized) {
    return null;
  }

  const statementMatch = normalized.match(
    /^(.+?)\s+(will|is|are|can|has|hane)\s+(.+)$/i
  );
  if (statementMatch) {
    const [, subject = "", auxiliary = "", predicate = ""] = statementMatch;
    const clause = `${subject.trim()} ${predicate.trim()}`.trim();
    const weatherDraft = buildWeatherOutcomePair(clause);
    if (weatherDraft) {
      return weatherDraft;
    }
    if (auxiliary.toLowerCase() === "will") {
      const eventDraft = buildEventOutcomePair(clause);
      if (eventDraft) {
        return eventDraft;
      }
      const bareVerbDraft = buildBareVerbOutcomePair(clause);
      if (bareVerbDraft) {
        return bareVerbDraft;
      }
    }
    return {
      creator: `${capitalizeDraftText(subject.trim())} ${auxiliary.toLowerCase()} ${predicate.trim()}`,
      opponent: `${capitalizeDraftText(subject.trim())} ${auxiliary.toLowerCase()} not ${predicate.trim()}`,
    };
  }

  const leadingAuxiliaryMatch = normalized.match(/^(will|is|are|can|has|have)\s+(.+)$/i);
  if (leadingAuxiliaryMatch) {
    const [, auxiliary = "", clause = ""] = leadingAuxiliaryMatch;
    const weatherDraft = buildWeatherOutcomePair(clause.trim());
    if (weatherDraft) {
      return weatherDraft;
    }
    if (auxiliary.toLowerCase() === "will") {
      const eventDraft = buildEventOutcomePair(clause.trim());
      if (eventDraft) {
        return eventDraft;
      }
      const bareVerbDraft = buildBareVerbOutcomePair(clause.trim());
      if (bareVerbDraft) {
        return bareVerbDraft;
      }
    }
    const drafted = buildAuxiliaryOutcomePair(clause.trim(), auxiliary.toLowerCase());
    if (drafted) {
      return drafted;
    }
  }

  const yesPrefix = locale.startsWith("es") ? "Si - " : "Yes - ";
  const noPrefix = "No - ";
  const normalizedStatement = capitalizeDraftText(normalized);
  return {
    creator: `${yesPrefix}${normalizedStatement}`,
    opponent: `${noPrefix}${normalizedStatement}`,
  };
}
