/** The few icons of the store elements, the handoff's own paths (24 px grid, stroke from the design system). */

import React from 'react';

const Svg = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <svg
    className={`ws-icon ${className}`.trim()} viewBox="0 0 24 24"
    aria-hidden="true"
  >{children}</svg>
);

export const SearchIcon = ({ className }: { className?: string }) => (
  <Svg className={className}><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" /><path d="M20 20l-4-4" /></Svg>
);

export const SearchOffIcon = () => (
  <Svg className="ws-icon-lg"><path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z" /><path d="M20 20l-4-4" /><path d="M9 9l4 4" /><path d="M13 9l-4 4" /></Svg>
);

export const GridIcon = () => (
  <Svg className="ws-icon-lg"><path d="M4 4h7v7H4z" /><path d="M13 4h7v7h-7z" /><path d="M4 13h7v7H4z" /><path d="M13 13h7v7h-7z" /></Svg>
);

export const ImageIcon = () => (
  <Svg className="ws-icon-lg ws-ph-icon"><path d="M4 5h16v14H4z" /><path d="M9 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" /><path d="M4 17l5-5 4 4 3-3 4 4" /></Svg>
);

export const BagIcon = () => (
  <Svg><path d="M6 7h12l-1 13H7L6 7z" /><path d="M9 7a3 3 0 0 1 6 0" /></Svg>
);

export const AlertIcon = () => (
  <Svg><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" /><path d="M12 8v5" /><path d="M12 16.5v.01" /></Svg>
);

export const RetryIcon = () => (
  <Svg className="ws-icon-sm"><path d="M20 12a8 8 0 1 1-2.3-5.6" /><path d="M20 4v4.5h-4.5" /></Svg>
);
