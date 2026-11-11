import type { Knex } from 'knex';

/**
 * Part 3, session W3: what became of a form submission (PRD V1.0 "Forms",
 * "Prospects").
 *
 * platform_form_links: one row per submission, written with direct knex like
 * platform_visits (lib/platform/form-links.ts). Not a tenant table (no
 * `tenant_id`); it goes when its submission or its site goes.
 *
 *   stored    Web Studio only: the form's switch is off, or the submission is spam
 *   waiting   the switch is on and Contact Center has not answered yet; the
 *             retry run asks again (attempts, last_attempt_at)
 *   prospect  Contact Center answered with a prospect: contact_center_id is its id
 *   contact   the phone is a contact's: contact_center_id is the contact's id
 *
 * Nothing of the visitor is stored here: the name and the phone stay in the
 * submission, and the retry reads them from it.
 *
 * The submissions that exist when this runs were never sent anywhere: each
 * gets a 'stored' row, so every submission has one.
 */
const STATES = ['stored', 'waiting', 'prospect', 'contact'];

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('platform_form_links', (table) => {
    table.uuid('submission_id').primary().references('id').inTable('form_submissions').onDelete('CASCADE');
    table.uuid('site_id').notNullable().references('id').inTable('platform_sites').onDelete('CASCADE');
    table.string('state', 16).notNullable();
    table.uuid('contact_center_id').nullable();
    table.integer('attempts').notNullable().defaultTo(0);
    table.timestamp('last_attempt_at', { useTz: true }).nullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    // The app's lists read a site's rows by state.
    table.index(['site_id', 'state'], 'platform_form_links_site_state_index');
  });
  await knex.raw(`ALTER TABLE platform_form_links ADD CONSTRAINT platform_form_links_state_check CHECK (state IN (${STATES.map((state) => `'${state}'`).join(', ')}))`);
  await knex.raw(
    "ALTER TABLE platform_form_links ADD CONSTRAINT platform_form_links_record_check CHECK ((state IN ('prospect', 'contact')) = (contact_center_id IS NOT NULL))",
  );
  await knex.raw('ALTER TABLE platform_form_links ADD CONSTRAINT platform_form_links_attempts_check CHECK (attempts >= 0)');
  // The retry run reads the waiting rows only, oldest attempt first.
  await knex.raw("CREATE INDEX platform_form_links_waiting_index ON platform_form_links (last_attempt_at) WHERE state = 'waiting'");

  await knex.raw(`
    INSERT INTO platform_form_links (submission_id, site_id, state, created_at)
    SELECT submission.id, submission.tenant_id, 'stored', submission.created_at
    FROM form_submissions submission
    JOIN platform_sites site ON site.id = submission.tenant_id
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('platform_form_links');
}
