import assert from 'node:assert/strict';
import { openDatabase } from '../server/database.mjs';
import { createAccount, initializeAccounts } from '../server/accounts.mjs';

assert.ok(process.env.CURVE_OPERATOR_USERNAME && process.env.CURVE_OPERATOR_PASSWORD,
  'Set CURVE_OPERATOR_USERNAME and CURVE_OPERATOR_PASSWORD in the environment.');
const db = await openDatabase({databaseUrl:process.env.CURVE_DATABASE_URL,
  dataDir:process.env.CURVE_DATA_DIR||'data/curve-service'});
try {
  await initializeAccounts(db);
  const result = await createAccount(db, process.env.CURVE_OPERATOR_USERNAME, process.env.CURVE_OPERATOR_PASSWORD, 'operator');
  assert.equal(result.rows.length, 1, 'Username already exists. No existing account was changed.');
  console.log('Operator account created.');
} finally {
  await db.close();
}
