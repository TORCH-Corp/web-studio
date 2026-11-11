import { NextRequest, NextResponse, after } from 'next/server';
import {
  getAllFormSubmissions,
  getFormSummaries,
  createFormSubmission,
  deleteFormSubmissionsByFormId,
  bulkDeleteFormSubmissions,
} from '@/lib/repositories/formSubmissionRepository';
import { noCache } from '@/lib/api-response';
import { screenFormSubmission, stripHoneypotField } from '@/lib/form-spam-protection';
import { getClientIp } from '@/lib/request-utils';
import { linkSubmission } from '@/lib/platform/form-links';
import { planSubmission } from '@/lib/platform/form-submit';
import { notifyNewSubmission, platformNotificationPorts } from '@/lib/platform/submission-notification';
import { countEventOnHost } from '@/lib/platform/visit-events';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/form-submissions
 * Get all form submissions or form summaries
 *
 * Query params:
 * - form_id: Filter by form ID
 * - status: Filter by status
 * - summary: If 'true', returns form summaries instead of submissions
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('form_id') || undefined;
    const status = searchParams.get('status') as 'new' | 'read' | 'archived' | 'spam' | undefined;
    const summary = searchParams.get('summary') === 'true';

    if (summary) {
      const summaries = await getFormSummaries();
      return noCache({ data: summaries });
    }

    const submissions = await getAllFormSubmissions(formId, status);
    return noCache({ data: submissions });
  } catch (error) {
    console.error('Error fetching form submissions:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch form submissions' },
      500
    );
  }
}

/**
 * POST /ycode/api/form-submissions
 * Create a new form submission (public endpoint for form submissions)
 *
 * Body:
 * - form_id: string (required)
 * - payload: object (required)
 * - metadata: object (optional - IP, user agent, etc.)
 * - layer_id, locale: the form layer's id and the page's language (TORCH, session W3)
 *
 * 400 { code: 'invalid_fields', fields: { name?, phone? } } when the form creates a prospect
 * and the name or the phone breaks its rule (lib/platform/form-submit.ts)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    if (!body.form_id) {
      return NextResponse.json(
        { error: 'Missing required field: form_id' },
        { status: 400 }
      );
    }

    if (!body.payload || typeof body.payload !== 'object') {
      return NextResponse.json(
        { error: 'Missing or invalid field: payload' },
        { status: 400 }
      );
    }

    const verdict = await screenFormSubmission(request.headers, body.payload);

    if (verdict.outcome === 'reject') {
      return NextResponse.json({ error: verdict.error }, { status: verdict.status });
    }

    const payload = stripHoneypotField(body.payload);

    // Client-supplied metadata is untrusted, so request-derived values win
    const metadata = {
      ...(typeof body.metadata === 'object' && body.metadata ? body.metadata : {}),
      ip: getClientIp(request.headers) || undefined,
      user_agent: request.headers.get('user-agent') || undefined,
      referrer: request.headers.get('referer') || undefined,
    };

    const isSpam = verdict.outcome === 'spam';

    // TORCH (part 3, session W3): whether this form creates a prospect is read from the published form, never
    // from the body; with the switch on, a name or a phone that breaks its rule is refused before anything is stored.
    const plan = await planSubmission(body, payload, isSpam);
    if (!plan.ok) {
      return NextResponse.json({ error: 'Some fields need correcting', code: 'invalid_fields', fields: plan.fields }, { status: 400 });
    }

    const submission = await createFormSubmission({
      form_id: body.form_id,
      payload,
      metadata,
      status: isSpam ? 'spam' : 'new',
    });

    // The submission is stored, so the visitor's answer is a success whatever becomes of its link: Contact Center
    // is given a short time (lib/platform/form-links.ts), and a link that could not be written is logged.
    if (plan.site) {
      try {
        await linkSubmission(plan.site, { id: submission.id, spam: isSpam }, plan.prospect);
      } catch (error) {
        console.error(`[POST /ycode/api/form-submissions] submission ${submission.id}: its Contact Center link was not written`, error);
      }
    }

    // One 'form' event for the visitor behind this request, for a submission that is not spam (part 3, session W8).
    // Never fails the submission: it is already stored.
    if (!isSpam) await countEventOnHost(request, 'form', 'POST /ycode/api/form-submissions');

    // The holders of read on the forms permission are told in Business OS (part 3, session W5), for a submission
    // that is not spam. It runs after the answer is sent, so the visitor never waits for it, and it never throws:
    // what could not be done is logged (lib/platform/submission-notification.ts).
    const notifiedSite = plan.site;
    if (!isSpam && notifiedSite) after(() => notifyNewSubmission(submission, notifiedSite, platformNotificationPorts()));

    // Nothing else happens when a submission arrives: ycode's email, its webhooks and the app integrations
    // (Airtable, MailerLite) are out of Web Studio (part 3, PRD V1.0 Out-of-Scope; session W2). Spam is
    // stored for review, and the answer is the same so that bots stay silent and do not retry.
    return NextResponse.json(
      { data: submission, message: 'Form submitted successfully' },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating form submission:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to submit form' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /ycode/api/form-submissions
 * Delete submissions - either by form_id (all submissions) or by ids (bulk delete)
 *
 * Query params:
 * - form_id: string - Delete all submissions for this form
 *
 * OR Body:
 * - ids: string[] - Array of submission IDs to delete
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const formId = searchParams.get('form_id');

    // If form_id is provided, delete all submissions for that form
    if (formId) {
      await deleteFormSubmissionsByFormId(formId);
      return noCache({ message: 'All submissions for form deleted successfully' });
    }

    // Otherwise, try to parse body for bulk delete
    const body = await request.json().catch(() => ({}));
    const ids = body.ids;

    if (Array.isArray(ids) && ids.length > 0) {
      await bulkDeleteFormSubmissions(ids);
      return noCache({ message: `${ids.length} submissions deleted successfully` });
    }

    return noCache({ error: 'Missing required param: form_id or ids in body' }, 400);
  } catch (error) {
    console.error('Error deleting form submissions:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete form submissions' },
      500
    );
  }
}
