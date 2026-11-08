/**
 * The stylesheet of the store elements (part 2, session W4): the store pages'
 * own design system (handoff/store/DESIGN_SYSTEM.md) and the rules of the
 * handoff files for the grid, the card, the chips, the search field, the empty
 * and error panels, the skeleton and the cart indicator.
 *
 * Every colour, size and spacing value is one of the design system's
 * variables, declared once on `.ws-store` (prefixed `--ws-`, so nothing the
 * page defines is read or changed). The literals left are the structural ones
 * the handoff also keeps: percentages, aspect ratios, the 960 px breakpoint
 * (a custom property cannot be used in a media query), line clamps and the
 * motion durations.
 *
 * The three colours a shop changes are not fixed here: `--ws-store-primary`,
 * `--ws-store-primary-soft` and `--ws-store-dark` are the site's colour
 * variables of those names when the element has them in its style
 * (lib/platform/store-elements/colours.ts), and the design system's defaults
 * when it has not.
 *
 * Motion (notebook decision 16g, the `animate` skill): the skeleton pulses in
 * opacity only and the cart badge settles from a slightly smaller size, both
 * off under `prefers-reduced-motion: reduce`; colour changes on hover run only
 * where there is hover and no reduced-motion request.
 *
 * The product page (session W5) adds two. The picker's chips and the
 * thumbnails change colour, border and ring when chosen (state indication, 150
 * ms, `ease`; instant under reduced motion) and press in a little (100 ms,
 * ease-out, only without a reduced-motion request). The "added" notice
 * (feedback, seen once per add to cart) rises 4 px and fades in over 200 ms on
 * the strong ease-out; under reduced motion it only fades.
 *
 * Written as one string so every render path can carry it: the React elements
 * (canvas and published) put it in a <style> inside the element, and the HTML
 * string path (layerToHtml) writes the same text.
 */

/** The family the pages use, from the platform's font mirror (lib/platform/store-elements/fonts.ts), never from Google. */
export const STORE_FONT_FAMILY = 'IBM Plex Sans Arabic';

