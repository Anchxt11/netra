// WHO IS INVOLVED: addresses, users and hosts in one incident. Styling: docs/DESIGN.md "Cytoscape graph".
// Positions are computed (not simulated), so the picture is stable and never jumps while data updates.
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import CytoscapeComponent from "react-cytoscapejs";
import type { ElementDefinition, StylesheetStyle } from "cytoscape";
import type { Incident } from "../data/types";
import { themeColors } from "../lib/cssColors";
import styles from "./EntityGraph.module.css";

const MAX_NODES = 25;
const MONO = '"IBM Plex Mono", ui-monospace, monospace';

type Colors = ReturnType<typeof themeColors>;

const polar = (cx: number, cy: number, r: number, deg: number) => ({
  x: cx + r * Math.cos((deg * Math.PI) / 180),
  y: cy + r * Math.sin((deg * Math.PI) / 180),
});

function buildElements(entities: Incident["entities"], w: number, h: number) {
  const cx = w / 2;
  const cy = h / 2;
  const R = Math.max(40, Math.min(w, h) / 2 - 20);
  const { users, hosts } = entities;
  const ipRoom = Math.max(0, MAX_NODES - users.length - hosts.length);
  const ips = entities.ips.slice(0, ipRoom);
  const els: ElementDefinition[] = [];

  // The target sits in the centre: the attacked user, or the host when no user is involved.
  const target = users.length > 0 ? `u:${users[0]}` : hosts.length > 0 ? `h:${hosts[0]}` : null;

  if (users.length > 0) {
    els.push({
      data: { id: `u:${users[0]}`, label: users[0], w: users[0].length * 6.3 + 14 },
      classes: "user target",
      position: { x: cx, y: cy },
    });
  }
  // Other targeted accounts collapse into one node, so a campaign stays readable.
  const others = users.length - 1;
  const groupId = "u:others";
  if (others > 0) {
    const label = `+${others} ${others === 1 ? "ACCOUNT" : "ACCOUNTS"}`;
    els.push({ data: { id: groupId, label, w: label.length * 6.3 + 14 }, classes: "user", position: polar(cx, cy, R * 0.55, 150) });
  }

  hosts.forEach((hst, i) => {
    const centred = users.length === 0 && i === 0;
    const pos = centred ? { x: cx, y: cy } : polar(cx, cy, R * 0.62, 35 + i * 38);
    els.push({ data: { id: `h:${hst}`, label: hst }, classes: centred ? "host target" : "host", position: pos });
    if (target && !centred) els.push({ data: { id: `e:${target}>${hst}`, source: target, target: `h:${hst}` }, classes: "toHost" });
  });

  ips.forEach((ip, i) => {
    const pos = polar(cx, cy, R, -90 + (i * 360) / Math.max(1, ips.length) + (ips.length > 3 ? 12 : 0));
    els.push({ data: { id: `i:${ip}`, label: `.${ip.split(".").pop()}` }, classes: "ip", position: pos });
    // Addresses point at the attacked account, and faintly at the other accounts they tried.
    if (target) els.push({ data: { id: `e:${ip}>${target}`, source: `i:${ip}`, target } });
    if (others > 0) els.push({ data: { id: `e:${ip}>${groupId}`, source: `i:${ip}`, target: groupId }, classes: "faint" });
  });

  const shownUsers = Math.min(users.length, 2);
  return { els, shown: ips.length + shownUsers + hosts.length, total: entities.ips.length + shownUsers + hosts.length };
}

function stylesheet(c: Colors): StylesheetStyle[] {
  return [
    {
      selector: "node",
      style: { label: "data(label)", "font-family": MONO, "font-size": 9.5, color: c.muted, "text-valign": "bottom", "text-margin-y": 4 },
    },
    {
      selector: "node.ip",
      style: { shape: "ellipse", width: 13, height: 13, "background-color": c.bg, "border-width": 1.4, "border-color": c.rust },
    },
    {
      selector: "node.user",
      style: {
        shape: "round-rectangle",
        width: "data(w)",
        height: 20,
        "background-color": c.bg,
        "border-width": 1.2,
        "border-color": c.text,
        color: c.text,
        "text-valign": "center",
        "text-margin-y": 0,
      },
    },
    {
      selector: "node.host",
      style: {
        shape: "hexagon",
        width: 20,
        height: 18,
        "background-color": c.bg,
        "border-width": 1.2,
        "border-color": c.text,
        color: c.text,
        "text-valign": "center",
        "text-halign": "right",
        "text-margin-x": 5,
        "text-margin-y": 0,
      },
    },
    {
      selector: "node.user.target",
      style: { "background-color": c.rust, "border-color": c.rust, color: c.onRust, "font-weight": 500, "font-size": 10.5, height: 24 },
    },
    {
      selector: "node.host.target",
      style: { width: 26, height: 23, "border-width": 1.6 },
    },
    {
      selector: "edge",
      style: { width: 1, "line-color": c.rust, "line-opacity": 0.45, "curve-style": "straight" },
    },
    {
      selector: "edge.faint",
      style: { "line-opacity": 0.18 },
    },
    {
      selector: "edge.toHost",
      style: { "line-color": c.text, "line-opacity": 0.8, "line-style": "dashed", "line-dash-pattern": [3, 3] },
    },
  ];
}

export function EntityGraph({ incident }: { incident: Incident }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [colors, setColors] = useState<Colors | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setColors(themeColors(el));
    const measure = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) => (prev && prev.w === Math.round(r.width) && prev.h === Math.round(r.height) ? prev : { w: Math.round(r.width), h: Math.round(r.height) }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const graph = useMemo(() => (size ? buildElements(incident.entities, size.w, size.h) : null), [incident.entities, size]);
  const sheet = useMemo(() => (colors ? stylesheet(colors) : null), [colors]);
  const { users, ips, hosts } = incident.entities;

  return (
    <div className={styles.wrap}>
      <div
        ref={boxRef}
        className={styles.graph}
        role="img"
        aria-label={`${ips.length} addresses, ${users.length} users and ${hosts.length} hosts involved${users[0] ? `; the target is ${users[0]}` : ""}.`}
      >
        {graph && sheet && size && (
          <CytoscapeComponent
            key={`${incident.id}-${size.w}x${size.h}`}
            elements={graph.els}
            stylesheet={sheet}
            layout={{ name: "preset", fit: false }}
            style={{ width: size.w, height: size.h }}
            userZoomingEnabled={false}
            userPanningEnabled={false}
            boxSelectionEnabled={false}
            autoungrabify
            autounselectify
          />
        )}
      </div>
      <div className={styles.legend} aria-hidden="true">
        <span>
          <svg width="10" height="10">
            <circle cx="5" cy="5" r="4" fill="none" stroke="var(--rust)" strokeWidth="1.3" />
          </svg>
          ADDRESS
        </span>
        <span>
          <svg width="14" height="10">
            <rect x="1" y="1.5" width="12" height="7" rx="2.5" fill="none" stroke="var(--text)" strokeWidth="1.2" />
          </svg>
          USER
        </span>
        <span>
          <svg width="11" height="10">
            <polygon points="5.5,0.8 10,3 10,7 5.5,9.2 1,7 1,3" fill="none" stroke="var(--text)" strokeWidth="1.1" />
          </svg>
          HOST
        </span>
        {graph && graph.shown < graph.total && <span className={styles.capped}>SHOWING {graph.shown} OF {graph.total}</span>}
      </div>
    </div>
  );
}
