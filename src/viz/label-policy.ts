/**
 * viz/label-policy.ts
 *
 * Pure label-visibility policy (no three.js, no DOM): given each label's
 * screen rect, its importance tier, its "essential" flag (start /
 * destination / hovered) and the camera distance, decide which labels are
 * visible.
 *
 * Rules (Phase 4.1):
 *  - FAR zoom   (camera distance > FAR):   major labels + essentials only
 *  - MEDIUM     (MEDIUM < d ≤ FAR):        major + medium-tier labels + essentials
 *  - CLOSE      (d ≤ MEDIUM):              everything
 *  - Essentials (start, destination, hovered/selected) are always visible.
 *  - Remaining labels are greedily culled for screen-space overlap,
 *    highest priority first (essential > major > medium > detail, then
 *    nearer-to-camera first) — so important labels win collisions.
 *
 * This only controls VISIBILITY: no label data is removed.
 */

/** Camera distance beyond which only major + essential labels show. */
export const LABEL_FAR_DISTANCE = 1400;
/** Camera distance beyond which medium-tier labels also show. */
export const LABEL_MEDIUM_DISTANCE = 650;

export type LabelTier = 'major' | 'medium' | 'detail';

export interface LabelPlacement {
  id: string;
  tier: LabelTier;
  /** Start / destination / hovered — never culled. */
  essential: boolean;
  /** Camera distance to this label (used for priority ordering). */
  distance: number;
  /** Screen-space rect in CSS pixels. */
  rect: { left: number; top: number; right: number; bottom: number };
}

const TIER_PRIORITY: Record<LabelTier, number> = { major: 0, medium: 1, detail: 2 };

interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function rectsIntersect(a: ScreenRect, b: ScreenRect, pad = 2): boolean {
  return a.left < b.right + pad && a.right + pad > b.left && a.top < b.bottom + pad && a.bottom + pad > b.top;
}

function tierAllowed(tier: LabelTier, cameraDistance: number): boolean {
  if (tier === 'major') return true;
  if (tier === 'medium') return cameraDistance <= LABEL_FAR_DISTANCE;
  return cameraDistance <= LABEL_MEDIUM_DISTANCE;
}

/**
 * Decide which label ids are visible.
 * @param placements every label's current placement (screen rect + tier).
 * @param cameraDistance camera distance to the orbit target — the zoom measure.
 */
export function visibleLabelIds(placements: readonly LabelPlacement[], cameraDistance: number): Set<string> {
  const candidates = placements.filter((p) => p.essential || tierAllowed(p.tier, cameraDistance));
  candidates.sort((a, b) => {
    if (a.essential !== b.essential) return a.essential ? -1 : 1;
    const byTier = TIER_PRIORITY[a.tier] - TIER_PRIORITY[b.tier];
    if (byTier !== 0) return byTier;
    return a.distance - b.distance;
  });

  const placed: ScreenRect[] = [];
  const visible = new Set<string>();
  for (const c of candidates) {
    if (placed.some((r) => rectsIntersect(r, c.rect))) continue; // loses the collision
    placed.push(c.rect);
    visible.add(c.id);
  }
  return visible;
}
