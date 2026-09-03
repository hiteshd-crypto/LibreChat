const path = require('path');
const mongoose = require('mongoose');

/**
 * Connects mongoose to a real MongoDB for integration tests and returns an
 * async teardown function (call it in `afterAll`).
 *
 * Resolution order:
 *   1. `MONGO_URI_TEST` — a throwaway database (e.g. `<cluster>/LibreChat_test`).
 *      Read from the environment, or from the repo-root `.env` if not already set.
 *      The database name MUST contain `test`, and the whole database is dropped
 *      on teardown — this is a guard against ever pointing it at real data.
 *   2. `mongodb-memory-server` — the CI default; needs a launchable local `mongod`.
 *
 * @returns {Promise<() => Promise<void>>} teardown
 */
async function connectTestDb() {
  let uri = process.env.MONGO_URI_TEST;
  if (!uri) {
    try {
      require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
      uri = process.env.MONGO_URI_TEST;
    } catch {
      /* no dotenv / no .env — fall through to the memory server */
    }
  }

  if (uri) {
    const dbName = uri.split('/').pop().split('?')[0];
    if (!/test/i.test(dbName)) {
      throw new Error(
        `[connectTestDb] refusing to use MONGO_URI_TEST: database name "${dbName}" does not contain "test". ` +
          'Point it at a throwaway database (e.g. LibreChat_test) — its contents are dropped after the run.',
      );
    }
    await mongoose.connect(uri);
    return async () => {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    };
  }

  const { MongoMemoryServer } = require('mongodb-memory-server');
  const server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri());
  return async () => {
    await mongoose.disconnect();
    await server.stop();
  };
}

module.exports = { connectTestDb };
