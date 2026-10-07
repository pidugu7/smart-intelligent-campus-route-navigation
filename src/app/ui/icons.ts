/**
 * app/ui/icons.ts
 *
 * Dependency-free inline SVG icons (24×24, stroke = currentColor).
 * No emoji, no icon fonts — crisp at any zoom and trivially themeable.
 * Every icon is rendered into a <button> that also carries an accessible
 * label + tooltip (aria-label + title) in its caller.
 */

export type IconName =
  | 'labels'
  | 'camera-reset'
  | 'sun'
  | 'moon'
  | 'quality'
  | 'fullscreen'
  | 'block'
  | 'swap'
  | 'play'
  | 'pause'
  | 'restart'
  | 'step-back'
  | 'step-forward'
  | 'route'
  | 'close'
  | 'info'
  | 'check';

const PATHS: Record<IconName, string> = {
  // location/tag
  labels:
    'M4 7h9M4 7l3-3M4 7l3 3M20 17h-9m9 0l-3-3m3 3l-3 3M13 4l-4 5 4 5-4-2M15 20l-3-4 3-4',
  // frame with a dot (reset camera / fit)
  'camera-reset': 'M4 9V5a1 1 0 011-1h4m6 0h4a1 1 0 011 1v4m0 6v4a1 1 0 01-1 1h-4M9 20H5a1 1 0 01-1-1v-4M12 9a3 3 0 100 6 3 3 0 000-6z',
  // sun
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4l1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  // crescent moon
  moon: 'M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z',
  // gauge / quality
  quality: 'M12 15a2 2 0 100-4 2 2 0 000 4zM12 13l3.5-3.5M5 19a8 8 0 1114 0',
  // expand
  fullscreen: 'M9 4H4v5m11-5h5v5M9 20H4v-5m11 5h5v-5',
  // barrier cone (block path)
  block: 'M12 4l8 14H4l8-14zM12 4v3m0 4v3m0 4v0M3 21h18',
  // swap (two arrows)
  swap: 'M7 8h10m0 0l-3-3m3 3l-3 3M17 16H7m0 0l3 3m-3-3l3-3',
  // play
  play: 'M8 5.5v13l11-6.5-11-6.5z',
  // pause
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  // restart (circular arrow)
  restart: 'M4 10a8 8 0 111.6 6.9M4 10V5m0 5h5',
  // step back (bar + triangle)
  'step-back': 'M6 5v14M18 6l-8 6 8 6V6z',
  // step forward
  'step-forward': 'M18 5v14M6 6l8 6-8 6V6z',
  // route pin-to-pin
  route: 'M5 19a2 2 0 100-4 2 2 0 000 4zM19 9a2 2 0 100-4 2 2 0 000 4zM7 17h8a3 3 0 000-6H9a3 3 0 010-6h8',
  // close
  close: 'M6 6l12 12M18 6L6 18',
  // info
  info: 'M12 11v5m0-8v.5M12 21a9 9 0 110-18 9 9 0 010 18z',
  // check
  check: 'M5 12.5l4.5 4.5L19 7',
};

/** Build an <svg> icon element (sized via CSS; stroke uses currentColor). */
export function icon(name: IconName, size = 18): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.appendChild(path);
  return svg;
}

/** A filled (non-stroke) icon for solid shapes (play/pause). */
export function iconFilled(name: 'play' | 'pause', size = 18): SVGSVGElement {
  const base = icon(name, size);
  base.setAttribute('fill', 'currentColor');
  base.setAttribute('stroke', 'none');
  return base;
}
