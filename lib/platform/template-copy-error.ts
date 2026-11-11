/**
 * The error a template copy fails with. Kept apart from `template-copy.ts` so the modules that
 * template-copy imports (template-collections.ts) can throw it without importing the copy back.
 * `lib/platform/template-copy.ts` exports it again: the sites route catches it from there.
 */

/** The template cannot be copied as it is (a file it names is missing, a pointer in it cannot be followed). */
export class TemplateCopyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateCopyError';
  }
}
