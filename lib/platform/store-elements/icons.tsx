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

export const CheckIcon = ({ className }: { className?: string }) => (
  <Svg className={className}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
);

export const MinusIcon = () => (
  <Svg><path d="M6 12h12" /></Svg>
);

export const PlusIcon = () => (
  <Svg><path d="M12 6v12" /><path d="M6 12h12" /></Svg>
);

export const BoxIcon = () => (
  <Svg className="ws-icon-lg"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5L12 12l8-4.5" /><path d="M12 12v9" /></Svg>
);

// The cart, checkout and confirmation (session W6): the handoff's own paths.

export const TrashIcon = () => (
  <Svg className="ws-icon-sm"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /></Svg>
);

/** A back arrow; it turns round on a right to left page. */
export const ArrowBackIcon = () => (
  <Svg className="ws-icon-sm ws-flip"><path d="M19 12H5" /><path d="M11 6l-6 6 6 6" /></Svg>
);

/** The breadcrumb's separator, the handoff's chevron; it turns round on a right to left page. */
export const ChevronIcon = () => (
  <Svg className="ws-icon-sm ws-flip"><path d="M9 6l6 6-6 6" /></Svg>
);

export const ChevronDownIcon = ({ className = '' }: { className?: string }) => (
  <Svg className={className}><path d="M6 9l6 6 6-6" /></Svg>
);

export const CashIcon = () => (
  <Svg className="ws-cod-icon"><path d="M3 7h18v10H3z" /><path d="M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z" /><path d="M6 10v.01" /><path d="M18 14v.01" /></Svg>
);

/** The "no longer available" tag's mark: the alert circle, small. */
export const AlertSmallIcon = () => (
  <Svg className="ws-icon-sm"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" /><path d="M12 8v5" /><path d="M12 16.5v.01" /></Svg>
);
