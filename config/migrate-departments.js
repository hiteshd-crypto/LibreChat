const path = require('path');
const { logger } = require('@librechat/data-schemas');

require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const connect = require('./connect');

require('~/db/models'); // registers mongoose models (createModels)
const db = require('~/models');

/**
 * Wraps every existing top-level custom-role branch (`Role` with
 * `parentRole === null`, excluding system roles) in a `Department` and grants
 * `DEPARTMENT_HEAD` to its root. Idempotent — safe to re-run. Also runs
 * automatically at server boot (right after `initializeRoles`); this script
 * exists for a reviewable `--dry-run` against a shared DB.
 *
 *   Preview: npm run migrate:departments:dry-run
 *   Apply:   npm run migrate:departments
 */
async function run({ dryRun = true } = {}) {
  await connect();
  logger.info(`[migrate-departments] starting (dryRun=${dryRun})`);
  const result = await db.migrateDepartments({ dryRun });

  console.log(`\nmode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLIED'}`);
  for (const line of result.planned ?? []) {
    console.log('  •', line);
  }
  console.log(`\nsummary: created=${result.created} granted=${result.granted}`);
  if (dryRun) {
    console.log('\nTo apply, re-run without --dry-run.');
  }
  return result;
}

if (require.main === module) {
  run({ dryRun: process.argv.includes('--dry-run') })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[migrate-departments] failed:', error);
      process.exit(1);
    });
}

module.exports = { run };
