import { HONEYPOT_FIELD_NAME } from '@/lib/form-spam-settings';

/**
 * Hidden decoy input rendered inside every published form.
 *
 * Positioned off-screen rather than `display: none` because bots skip fields
 * they consider hidden. Untabbable and hidden from assistive tech, so humans
 * never reach it — a filled value means the submission is spam.
 *
 * TORCH platform seam (docs/PLATFORM.md, OPEN_QUESTIONS 52): the offset is
 * `inset-inline-start`, not `left`. An Arabic page is `<html dir="rtl">`, where
 * the scrollable overflow runs to the left, so `left: -9999px` made every
 * published form's page 9,999 px too wide. Off the side the page starts on, the
 * decoy sits outside the scrollable area in either direction.
 */
export function FormHoneypotField() {
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        insetInlineStart: '-9999px',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
      }}
    >
      {/* Implicit label association — an id would collide on pages with two forms */}
      <label>
        Leave this field empty
        <input
          type="text"
          name={HONEYPOT_FIELD_NAME}
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </label>
    </div>
  );
}
