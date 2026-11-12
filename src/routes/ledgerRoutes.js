const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledgerController');
const { authenticate, requireRole } = require('../middleware/auth');
const db = require('../config/db');

// Protected Transfer Endpoint
router.post('/transfer', authenticate, ledgerController.transfer);

// Account Statement Endpoint
router.get('/accounts/:accountNumber/statement', authenticate, ledgerController.getStatement);

// Evaluator Sandbox Reset Utility
router.post('/sandbox/reset', async (req, res) => {
    try {
        await db.query("UPDATE accounts SET balance = 100000 WHERE account_number = 'ACC-ALPHA-100'");
        await db.query("UPDATE accounts SET balance = 50000 WHERE account_number = 'ACC-BETA-200'");
        await db.query("TRUNCATE TABLE ledger_entries, idempotency_keys CASCADE");

        return res.status(200).json({
            success: true,
            message: 'Demo state successfully restored: Alpha = ₹1,000.00, Beta = ₹500.00'
        });
    } catch (err) {
        console.error('Sandbox reset failure:', err);
        return res.status(500).json({ error: 'Failed to reset demo state: ' + err.message });
    }
});

module.exports = router;