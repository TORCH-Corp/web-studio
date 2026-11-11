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

  // Visit totals (part 3, session W8): at 01:00 Baghdad time every day, finished days become daily totals and
  // detailed visit rows older than 90 days are removed. Logged; a failed run is tried again the next day.
  const { startVisitTotalsSchedule } = await import('./lib/platform/visit-totals-schedule');
  startVisitTotalsSchedule();
}
