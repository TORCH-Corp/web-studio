/**
 * Create or refresh TORCH's three templates (part 1, session 4).
 *
 *   WS_TEMPLATES_ORG=<uuid> DATABASE_URL=... pnpm templates:seed
 *
 * For each of `PART_1_TEMPLATES`: a template that does not exist yet is
 * provisioned blank (homepage, the error pages, settings, Arabic and
 * English) in the templates organization with its fixed id; one that exists
 * gets its name and description refreshed and its content left alone (it is
 * built by hand in the builder, Task B). Run once per environment after the
 * migrations, and again whenever the names or descriptions change. The e2e
 * suite runs it before the specs.
 */

import { getKnexClient, closeKnexClient } from '@/lib/knex-client';
import { provisionSite, seedBlankSite } from '@/lib/platform/provision';
import { PART_1_TEMPLATES, templatesOrganizationId } from '@/lib/platform/templates';

async function main(): Promise<void> {
  const organizationId = templatesOrganizationId();
  const knex = await getKnexClient();
  try {
    for (const template of PART_1_TEMPLATES) {
      const existing = (await knex('platform_sites').where({ id: template.id }).first()) as { deleted_at: string | null; organization_id: string } | undefined;
      if (existing) {
        if (existing.organization_id !== organizationId) {
          throw new Error(`Template ${template.slug} (${template.id}) belongs to organization ${existing.organization_id}, not ${organizationId}`);
        }
        await knex('platform_sites')
          .where({ id: template.id })
          .update({ name: template.name, template: JSON.stringify(template.meta), is_template: true, deleted_at: null });
        console.log(`template ${template.slug}: refreshed${existing.deleted_at ? ' and restored' : ''}`);
        continue;
      }
      await provisionSite(
        {
          id: template.id,
          organizationId,
          createdBy: null,
          name: template.name,
          slug: template.slug,
          languages: ['ar', 'en'],
          default_language: 'en',
          hosts: [],
          isTemplate: true,
          templateMeta: template.meta,
        },
        seedBlankSite,
      );
      console.log(`template ${template.slug}: created`);
    }
  } finally {
    await closeKnexClient();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
