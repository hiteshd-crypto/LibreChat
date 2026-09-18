require('dotenv').config();
const mongoose = require('mongoose');
const {
  createModels,
  tokenValues,
  cacheTokenValues,
  premiumTokenValues,
} = require('@librechat/data-schemas');

const models = createModels(mongoose);
const { PricingRate } = models;

function toDocs(table, category) {
  return Object.entries(table).map(([modelKey, rates]) => ({
    modelKey,
    category,
    ...rates,
  }));
}

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);

  const docs = [
    ...toDocs(tokenValues, 'standard'),
    ...toDocs(cacheTokenValues, 'cache'),
    ...toDocs(premiumTokenValues, 'premium'),
  ];

  for (const doc of docs) {
    await PricingRate.updateOne(
      { modelKey: doc.modelKey, category: doc.category },
      { $set: doc },
      { upsert: true },
    );
  }

  console.log(`Seeded ${docs.length} pricing rates + 1 setting.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
