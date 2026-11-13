const path = require('path');
const { logger } = require('@librechat/data-schemas');

require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const connect = require('./connect');

require('~/db/models'); // registers mongoose models (createModels)
const db = require('~/models');

/**
 * One-time migration that moves every Department Head's personal
 * `Balance.tokenCredits` (granted directly under the old per-head model,
 * before the department pool existed) into their Department's pool.
 * Idempotent — a second run is a true no-op. Also runs automatically at
 * server boot (right after `migrateDepartments`); this script exists for a
 * reviewable `--dry-run` against a shared DB.
 *
 *   Preview: npm run migrate:department-balances:dry-run
 *   Apply:   npm run migrate:department-balances
 */
async function run({ dryRun = true } = {}) {
  await connect();
  logger.info(`[migrate-department-balances] starting (dryRun=${dryRun})`);
  const result = await db.migrateHeadBalancesToPool({ dryRun });

  console.log(`\nmode: ${dryRun ? 'DRY RUN (no writes)' : 'APPLIED'}`);
  for (const line of result.planned ?? []) {
    console.log('  •', line);
  }
  console.log(`\nsummary: migrated=${result.migrated} totalMoved=${result.totalMoved}`);
  if (dryRun) {
    console.log('\nTo apply, re-run without --dry-run.');
  }
  return result;
}

if (require.main === module) {
  run({ dryRun: process.argv.includes('--dry-run') })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('[migrate-department-balances] failed:', error);
      process.exit(1);
    });
}

module.exports = { run };
