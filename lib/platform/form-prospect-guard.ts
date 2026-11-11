'use client';

/**
 * The builder refuses a change that breaks a form which creates a prospect
 * (part 3, session W3; PRD V1.0 "Forms"): removing its name or phone field,
 * moving one out, renaming it, making it optional, or turning the switch on
 * for a form that lacks one. The rule is `refusedProspectChange`
 * (lib/platform/form-prospect.ts).
 *
 * Every way a page's layers change (delete, move, settings, paste, undo) ends
 * in the pages store's `set`, so the rule sits there once, as a wrapper of the
 * store's creator: a refused change is not applied, and a toast says why.
 * ycode's actions are untouched.
 */

import { toast } from 'sonner';
import type { StateCreator } from 'zustand';
import { refusedDraftsChange, type FormRuleLayer } from '@/lib/platform/form-prospect';

interface WithDrafts {
  draftsByPageId: Record<string, { layers: unknown[] } | undefined>;
}

type Drafts = Record<string, { layers: FormRuleLayer[] } | undefined>;

export function guardProspectForms<T extends WithDrafts>(creator: StateCreator<T>, report: (reason: string) => void = (reason) => toast.error(reason)): StateCreator<T> {
  return (set, get, api) => {
    const guarded = ((partial: unknown, replace?: boolean) => {
      const current = get();
      const next = (typeof partial === 'function' ? (partial as (state: T) => Partial<T>)(current) : partial) as Partial<T>;
      const reason = next?.draftsByPageId ? refusedDraftsChange(current.draftsByPageId as Drafts, next.draftsByPageId as Drafts) : null;
      if (reason) {
        report(reason);
        return;
      }
      (set as (partial: Partial<T>, replace?: boolean) => void)(next, replace);
    }) as typeof set;
    return creator(guarded, get, api);
  };
}
