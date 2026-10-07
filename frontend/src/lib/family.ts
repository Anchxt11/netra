// Attack families = the five sectors of the THREAT SCOPE. Spec: docs/DATA_CONTRACT.md, "Attack families".
import type { AttackType } from "../data/types.ts";

export type Family = "IDENTITY" | "WEB" | "FLOOD" | "DATA" | "ADMIN";

/** Sector centres in degrees, 0 = right, clockwise (SVG convention). */
export const FAMILY_CENTRE: Record<Family, number> = {
  IDENTITY: -100,
  WEB: -20,
  FLOOD: 50,
  DATA: 125,
  ADMIN: 195,
};

export const FAMILIES = Object.keys(FAMILY_CENTRE) as Family[];

const FAMILY_OF: Record<AttackType, Family> = {
  brute_force: "IDENTITY",
  credential_stuffing: "IDENTITY",
  account_takeover: "IDENTITY",
  web_scan: "WEB",
  http_flood: "FLOOD",
  data_exfiltration: "DATA",
  admin_abuse: "ADMIN",
  // An anomaly the AI engine cannot name: shown with probing for now (a sector of its own is a design decision).
  unusual_activity: "WEB",
};

export const familyOf = (type: AttackType): Family => FAMILY_OF[type];

// The spec says 72° sectors, but the centres are only 65° to 80° apart, so blips
// spread ±26° around their centre: neighbouring families can never touch.
export const BLIP_SPREAD = 26;

/** Sector edges (for divider lines): halfway between neighbouring centres. */
export function sectorEdges(): number[] {
  const centres = FAMILIES.map((f) => FAMILY_CENTRE[f]);
  return centres.map((c, i) => {
    const next = i === centres.length - 1 ? centres[0] + 360 : centres[i + 1];
    return (c + next) / 2;
  });
}

/** Stable 0..1 hash (FNV-1a) so a blip never jumps between renders. */
export function hash01(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

export function blipAngle(incidentId: string, type: AttackType): number {
  return FAMILY_CENTRE[familyOf(type)] + (hash01(incidentId) * 2 - 1) * BLIP_SPREAD;
}

/** Distance from centre: centre = no time left, outer ring = 10+ minutes. */
export const blipDistance = (timeLeftMinutes: number, radius: number) => Math.min(timeLeftMinutes / 10, 1) * radius;

/** Blip size in px: 2.5 at attention 0, 7 at attention 100. */
export const blipSize = (attention: number) => 2.5 + (attention / 100) * 4.5;
