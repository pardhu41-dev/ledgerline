const request = require('supertest');
const crypto = require('crypto');
const app = require('../src/server');
const db = require('../src/config/db');

let alphaToken = '';
let betaToken = '';
let alphaAcc = 'ACC-ALPHA-100';
let betaAcc = 'ACC-BETA-200';

beforeAll(async () => {
    // 1. Authenticate Alpha
    const resAlpha = await request(app)
        .post('/api/auth/login')
        .send({ email: 'alpha@ledgerline.internal', password: 'Password@123' });
    alphaToken = resAlpha.body.token;

    // 2. Authenticate Beta
    const resBeta = await request(app)
        .post('/api/auth/login')
        .send({ email: 'beta@ledgerline.internal', password: 'Password@123' });
    betaToken = resBeta.body.token;

    // 3. Reset starting balances to known state (Alpha: ₹1000 = 100000 paise, Beta: ₹500 = 50000 paise)
    await db.query("UPDATE accounts SET balance = 100000 WHERE account_number = $1", [alphaAcc]);
    await db.query("UPDATE accounts SET balance = 50000 WHERE account_number = $1", [betaAcc]);
});

afterAll(async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
});

describe('LedgerLine Integrity, Concurrency & Idempotency Attacks', () => {

    test('Attack 1: Idempotency Protection — Replaying the same key must never double-spend', async () => {
        const key = `replay-test-${crypto.randomUUID()}`;

        // First request
        const res1 = await request(app)
            .post('/api/ledger/transfer')
            .set('Authorization', `Bearer ${alphaToken}`)
            .set('Idempotency-Key', key)
            .send({
                sourceAccountNumber: alphaAcc,
                destinationAccountNumber: betaAcc,
                amount: 20000 // ₹200
            });

        expect(res1.status).toBe(200);
        expect(res1.body.amountTransferred).toBe(20000);

        // Second request with EXACT same key (simulating network retry/timeout)
        const res2 = await request(app)
            .post('/api/ledger/transfer')
            .set('Authorization', `Bearer ${alphaToken}`)
            .set('Idempotency-Key', key)
            .send({
                sourceAccountNumber: alphaAcc,
                destinationAccountNumber: betaAcc,
                amount: 20000
            });

        expect(res2.status).toBe(200);
        expect(res2.body._cached_idempotent_replay).toBe(true);

        // Verify database only debited ONCE (100000 - 20000 = 80000)
        const checkAcc = await db.query("SELECT balance FROM accounts WHERE account_number = $1", [alphaAcc]);
        expect(parseInt(checkAcc.rows[0].balance, 10)).toBe(80000);
    });

    test('Attack 2: Concurrent Race Condition — Two simultaneous withdrawals cannot exceed available balance', async () => {
        // Current Alpha balance is ₹800 (80000 paise).
        // Fire TWO requests concurrently, each attempting to withdraw ₹500 (50000 paise).
        // Total attempted = ₹1000, which exceeds ₹800.
        // EXACTLY ONE must succeed, and EXACTLY ONE must be refused.
        const key1 = `race-test-${crypto.randomUUID()}`;
        const key2 = `race-test-${crypto.randomUUID()}`;

        const [req1, req2] = await Promise.all([
            request(app)
                .post('/api/ledger/transfer')
                .set('Authorization', `Bearer ${alphaToken}`)
                .set('Idempotency-Key', key1)
                .send({ sourceAccountNumber: alphaAcc, destinationAccountNumber: betaAcc, amount: 50000 }),
            request(app)
                .post('/api/ledger/transfer')
                .set('Authorization', `Bearer ${alphaToken}`)
                .set('Idempotency-Key', key2)
                .send({ sourceAccountNumber: alphaAcc, destinationAccountNumber: betaAcc, amount: 50000 })
        ]);

        const statuses = [req1.status, req2.status].sort();
        // One 200 (Success) and one 400 (Insufficient funds)
        expect(statuses).toEqual([200, 400]);

        // Alpha balance must remain strictly non-negative (80000 - 50000 = 30000 paise = ₹300)
        const checkAlpha = await db.query("SELECT balance FROM accounts WHERE account_number = $1", [alphaAcc]);
        expect(parseInt(checkAlpha.rows[0].balance, 10)).toBe(30000);
    });

    test('Attack 3: Authorization Boundary — User Beta cannot transfer funds out of User Alpha account', async () => {
        const key = `auth-test-${crypto.randomUUID()}`;

        const res = await request(app)
            .post('/api/ledger/transfer')
            .set('Authorization', `Bearer ${betaToken}`) // Beta token trying to move Alpha's money
            .set('Idempotency-Key', key)
            .send({
                sourceAccountNumber: alphaAcc,
                destinationAccountNumber: betaAcc,
                amount: 10000
            });

        expect(res.status).toBe(403);
        expect(res.body.error).toContain('Unauthorized');
    });

    test('Invariant Check: Conservation of Money — Total sum across accounts matches invariant', async () => {
        // Starting total was 100000 + 50000 = 150000 paise.
        // Internal transfers must net to ZERO change in aggregate balance.
        const totals = await db.query(`
      SELECT SUM(balance) as total_pool FROM accounts 
      WHERE account_number IN ($1, $2)
    `, [alphaAcc, betaAcc]);

        expect(parseInt(totals.rows[0].total_pool, 10)).toBe(150000);
    });

});