import { getRemainingCredits, consumeCredit } from './dist/payment-verifier.js';

const testSession = 'beta-validator-' + Math.random().toString(36).substring(7);
console.log(`Starting verification for session: ${testSession}`);

const initialBalance = getRemainingCredits(testSession);
console.log(`Initial Balance: ${initialBalance}`);

if (initialBalance === 1000000) {
    console.log('✅ SUCCESS: 1,000,000 frame grant verified.');
} else {
    console.log(`❌ FAILURE: Expected 1,000,000, got ${initialBalance}`);
    process.exit(1);
}

consumeCredit(testSession);
const afterConsume = getRemainingCredits(testSession);
console.log(`Balance after 1 consumption: ${afterConsume}`);

if (afterConsume === 999999) {
    console.log('✅ SUCCESS: Consumption logic verified.');
} else {
    console.log(`❌ FAILURE: Expected 999,999, got ${afterConsume}`);
    process.exit(1);
}
