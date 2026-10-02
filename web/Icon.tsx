import type { CSSProperties } from 'react';

const paths: Record<string, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M12 19V5m-6 6 6-6 6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
  back: <path d="m15 5-7 7 7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  code: <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16" />,
  browser: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M7 6.5h.01m3 0h.01" /></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3m6 1h4" /></>,
  folder: <path d="M3 7V5h6l2 2h10v12H3Z" />,
  file: <><path d="M14 3H5v18h14V8Z" /><path d="M14 3v5h5M8 13h8m-8 4h5" /></>,
  settings: <><path d="m9 3-1 3-3 1-2 3 2 2v3l3 2 1 4h6l1-4 3-2v-3l2-2-2-3-3-1-1-3Z" /><circle cx="12" cy="12" r="3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  play: <path d="m8 4 12 8-12 8Z" />,
  hand: <><path d="M9 12V5a2 2 0 0 1 4 0v6-5a2 2 0 0 1 4 0v5-3a2 2 0 0 1 4 0v7c0 5-3 7-7 7-3 0-5-2-7-5l-3-4a2 2 0 0 1 3-3l2 2Z" /></>,
  refresh: <><path d="M20 7a9 9 0 1 0 1 7M20 3v5h-5" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
  copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V3H3v13h5" /></>,
  chat: <path d="M4 4h16v13H8l-4 4Z" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" /></>,
  alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6m0 3v1" /></>,
  trash: <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>,
};
export function Icon({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name] || paths.file}</svg>;
}
export function PiMark({ size = 28 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="currentColor" /><path d="M9 11h15M12 11l-1 12m9-12v9q0 3 3 3" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" /></svg>;
}
