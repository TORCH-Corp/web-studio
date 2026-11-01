/**
 * Shared configuration constants
 */

/**
 * Base URL of an external template service (ycode's hosted one, or another).
 * Unset on TORCH: the builder reaches no public host, so the template gallery
 * stays empty until templates are served by the platform (part 1, session 4).
 */
export const YCODE_EXTERNAL_API_URL = process.env.TEMPLATE_API_URL || null;
