const INJECTION_PATTERNS: ReadonlyArray<{ re: RegExp; weight: number; label: string }> = [
  { re: /\bignore\s+(all\s+)?(the\s+)?(previous|prior|above|earlier)\b/i, weight: 0.9, label: "ignore-previous" },
  { re: /\bdisregard\s+(all\s+)?(the\s+)?(previous|prior|above|earlier|instructions)\b/i, weight: 0.9, label: "disregard" },
  { re: /\bforget\s+(everything|all|your\s+instructions)\b/i, weight: 0.85, label: "forget" },
  { re: /\b(system|initial|original)\s+prompt\b/i, weight: 0.8, label: "system-prompt" },
  { re: /\b(reveal|show|print|repeat|output|display)\s+(me\s+)?(your|the)\s+(prompt|instructions|rules|system)/i, weight: 0.9, label: "reveal-prompt" },
  { re: /\brepeat\s+(everything|all)\s+(above|before)\b/i, weight: 0.85, label: "repeat-above" },
  { re: /\byou\s+are\s+now\b/i, weight: 0.7, label: "role-reassign" },
  { re: /\b(act|behave|pretend)\s+as\s+(if\s+)?(you|a|an)\b/i, weight: 0.6, label: "roleplay" },
  { re: /\b(developer|admin|root|god)\s+mode\b/i, weight: 0.8, label: "mode-switch" },
  { re: /\bDAN\b|\bjailbreak\b/i, weight: 0.8, label: "jailbreak" },
  { re: /\bnew\s+(instructions|rules|task)\s*:/i, weight: 0.8, label: "new-instructions" },
  { re: /\bdo\s+not\s+(follow|obey)\b/i, weight: 0.7, label: "do-not-follow" },
  { re: /<\s*\/?\s*(system|instructions?|context|prompt)\s*>/i, weight: 0.85, label: "tag-escape" },
  { re: /\b(END|STOP)\s+(OF\s+)?(CONTEXT|DOCUMENT|INSTRUCTIONS)\b/i, weight: 0.75, label: "delimiter-escape" },
  { re: /```\s*(system|instructions)/i, weight: 0.7, label: "fence-escape" },
  { re: /\bexfiltrat|\bsend\s+(it\s+)?to\s+https?:\/\//i, weight: 0.85, label: "exfiltration" },
  { re: /!\[[^\]]*\]\(\s*https?:\/\//i, weight: 0.7, label: "markdown-image" },
];

export function localInjectionScore(text: string): { score: number; labels: string[] } {
  const labels: string[] = [];
  let score = 0;
  for (const p of INJECTION_PATTERNS) {
    if (p.re.test(text)) {
      labels.push(p.label);
      if (p.weight > score) score = p.weight;
    }
  }
  if (labels.length >= 2) score = Math.min(1, score + 0.1);
  return { score, labels };
}

const PII_RULES: ReadonlyArray<{ re: RegExp; token: string }> = [
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, token: "[EMAIL]" },
  { re: /(?:\+?977[-\s]?)?\b9[678]\d[-\s]?\d{3}[-\s]?\d{4}\b/g, token: "[PHONE]" },
  { re: /\b(?:\d[ -]?){13,19}\b/g, token: "[CARD]" },
  { re: /\b[A-Z]{2}\d{6,9}\b/g, token: "[ID]" },
];

export function localRedactPii(text: string): string {
  let out = text;
  for (const r of PII_RULES) out = out.replace(r.re, r.token);
  return out;
}
