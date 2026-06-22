
import { localInjectionScore, localRedactPii } from "./local-scanner";

export interface ScanVerdict {
  injection: boolean;
  score: number;
  scanned: boolean;
}

export class ScannerUnavailable extends Error {
  readonly httpStatus = 503;
  constructor() {
    super("the assistant is temporarily unavailable");
    this.name = "ScannerUnavailable";
  }
}

const SCANNER_URL = () => process.env.LLM_GUARD_URL;
const PRESIDIO_URL = () => process.env.PRESIDIO_URL;
const THRESHOLD = () => Number(process.env.LLM_GUARD_THRESHOLD ?? "0.5");

export async function scanForInjection(text: string, timeoutMs = 3000): Promise<ScanVerdict> {
  const base = SCANNER_URL();
  if (!base) {
    const { score } = localInjectionScore(text);
    return { injection: score >= THRESHOLD(), score, scanned: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/scan/prompt-injection`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ScannerUnavailable();
    const body = (await res.json()) as { score?: number };
    const score = typeof body.score === "number" ? body.score : 1;
    return { injection: score >= THRESHOLD(), score, scanned: true };
  } catch (e) {
    if (e instanceof ScannerUnavailable) throw e;
    throw new ScannerUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

export async function redactPii(text: string, timeoutMs = 3000): Promise<string> {
  const base = PRESIDIO_URL();
  if (!base) return localRedactPii(text);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/anonymize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, language: "en" }),
      signal: controller.signal,
    });
    if (!res.ok) throw new ScannerUnavailable();
    const body = (await res.json()) as { text?: string };
    if (typeof body.text !== "string") throw new ScannerUnavailable();
    return body.text;
  } catch (e) {
    if (e instanceof ScannerUnavailable) throw e;
    throw new ScannerUnavailable();
  } finally {
    clearTimeout(timer);
  }
}

export const MAX_INPUT_CHARS = 2000;

export function inputWithinLimit(text: string): boolean {
  return text.length > 0 && text.length <= MAX_INPUT_CHARS;
}
