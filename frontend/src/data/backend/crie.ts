// CRIE (model 2) on the live backend: POST /crie/recommend (contracts/LIVE_API.md 4.7).
// CRIE ONLY RECOMMENDS: its answer becomes fix cards for an analyst; nothing is ever carried out.
// When CRIE can't answer (loading, failed, offline, its fallback), the incident keeps MITRE's
// mitigations from our own table: nothing is invented.
import type { Fix, Incident } from "../types";

/** The R0 input shape (contracts/LIVE_API.md 4.7). */
export interface CrieRequest {
  incident_id: string;
  attack_type: string;
  mitre_technique: string | null;
  severity: number;
  detected_by: "rule" | "ai" | "both";
  rules: string[];
  model: {
    attack_family: string;
    confidence: number | null;
    is_unknown: boolean;
    if_score: number | null;
    top3: string[];
  } | null;
  context: { src_ips: string[]; usernames: string[]; hosts: string[]; dst_ip: string | null; domain: string | null };
}

export interface CrieFixWire {
  action_id: string;
  name: string;
  d3fend?: { id: string | null; name: string | null } | null;
  confidence: number;
  rank: number;
  reasons?: { feature: string; value: number | string | null; contribution?: number | null }[] | null;
  provenance?: string[] | string | null;
}

export type CrieAnswer =
  | { version: string; fixes: CrieFixWire[]; fallback?: undefined }
  | { version: string; fallback: { technique: string | null; mitigations: { id: string; name: string }[] }; fixes?: undefined };

/** "Reset Credentials" -> "Reset credentials" (UI copy is sentence case); acronyms like MFA and IPs stay. */
export function sentenceCase(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((w, i) => (/[A-Z].*[A-Z]/.test(w) ? w : i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()))
    .join(" ");
}

const two = (v: unknown) => (typeof v === "number" ? v.toFixed(2) : String(v ?? ""));

/** CRIE's two reasons are the two parts of its confidence (contracts 4.7): say which is which. */
function reasonSentence(feature: string, value: unknown, provenance: string[]): string {
  if (feature === "knowledge_base_evidence") {
    return `Knowledge-base evidence ${two(value)}${provenance.length ? `, from ${provenance.join(", ")}` : ""}`;
  }
  if (feature === "ml_probability") return `CRIE's model rates it ${two(value)}`;
  // A critical incident with no containment fix available: CRIE says so in words (not a score).
  if (feature === "containment_status" && typeof value === "string") return value.endsWith(".") ? value : `${value}.`;
  return `${feature.replace(/_/g, " ")} ${two(value)}`.trim();
}

export function toFix(w: CrieFixWire): Fix {
  const provenance = Array.isArray(w.provenance) ? w.provenance : w.provenance ? [w.provenance] : [];
  return {
    actionId: w.action_id,
    name: sentenceCase(w.name),
    d3fend: { id: w.d3fend?.id ?? null, name: w.d3fend?.name ?? "" },
    confidence: Math.max(0, Math.min(1, w.confidence)),
    rank: (Math.min(3, Math.max(1, Math.round(w.rank))) as Fix["rank"]),
    reasons: (w.reasons ?? []).map((r) => ({
      feature: r.feature,
      value: r.value ?? "",
      contribution: r.contribution ?? 0,
      sentence: reasonSentence(r.feature, r.value, provenance),
    })),
  };
}

/** The incident with CRIE's answer on it: its 3 fixes, or (fallback) none, keeping MITRE's mitigations. */
export function withAnswer(incident: Incident, answer: CrieAnswer | undefined): Incident {
  if (!answer) return incident;
  if (answer.fixes?.length) {
    const fixes = [...answer.fixes].sort((a, b) => a.rank - b.rank).slice(0, 3).map(toFix);
    return { ...incident, fixes };
  }
  const fb = answer.fallback;
  // CRIE's own mitigation list is empty for now: our table's (already on the incident) stays.
  return fb?.mitigations?.length
    ? { ...incident, fixes: [], fallback: { technique: fb.technique ?? incident.fallback?.technique ?? "", mitigations: fb.mitigations } }
    : { ...incident, fixes: [] };
}

const DEBOUNCE_MS = 2_000;
const RETRY_MS = 15_000; // after CRIE said "not ready" (503) or the call failed

/**
 * Asks CRIE once an incident settles (2 s after its last change), one call in flight per incident,
 * and again only when the input changed. Answers are kept per incident, so the correlator's
 * re-publishes (which carry no fixes) get them back.
 */
export class CrieClient {
  private readonly answers = new Map<string, { input: string; answer: CrieAnswer }>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inFlight = new Set<string>();
  private readonly gone = new Set<string>();
  private readonly ask: (req: CrieRequest) => Promise<CrieAnswer>;
  private readonly onAnswer: (incidentId: string) => void;

  constructor(ask: (req: CrieRequest) => Promise<CrieAnswer>, onAnswer: (incidentId: string) => void) {
    this.ask = ask;
    this.onAnswer = onAnswer;
  }

  /** The answer for this incident, if CRIE gave one. */
  answer(incidentId: string): CrieAnswer | undefined {
    return this.answers.get(incidentId)?.answer;
  }

  /** CRIE's version behind this incident's fixes (for the decision log). */
  version(incidentId: string): string | undefined {
    return this.answers.get(incidentId)?.answer.version;
  }

  /** The incident changed: ask again once it settles, if its input is new. */
  changed(req: CrieRequest | undefined) {
    if (!req) return;
    const id = req.incident_id;
    this.gone.delete(id);
    if (this.answers.get(id)?.input === key(req)) return;
    clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => void this.run(req), DEBOUNCE_MS));
  }

  /** Gone (expired, merged, decided): stop asking. */
  forget(incidentId: string) {
    clearTimeout(this.timers.get(incidentId));
    this.timers.delete(incidentId);
    this.answers.delete(incidentId);
    this.gone.add(incidentId);
  }

  stop() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  private async run(req: CrieRequest) {
    const id = req.incident_id;
    this.timers.delete(id);
    if (this.inFlight.has(id)) {
      // The answer on its way is for older input: ask again after it.
      this.timers.set(id, setTimeout(() => void this.run(req), DEBOUNCE_MS));
      return;
    }
    this.inFlight.add(id);
    try {
      const answer = await this.ask(req);
      if (this.gone.has(id)) return;
      this.answers.set(id, { input: key(req), answer });
      this.onAnswer(id);
    } catch {
      // Not ready, failed, or unreachable: MITRE's mitigations stay. Try again later.
      if (!this.gone.has(id) && !this.timers.has(id)) this.timers.set(id, setTimeout(() => void this.run(req), RETRY_MS));
    } finally {
      this.inFlight.delete(id);
    }
  }
}

// The input without the id: the same incident with the same evidence needs no new answer.
const key = (req: CrieRequest) => JSON.stringify({ ...req, incident_id: undefined });
