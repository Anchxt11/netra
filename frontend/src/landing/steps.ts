// The five landing steps. One sentence each, plus a tiny colour key where the drawing needs one,
// so a first-time viewer can read the picture without jargon.
export type KeySwatch = "heat" | "rule" | "ai" | "rust" | "ring" | "ok";

export interface Step {
  n: number;
  label: string;
  caption: string;
  key?: { swatch: KeySwatch; text: string }[];
}

export const STEPS: Step[] = [
  { n: 1, label: "INGEST", caption: "Every login, web request and network flow streams in live." },
  {
    n: 2,
    label: "DETECT",
    caption: "Rules catch known attacks instantly. The AI engine catches what rules miss.",
    key: [
      { swatch: "heat", text: "Suspicious traffic" },
      { swatch: "rule", text: "Caught by a rule" },
      { swatch: "ai", text: "Flagged by the AI engine" },
    ],
  },
  {
    n: 3,
    label: "CORRELATE",
    caption: "Small warning signs from one source merge into one incident.",
    key: [
      { swatch: "ring", text: "Attacking address" },
      { swatch: "rust", text: "Targeted account" },
      { swatch: "rule", text: "Warning sign, from a rule or the AI" },
    ],
  },
  { n: 4, label: "PRIORITISE", caption: "Every incident gets a deadline before its data goes stale." },
  { n: 5, label: "RECOMMEND", caption: "The top 3 fixes, explained. Nothing runs until an analyst approves." },
];

export const pad2 = (n: number) => String(n).padStart(2, "0");
