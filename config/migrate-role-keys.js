const path = require('path');
const { logger } = require('@librechat/data-schemas');

require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const connect = require('./connect');

const db = require('~/models');

/**
 * Backfills `roleKey` on every role and rewrites name-based references
 * (`role.parentRole`, `user.role`, ROLE-principal ids) to keys. Idempotent —
 * safe to re-run. Also runs automatically inside `initializeRoles` at server
 * boot; this script exists for a reviewable `--dry-run` against a shared DB.
 *
 *   Preview: npm run migrate:role-keys:dry-run
 *   Apply:   npm run migrate:role-keys
 */
async function run({ dryRun = true } = {}) {
  await connect();
  logger.info(`[migrate-role-keys] starting (dryRun=${dryRun})`);
  const result = await db.migrateRoleKeys({ dryRun });

  console.log(`\nmode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLIED'}`);
  for (const line of result.planned ?? []) {
    console.log('  •', line);
  }
  console.log(
    `\nsummary: keyed=${result.keyed} parentLinks=${result.parentLinks} ` +
      `users=${result.users} principals=${result.principals}`,
  );
  if (dryRun) {
    console.log('\nTo apply, re-run without --dry-run.');
  }
  return result;
}

if (require.main === module) {
  run({ dryRun: process.argv.includes('--dry-run') })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[migrate-role-keys] failed:', error);
      process.exit(1);
    });
}

module.exports = { run };
