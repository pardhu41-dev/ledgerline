const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../src/server');
const db = require('../src/config/db');

describe('LedgerLine Integrity, Concurrency & Idempotency Attacks', () => {
    let alphaUser;
    let betaUser;
    let alphaAcc = 'ACC-ALPHA-100';
    let betaAcc = 'ACC-BETA-200';
    let alphaToken;
    let betaToken;

    beforeAll(async () => {
        const usersRes = await db.query('SELECT id, email, role FROM users');
        alphaUser = usersRes.rows.find(u => u.email === 'alpha@ledgerline.internal');
        betaUser = usersRes.rows.find(u => u.email === 'beta@ledgerline.internal');

        const secret = process.env.JWT_SECRET || 'super_secret_ledgerline_jwt_key_2026';

        alphaToken = jwt.sign(
            { id: alphaUser.id, email: alphaUser.email, role: alphaUser.role },
            secret,
            { expiresIn: '1h' }
        );

        betaToken = jwt.sign(
            { id: betaUser.id, email: betaUser.email, role: betaUser.role },
            secret,
            { expiresIn: '1h' }
        );
    });

    beforeEach(async () => {
        // Reset balances
        await db.query("UPDATE accounts SET balance = 100000 WHERE account_number = $1", [alphaAcc]);
        await db.query("UPDATE accounts SET balance = 50000 WHERE account_number = $1", [betaAcc]);

        // Truncate tables with CASCADE to satisfy foreign keys
        await db.query("TRUNCATE TABLE ledger_entries, idempotency_keys CASCADE");
    });

    afterAll(async () => {
        if (typeof db.end === 'function') {
            await db.end();
        } else if (db.pool && typeof db.pool.end === 'function') {
            await db.pool.end();
        }
    });

    // --- ATTACK 1: Idempotency Replay ---
    test('Attack 1: Idempotency Protection — Replaying the same key must never double-spend', async () => {
        const key = `test-idem-${Date.now()}`;

        const res1 = await request(app)
            .post('/api/ledger/transfer')
            .set('Authorization', `Bearer ${alphaToken}`)
            .set('Idempotency-Key', key)
            .send({
                sourceAccountNumber: alphaAcc,
                destinationAccountNumber: betaAcc,
                amount: 20000
            });

        expect(res1.status).toBe(200);
        expect(res1.body.amountTransferred).toBe(20000);

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

        const check = await db.query("SELECT balance FROM accounts WHERE account_number = $1", [alphaAcc]);
        expect(parseInt(check.rows[0].balance, 10)).toBe(80000);
    });

    // --- ATTACK 2: Concurrent Race Condition ---
    test('Attack 2: Concurrent Race Condition — Two simultaneous withdrawals cannot exceed available balance', async () => {
        await db.query("UPDATE accounts SET balance = 80000 WHERE account_number = $1", [alphaAcc]);

        const keyA = `race-attack-A-${Date.now()}`;
        const keyB = `race-attack-B-${Date.now()}`;

        const sendTransfer = (key) =>
            request(app)
                .post('/api/ledger/transfer')
                .set('Authorization', `Bearer ${alphaToken}`)
                .set('Idempotency-Key', key)
                .send({
                    sourceAccountNumber: alphaAcc,
                    destinationAccountNumber: betaAcc,
                    amount: 50000
                });

        const [req1, req2] = await Promise.all([
            sendTransfer(keyA),
            sendTransfer(keyB)
        ]);

        const statuses = [req1.status, req2.status].sort();
        expect(statuses).toEqual([200, 400]);

        const checkAlpha = await db.query("SELECT balance FROM accounts WHERE account_number = $1", [alphaAcc]);
        expect(parseInt(checkAlpha.rows[0].balance, 10)).toBe(30000);
    });

    // --- ATTACK 3: Authorization Boundary ---
    test('Attack 3: Authorization Boundary — User Beta cannot transfer funds out of User Alpha account', async () => {
        const res = await request(app)
            .post('/api/ledger/transfer')
            .set('Authorization', `Bearer ${betaToken}`)
            .set('Idempotency-Key', `auth-attack-${Date.now()}`)
            .send({
                sourceAccountNumber: alphaAcc,
                destinationAccountNumber: betaAcc,
                amount: 10000
            });

        expect(res.status).toBe(403);
    });

    // --- ATTACK 4: Read-Only Auditor Boundary ---
    test('Attack 4: Auditor Boundary — Read-only Auditor cannot initiate transfers', async () => {
        const auditorUser = (await db.query("SELECT id, email, role FROM users WHERE role = 'AUDITOR' LIMIT 1")).rows[0];
        if (!auditorUser) return;

        const secret = process.env.JWT_SECRET || 'super_secret_ledgerline_jwt_key_2026';
        const auditorToken = jwt.sign(
            { id: auditorUser.id, email: auditorUser.email, role: auditorUser.role },
            secret,
            { expiresIn: '1h' }
        );

        const res = await request(app)
            .post('/api/ledger/transfer')
            .set('Authorization', `Bearer ${auditorToken}`)
            .set('Idempotency-Key', `auditor-attack-${Date.now()}`)
            .send({
                sourceAccountNumber: alphaAcc,
                destinationAccountNumber: betaAcc,
                amount: 10000
            });

        expect(res.status).toBe(403);
    });
    // --- INVARIANT CHECK: Conservation of Money ---
    test('Invariant Check: Conservation of Money — Total sum across accounts matches invariant', async () => {
        const sumBefore = await db.query("SELECT SUM(balance) as total FROM accounts");
        const initialTotal = parseInt(sumBefore.rows[0].total, 10);

        await request(app)
            .post('/api/ledger/transfer')
            .set('Authorization', `Bearer ${alphaToken}`)
            .set('Idempotency-Key', `invar-tx-${Date.now()}`)
            .send({
                sourceAccountNumber: alphaAcc,
                destinationAccountNumber: betaAcc,
                amount: 15000
            });

        const sumAfter = await db.query("SELECT SUM(balance) as total FROM accounts");
        const postTotal = parseInt(sumAfter.rows[0].total, 10);

        expect(postTotal).toBe(initialTotal);
    });
});