export const STORE_CSS = `
.ws-store{
--ws-primary:var(--ws-store-primary,#0F766E);--ws-primary-soft:var(--ws-store-primary-soft,#E7F3F1);--ws-dark:var(--ws-store-dark,#17201E);
--ws-white:#FFFFFF;--ws-grey-50:#F6F7F7;--ws-grey-100:#EEF0F0;--ws-grey-200:#E0E4E3;--ws-grey-300:#C7CDCB;--ws-grey-500:#5F6966;--ws-grey-700:#3D4644;
--ws-font:"IBM Plex Sans Arabic",system-ui,sans-serif;--ws-fw-regular:400;--ws-fw-medium:500;--ws-fw-semibold:600;--ws-fw-bold:700;
--ws-text-xs:12px;--ws-text-sm:14px;--ws-text-md:16px;--ws-text-lg:18px;--ws-text-2xl:28px;--ws-text-3xl:36px;--ws-lh-tight:1.3;--ws-lh-normal:1.6;
--ws-space-1:4px;--ws-space-2:8px;--ws-space-3:12px;--ws-space-4:16px;--ws-space-5:20px;--ws-space-6:24px;--ws-space-7:32px;--ws-space-8:40px;--ws-space-9:48px;--ws-space-10:64px;
--ws-radius-sm:6px;--ws-radius-md:10px;--ws-radius-lg:16px;--ws-radius-full:999px;
--ws-border:1px;--ws-border-strong:2px;--ws-icon-stroke:1.75;--ws-size-icon-sm:16px;--ws-size-icon:20px;--ws-size-icon-lg:32px;--ws-size-icon-xl:64px;
--ws-size-badge:20px;--ws-size-touch:44px;--ws-size-control:48px;--ws-size-search:320px;--ws-size-text:420px;
box-sizing:border-box;font-family:var(--ws-font);font-size:var(--ws-text-md);line-height:var(--ws-lh-normal);color:var(--ws-dark)}
.ws-store *,.ws-store *::before,.ws-store *::after{box-sizing:border-box}
.ws-store a{color:inherit;text-decoration:none}
.ws-store button,.ws-store input{font-family:inherit}
.ws-store h2,.ws-store p{margin:0}
.ws-store .ws-icon{flex:none;width:var(--ws-size-icon);height:var(--ws-size-icon);fill:none;stroke:currentColor;stroke-width:var(--ws-icon-stroke);stroke-linecap:round;stroke-linejoin:round}
.ws-store .ws-icon-sm{width:var(--ws-size-icon-sm);height:var(--ws-size-icon-sm)}
.ws-store .ws-icon-lg{width:var(--ws-size-icon-lg);height:var(--ws-size-icon-lg)}
.ws-store .ws-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.ws-store .ws-clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ws-store .ws-no-scrollbar{scrollbar-width:none}.ws-store .ws-no-scrollbar::-webkit-scrollbar{display:none}
.ws-store a:focus-visible,.ws-store button:focus-visible,.ws-store input:focus-visible{outline:var(--ws-border-strong) solid var(--ws-primary);outline-offset:var(--ws-border-strong)}
.ws-store .ws-input:not([disabled]):focus{border-color:var(--ws-primary)}
.ws-store .ws-grid-root{display:flex;flex-direction:column;gap:var(--ws-space-5)}
.ws-store .ws-toolbar{display:flex;flex-direction:column;gap:var(--ws-space-4)}
.ws-store .ws-search{position:relative;width:100%}
.ws-store .ws-search-icon{position:absolute;inset-inline-start:var(--ws-space-4);top:50%;transform:translateY(-50%);color:var(--ws-grey-500);pointer-events:none}
.ws-store .ws-input{width:100%;min-height:var(--ws-size-control);padding:var(--ws-space-2) var(--ws-space-4);border:var(--ws-border) solid var(--ws-grey-300);border-radius:var(--ws-radius-md);background:var(--ws-white);color:var(--ws-dark);font-size:var(--ws-text-md);line-height:var(--ws-lh-normal)}
.ws-store .ws-input::placeholder{color:var(--ws-grey-500)}
.ws-store .ws-search-input{padding-inline-start:calc(var(--ws-space-4) + var(--ws-size-icon) + var(--ws-space-2))}
.ws-store .ws-chips{display:flex;gap:var(--ws-space-2);overflow-x:auto;margin-inline:calc(var(--ws-space-4) * -1);padding-inline:var(--ws-space-4)}
.ws-store .ws-chip{flex:none;display:inline-flex;align-items:center;justify-content:center;gap:var(--ws-space-1);min-height:var(--ws-size-touch);padding-inline:var(--ws-space-4);border:var(--ws-border) solid var(--ws-grey-300);border-radius:var(--ws-radius-full);background:var(--ws-white);color:var(--ws-dark);font-size:var(--ws-text-sm);font-weight:var(--ws-fw-medium);line-height:var(--ws-lh-tight);white-space:nowrap;cursor:pointer}
.ws-store .ws-chip-on{border-color:var(--ws-primary);background:var(--ws-primary);color:var(--ws-white)}
.ws-store .ws-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--ws-space-6) var(--ws-space-3)}
.ws-store .ws-card{display:flex;flex-direction:column;gap:var(--ws-space-2);min-width:0}
.ws-store .ws-card-media{display:block;margin-bottom:var(--ws-space-1)}
.ws-store .ws-ph{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--ws-space-2);width:100%;aspect-ratio:1 / 1;padding:var(--ws-space-2);border-radius:var(--ws-radius-lg);background:var(--ws-grey-100);color:var(--ws-grey-500);text-align:center;overflow:hidden}
.ws-store .ws-ph-img{padding:0}
.ws-store .ws-ph-icon{color:var(--ws-grey-300)}
.ws-store .ws-ph-label{font-size:var(--ws-text-xs);line-height:var(--ws-lh-tight)}
.ws-store .ws-ph img{display:block;width:100%;height:100%;object-fit:cover;margin:0;padding:0;max-width:none}
.ws-store .ws-card-name{font-size:var(--ws-text-sm);font-weight:var(--ws-fw-medium);line-height:var(--ws-lh-tight)}
.ws-store .ws-card-price{font-size:var(--ws-text-md);font-weight:var(--ws-fw-bold)}
.ws-store .ws-card-from{color:var(--ws-grey-500);font-size:var(--ws-text-sm);font-weight:var(--ws-fw-regular)}
.ws-store .ws-card-btn{margin-top:auto}
.ws-store .ws-btn{display:inline-flex;align-items:center;justify-content:center;gap:var(--ws-space-2);min-height:var(--ws-size-control);padding-inline:var(--ws-space-5);border:var(--ws-border) solid transparent;border-radius:var(--ws-radius-md);font-size:var(--ws-text-md);font-weight:var(--ws-fw-semibold);line-height:var(--ws-lh-tight);text-decoration:none;white-space:nowrap;cursor:pointer}
.ws-store .ws-btn-primary{border-color:var(--ws-primary);background:var(--ws-primary);color:var(--ws-white)}
.ws-store .ws-btn-outline{border-color:var(--ws-primary);background:var(--ws-white);color:var(--ws-primary)}
.ws-store .ws-btn-sm{min-height:var(--ws-size-touch);padding-inline:var(--ws-space-3);font-size:var(--ws-text-sm)}
.ws-store .ws-btn-block{width:100%}
.ws-store .ws-btn[disabled]{cursor:progress;opacity:0.8}
.ws-store .ws-more{display:flex;justify-content:center;padding-top:var(--ws-space-2)}
.ws-store .ws-card-link:hover{color:var(--ws-primary)}
.ws-store .ws-empty{display:flex;flex-direction:column;align-items:center;gap:var(--ws-space-3);padding:var(--ws-space-9) var(--ws-space-5);border:var(--ws-border) dashed var(--ws-grey-300);border-radius:var(--ws-radius-lg);background:var(--ws-grey-50);text-align:center}
.ws-store .ws-empty-icon{display:flex;align-items:center;justify-content:center;width:var(--ws-size-icon-xl);height:var(--ws-size-icon-xl);border-radius:var(--ws-radius-full);background:var(--ws-primary-soft);color:var(--ws-primary)}
.ws-store .ws-empty-title{font-size:var(--ws-text-lg);font-weight:var(--ws-fw-bold);line-height:var(--ws-lh-tight)}
.ws-store .ws-empty-text{margin-bottom:var(--ws-space-2);max-width:var(--ws-size-text);color:var(--ws-grey-500);font-size:var(--ws-text-sm)}
.ws-store .ws-alert{display:flex;align-items:flex-start;gap:var(--ws-space-3);padding:var(--ws-space-4);border:var(--ws-border-strong) solid var(--ws-dark);border-radius:var(--ws-radius-md);background:var(--ws-white)}
.ws-store .ws-alert-body{flex:1 1 auto;display:flex;flex-direction:column;gap:var(--ws-space-2);min-width:0}
.ws-store .ws-alert-title{font-weight:var(--ws-fw-bold);line-height:var(--ws-lh-tight)}
.ws-store .ws-alert-text{color:var(--ws-grey-700);font-size:var(--ws-text-sm)}
.ws-store .ws-alert-actions{display:flex;flex-wrap:wrap;gap:var(--ws-space-2);margin-top:var(--ws-space-1)}
.ws-store .ws-sk{background:var(--ws-grey-100);border-radius:var(--ws-radius-sm);animation:ws-pulse 1.4s ease-in-out infinite}
.ws-store .ws-sk-media{aspect-ratio:1 / 1;margin-bottom:var(--ws-space-1);border-radius:var(--ws-radius-lg)}
.ws-store .ws-sk-line{height:var(--ws-space-4)}
.ws-store .ws-sk-short{width:50%}
.ws-store .ws-sk-btn{height:var(--ws-size-touch);margin-top:var(--ws-space-1);border-radius:var(--ws-radius-md)}
.ws-store .ws-cart{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:var(--ws-space-2);min-width:var(--ws-size-touch);min-height:var(--ws-size-touch);padding-inline:var(--ws-space-3);border-radius:var(--ws-radius-full);background:var(--ws-grey-100);color:var(--ws-dark);font-size:var(--ws-text-sm);font-weight:var(--ws-fw-semibold)}
.ws-store .ws-cart-label{display:none}
.ws-store .ws-badge{position:absolute;top:calc(var(--ws-space-1) * -1);inset-inline-end:calc(var(--ws-space-1) * -1);display:inline-flex;align-items:center;justify-content:center;min-width:var(--ws-size-badge);height:var(--ws-size-badge);padding-inline:var(--ws-space-1);border:var(--ws-border-strong) solid var(--ws-white);border-radius:var(--ws-radius-full);background:var(--ws-primary);color:var(--ws-white);font-size:var(--ws-text-xs);font-weight:var(--ws-fw-bold);line-height:1}
.ws-store .ws-badge[data-changed]{animation:ws-badge-settle 160ms cubic-bezier(0.23,1,0.32,1)}
.ws-store .ws-pd{display:flex;flex-direction:column;gap:var(--ws-space-6)}
.ws-store .ws-gallery{display:flex;flex-direction:column;gap:var(--ws-space-3)}
.ws-store .ws-thumbs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--ws-space-2)}
.ws-store .ws-thumb{display:block;padding:0;border:var(--ws-border) solid var(--ws-grey-200);border-radius:var(--ws-radius-md);background:var(--ws-grey-100);overflow:hidden;cursor:pointer}
.ws-store .ws-thumb-on{border-color:var(--ws-primary);box-shadow:inset 0 0 0 var(--ws-border) var(--ws-primary)}
.ws-store .ws-thumb .ws-ph{border-radius:var(--ws-radius-md)}
.ws-store .ws-info{display:flex;flex-direction:column;gap:var(--ws-space-5);min-width:0}
.ws-store .ws-pd-head{display:flex;flex-direction:column;gap:var(--ws-space-2)}
.ws-store .ws-pd-title{margin:0;font-size:var(--ws-text-2xl);line-height:var(--ws-lh-tight);font-weight:var(--ws-fw-bold)}
.ws-store .ws-sku{margin:0;color:var(--ws-grey-500);font-size:var(--ws-text-sm)}
.ws-store .ws-pd-price{margin:0;font-size:var(--ws-text-2xl);font-weight:var(--ws-fw-bold);line-height:var(--ws-lh-tight)}
.ws-store .ws-pd-from{color:var(--ws-grey-500);font-size:var(--ws-text-md);font-weight:var(--ws-fw-regular)}
.ws-store .ws-pd-unit{color:var(--ws-grey-500);font-size:var(--ws-text-md);font-weight:var(--ws-fw-regular)}
.ws-store .ws-fs{display:flex;flex-direction:column;gap:var(--ws-space-2);min-width:0;margin:0;padding:0;border:0}
.ws-store .ws-legend{margin-bottom:var(--ws-space-2);padding:0;color:var(--ws-grey-700);font-size:var(--ws-text-sm)}
.ws-store .ws-legend-val{color:var(--ws-dark);font-weight:var(--ws-fw-semibold)}
.ws-store .ws-opts{display:flex;flex-wrap:wrap;gap:var(--ws-space-2)}
.ws-store .ws-opt{display:inline-flex;align-items:center;justify-content:center;gap:var(--ws-space-1);min-width:var(--ws-size-control);min-height:var(--ws-size-touch);padding-inline:var(--ws-space-4);border:var(--ws-border) solid var(--ws-grey-300);border-radius:var(--ws-radius-md);background:var(--ws-white);color:var(--ws-dark);font-size:var(--ws-text-sm);font-weight:var(--ws-fw-medium);line-height:var(--ws-lh-tight);white-space:nowrap;cursor:pointer}
.ws-store .ws-opt-on{border-color:var(--ws-primary);box-shadow:inset 0 0 0 var(--ws-border) var(--ws-primary);background:var(--ws-primary-soft);font-weight:var(--ws-fw-semibold)}
.ws-store .ws-opt-off{border-style:dashed;background:var(--ws-grey-50);color:var(--ws-grey-500);cursor:not-allowed}
.ws-store .ws-strike{text-decoration:line-through}
.ws-store .ws-opt-note{font-size:var(--ws-text-xs);font-weight:var(--ws-fw-regular)}
.ws-store .ws-buy{display:flex;align-items:stretch;gap:var(--ws-space-3)}
.ws-store .ws-buy-btn{flex:1 1 auto}
.ws-store .ws-stepper{flex:none;display:inline-flex;align-items:stretch;height:var(--ws-size-control);border:var(--ws-border) solid var(--ws-grey-300);border-radius:var(--ws-radius-md);background:var(--ws-white);overflow:hidden}
.ws-store .ws-step-btn{display:flex;align-items:center;justify-content:center;width:var(--ws-size-touch);padding:0;border:0;background:var(--ws-white);color:var(--ws-dark);cursor:pointer}
.ws-store .ws-step-btn[disabled]{color:var(--ws-grey-300);cursor:not-allowed}
.ws-store .ws-step-val{width:var(--ws-size-touch);padding:0;border:0;background:var(--ws-white);color:var(--ws-dark);font-size:var(--ws-text-md);font-weight:var(--ws-fw-semibold);text-align:center}
.ws-store .ws-notice{display:flex;flex-wrap:wrap;align-items:center;gap:var(--ws-space-1) var(--ws-space-3);padding:var(--ws-space-2) var(--ws-space-4);border-radius:var(--ws-radius-md);background:var(--ws-primary-soft);color:var(--ws-dark);font-size:var(--ws-text-sm);animation:ws-notice-in 200ms cubic-bezier(0.23,1,0.32,1)}
.ws-store .ws-notice-icon{color:var(--ws-primary)}
.ws-store .ws-notice-text{flex:1 1 auto;font-weight:var(--ws-fw-medium)}
.ws-store .ws-notice-link{display:inline-flex;align-items:center;min-height:var(--ws-size-touch);color:var(--ws-primary);font-weight:var(--ws-fw-semibold)}
.ws-store .ws-card-note{font-size:var(--ws-text-xs);color:var(--ws-grey-700);line-height:var(--ws-lh-tight)}
.ws-store .ws-divider{height:0;margin:0;border:0;border-top:var(--ws-border) solid var(--ws-grey-200)}
.ws-store .ws-stack-2{display:flex;flex-direction:column;gap:var(--ws-space-2)}
.ws-store .ws-h2{margin:0;font-size:var(--ws-text-lg);line-height:var(--ws-lh-tight);font-weight:var(--ws-fw-bold)}
.ws-store .ws-desc{color:var(--ws-grey-700);white-space:pre-line}
.ws-store .ws-sk-title{height:var(--ws-space-6);width:70%}
.ws-store .ws-sk-chips{display:flex;gap:var(--ws-space-2)}
.ws-store .ws-sk-chip{width:var(--ws-size-control);height:var(--ws-size-touch);border-radius:var(--ws-radius-md)}
.ws-store .ws-sk-thumb{aspect-ratio:1 / 1;border-radius:var(--ws-radius-md)}
@keyframes ws-pulse{50%{opacity:.45}}
@keyframes ws-badge-settle{from{transform:scale(0.85)}to{transform:scale(1)}}
@keyframes ws-notice-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@keyframes ws-fade-in{from{opacity:0}to{opacity:1}}
@media (hover:hover) and (prefers-reduced-motion:no-preference){
.ws-store .ws-btn,.ws-store .ws-chip,.ws-store .ws-card-link,.ws-store .ws-input{transition:background-color 150ms ease,border-color 150ms ease,color 150ms ease}
}
@media (hover:hover){
.ws-store .ws-btn-primary:not([disabled]):hover{background:var(--ws-dark);border-color:var(--ws-dark)}
.ws-store .ws-btn-outline:not([disabled]):hover{background:var(--ws-primary-soft)}
.ws-store .ws-chip:not(.ws-chip-on):hover{border-color:var(--ws-dark)}
.ws-store .ws-opt:not(.ws-opt-on):not([disabled]):hover,.ws-store .ws-thumb:not(.ws-thumb-on):hover{border-color:var(--ws-dark)}
.ws-store .ws-notice-link:hover{text-decoration:underline}
}
@media (prefers-reduced-motion:no-preference){
.ws-store .ws-opt,.ws-store .ws-thumb{transition:background-color 150ms ease,border-color 150ms ease,box-shadow 150ms ease,color 150ms ease,transform 100ms cubic-bezier(0.23,1,0.32,1)}
.ws-store .ws-step-btn{transition:transform 100ms cubic-bezier(0.23,1,0.32,1)}
.ws-store .ws-btn.ws-buy-btn{transition:background-color 150ms ease,border-color 150ms ease,color 150ms ease,transform 100ms cubic-bezier(0.23,1,0.32,1)}
.ws-store .ws-opt:not([disabled]):active,.ws-store .ws-thumb:active,.ws-store .ws-step-btn:not([disabled]):active,.ws-store .ws-buy-btn:active{transform:scale(0.97)}
}
@media (prefers-reduced-motion:reduce){
.ws-store .ws-sk{animation:none}
.ws-store .ws-badge[data-changed]{animation:none}
.ws-store .ws-notice{animation:ws-fade-in 150ms ease}
}
@media (min-width:960px){
.ws-store .ws-toolbar{flex-direction:row;align-items:center;justify-content:space-between;gap:var(--ws-space-6)}
.ws-store .ws-search{order:2;flex:none;width:var(--ws-size-search)}
.ws-store .ws-chips{flex-wrap:wrap;overflow:visible;margin-inline:0;padding-inline:0}
.ws-store .ws-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:var(--ws-space-8) var(--ws-space-6)}
.ws-store .ws-card-name{font-size:var(--ws-text-md)}
.ws-store .ws-empty{padding-block:var(--ws-space-10)}
.ws-store .ws-cart-label{display:inline}
.ws-store .ws-pd{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--ws-space-9);align-items:start}
.ws-store .ws-pd-title{font-size:var(--ws-text-3xl)}
}
`;
