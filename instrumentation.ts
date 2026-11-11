export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const { patchHtmlResponseStamp, startYcodePublishedAtRefresh } = await import('./lib/stamp-html-response');
  patchHtmlResponseStamp();
  await startYcodePublishedAtRefresh();

  // TORCH platform (part 1, session 2): register the webstudio permission scope
  // with auth-service over the core event bus. Best effort; logs when it cannot.
  const { startScopeRegistration } = await import('./lib/platform/scope-registration');
  await startScopeRegistration();

  // TORCH platform (part 3, session W3): ask Contact Center again for the form submissions that wait for it.
  const { startFormLinkRetry } = await import('./lib/platform/form-link-retry');
  startFormLinkRetry();
}
