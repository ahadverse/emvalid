import type { ReactNode, SVGProps } from 'react';

/**
 * The icon set, drawn inline.
 *
 * No icon library. The whole set below is smaller than the import statement's
 * worth of JavaScript any of them would add, it renders on the server with no
 * hydration, and it cannot ship a second visual language into a design that
 * already has one.
 *
 * House rules, so a new icon never looks bolted on:
 *   · 24×24 box, 1.5 stroke, round caps and joins
 *   · stroke only — no fills, so every icon inherits `currentColor`
 *   · `aria-hidden` by default; the label lives on the control, not the glyph
 */

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  className?: string;
}

function Glyph({ children, className = 'h-4 w-4', ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

/**
 * The product mark: an envelope whose flap is also a checkmark.
 *
 * Filled rather than stroked, and the only icon that breaks the house rules —
 * a logo has to hold up at 20px in a browser tab, where a 1.5px stroke
 * disappears.
 */
export function Logo({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="2" y="4.5" width="20" height="15" rx="3.5" fill="currentColor" opacity="0.18" />
      <path
        d="M3.2 7.4 12 13.2l8.8-5.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8.6 16.1 11 18.5l5.2-5.6"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect
        x="2"
        y="4.5"
        width="20"
        height="15"
        rx="3.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function Check(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m4.5 12.5 5 5 10-11" />
    </Glyph>
  );
}

export function Close(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Glyph>
  );
}

export function Alert(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 8.5v4.5M12 16.5h.01" />
      <path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </Glyph>
  );
}

export function Info(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8h.01" />
    </Glyph>
  );
}

export function Dash(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M6 12h12" />
    </Glyph>
  );
}

export function Upload(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 15.5V3.8M8.2 7.6 12 3.8l3.8 3.8" />
      <path d="M4 15.2v3.1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.1" />
    </Glyph>
  );
}

export function Download(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.8v11.7M8.2 11.7 12 15.5l3.8-3.8" />
      <path d="M4 15.2v3.1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3.1" />
    </Glyph>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5Z" />
      <path d="M13.5 3v4.5a1 1 0 0 0 1 1H19" />
    </Glyph>
  );
}

export function Mail(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="m3.5 7.5 8.5 5.5 8.5-5.5" />
    </Glyph>
  );
}

export function Key(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="7.5" cy="15.5" r="4" />
      <path d="m10.4 12.6 8.4-8.4M16.4 6.6l2.2 2.2M14 9l2.2 2.2" />
    </Glyph>
  );
}

export function Layers(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3.4 12.4 8.6 4.8 8.6-4.8M3.4 16.4l8.6 4.8 8.6-4.8" />
    </Glyph>
  );
}

export function Shield(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 21c4.4-1.9 7-5.4 7-9.6V5.9l-7-2.9-7 2.9v5.5c0 4.2 2.6 7.7 7 9.6Z" />
      <path d="m9 11.6 2.2 2.2L15.2 9.8" />
    </Glyph>
  );
}

export function Globe(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.2 9.5h17.6M3.2 14.5h17.6" />
      <path d="M12 3c2.3 2.4 3.5 5.5 3.5 9s-1.2 6.6-3.5 9c-2.3-2.4-3.5-5.5-3.5-9S9.7 5.4 12 3Z" />
    </Glyph>
  );
}

export function Bolt(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M13.2 2.5 4.4 13.2a.6.6 0 0 0 .5 1h5.4l-.7 7.3 8.8-10.7a.6.6 0 0 0-.5-1h-5.4l.7-7.3Z" />
    </Glyph>
  );
}

export function Clock(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.2V12l3.2 2" />
    </Glyph>
  );
}

export function Search(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.2 16.2 4.3 4.3" />
    </Glyph>
  );
}

export function Copy(props: IconProps) {
  return (
    <Glyph {...props}>
      <rect x="9" y="9" width="11.5" height="11.5" rx="2.2" />
      <path d="M15 6.2V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V13a2 2 0 0 0 2 2h.7" />
    </Glyph>
  );
}

export function Trash(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 6.5h15M9.5 6.5V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v1.5" />
      <path d="M6.3 6.5 7 19.2a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8l.7-12.7" />
    </Glyph>
  );
}

export function Plus(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M12 5.5v13M5.5 12h13" />
    </Glyph>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 12h15M13.5 6l6 6-6 6" />
    </Glyph>
  );
}

export function ArrowLeft(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />
    </Glyph>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </Glyph>
  );
}

export function Sun(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M4.4 4.4l1.6 1.6M18 18l1.6 1.6M2.6 12h2.2M19.2 12h2.2M4.4 19.6 6 18M18 6l1.6-1.6" />
    </Glyph>
  );
}

export function Moon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M20.2 14.2A8.4 8.4 0 0 1 9.8 3.8a8.6 8.6 0 1 0 10.4 10.4Z" />
    </Glyph>
  );
}

export function Menu(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Glyph>
  );
}

export function Spinner({ className = 'h-4 w-4' }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={`animate-spin ${className}`}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
