// The five landing steps. Captions are kept to one sentence each: less text, clearer story.
export interface Step {
  n: number;
  label: string;
  caption: string;
}

export const STEPS: Step[] = [
  { n: 1, label: "INGEST", caption: "Every login, web request and network flow streams in live." },
  { n: 2, label: "DETECT", caption: "Rules catch known attacks instantly. The AI engine catches what rules miss." },
  { n: 3, label: "CORRELATE", caption: "Small warning signs from one source merge into one incident." },
  { n: 4, label: "PRIORITISE", caption: "Every incident gets a deadline before its data goes stale." },
  { n: 5, label: "RECOMMEND", caption: "The top 3 fixes, explained. Nothing runs until an analyst approves." },
];

export const pad2 = (n: number) => String(n).padStart(2, "0");
