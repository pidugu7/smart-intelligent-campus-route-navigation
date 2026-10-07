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

// ── Phase 6: priority-aware collision policy (offset / fade / leader line) ──

/**
 * The extra context the richer policy needs (everything is optional — with
 * an empty context the policy degrades to "major/medium/detail by tier",
 * which is exactly the Phase 4.1 behaviour).
 */
export interface LabelContext {
  hoveredId?: string | null;
  selectedId?: string | null;
  originId?: string | null;
  destinationId?: string | null;
  /** Route stops (the path's vertex ids, any order). */
  routeIds?: readonly string[];
}

export type LabelVerdict = 'show' | 'offset' | 'fade' | 'hide';

export interface LabelDecision {
  id: string;
  verdict: LabelVerdict;
  /** Vertical screen-space offset in px (positive = up); non-zero only for 'offset'. */
  offsetY: number;
  /** 0..1 — how strongly the label is emphasised (route stops get a boost). */
  emphasis: number;
}

/**
 * Priority order (highest wins collisions):
 *   1 hovered · 2 selected · 3 origin · 4 destination · 5 route stops
 *   6 major landmarks · 7 other labels (medium/detail)
 */
function priorityOf(p: LabelPlacement, ctx: LabelContext): number {
  if (p.id === ctx.hoveredId) return 0;
  if (p.id === ctx.selectedId) return 1;
  if (p.id === ctx.originId) return 2;
  if (p.id === ctx.destinationId) return 3;
  if (ctx.routeIds !== undefined && ctx.routeIds.includes(p.id)) return 4;
  if (p.tier === 'major') return 5;
  if (p.tier === 'medium') return 6;
  return 7;
}

/** Candidate vertical offsets (px) to try before giving up and fading. */
function offsetCandidates(halfHeight: number): number[] {
  const step = halfHeight + 7;
  return [step, -step, step * 2, -step * 2];
}

function shifted(rect: ScreenRect, dy: number): ScreenRect {
  return { left: rect.left, top: rect.top - dy, right: rect.right, bottom: rect.bottom - dy };
}

/**
 * Decide, per label: show / offset (with a leader line) / fade / hide.
 *
 * Rules:
 *  - zoom tiers still apply (far → major+essentials only) — that is the only
 *    'hide' source, and it is tier-based, never "random";
 *  - labels are placed greedily by priority (hovered > selected > origin >
 *    destination > route stops > major > other, nearer-to-camera first);
 *  - on collision a label first tries vertical offsets (above/below, two
 *    steps) — placed there with a leader line when it fits;
 *  - if no offset fits it FADES to low opacity instead of disappearing
 *    (the hovered label is the exception: it is always shown, even over
 *    others, since it is the one being actively inspected).
 */
export function resolveLabels(
  placements: readonly LabelPlacement[],
  cameraDistance: number,
  ctx: LabelContext,
): Map<string, LabelDecision> {
  const decisions = new Map<string, LabelDecision>();
  const ctxRoute = new Set(ctx.routeIds ?? []);
  for (const p of placements) {
    const essential =
      p.id === ctx.hoveredId || p.id === ctx.selectedId || p.id === ctx.originId || p.id === ctx.destinationId;
    const tierOk = tierAllowed(p.tier, cameraDistance);
    if (!essential && !tierOk) {
      decisions.set(p.id, { id: p.id, verdict: 'hide', offsetY: 0, emphasis: 0 });
      continue;
    }
    decisions.set(p.id, { id: p.id, verdict: 'show', offsetY: 0, emphasis: ctxRoute.has(p.id) ? 1 : 0 });
  }

  const candidates = placements
    .filter((p) => decisions.get(p.id)!.verdict !== 'hide')
    .sort((a, b) => {
      const pr = priorityOf(a, ctx) - priorityOf(b, ctx);
      if (pr !== 0) return pr;
      return a.distance - b.distance;
    });

  const placed: ScreenRect[] = [];
  for (const c of candidates) {
    const d = decisions.get(c.id)!;
    const hoverWin = c.id === ctx.hoveredId;
    if (!placed.some((r) => rectsIntersect(r, c.rect))) {
      placed.push(c.rect);
      continue; // fits where it is
    }
    const halfH = (c.rect.bottom - c.rect.top) / 2;
    let resolved = false;
    for (const dy of offsetCandidates(halfH)) {
      const r = shifted(c.rect, dy);
      if (!placed.some((o) => rectsIntersect(o, r))) {
        placed.push(r);
        d.verdict = 'offset';
        d.offsetY = dy;
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      if (hoverWin) {
        // Hovered label always wins — it may overlap lower-priority labels.
        placed.push(c.rect);
      } else {
        d.verdict = 'fade';
        d.offsetY = 0;
      }
    }
  }
  return decisions;
}
