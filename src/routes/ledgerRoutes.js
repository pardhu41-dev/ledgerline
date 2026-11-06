const express = require('express');
const router = express.Router();
const ledgerController = require('../controllers/ledgerController');
const { authenticate, requireRole } = require('../middleware/auth');

router.post('/transfer', authenticate, ledgerController.transfer);
router.get('/accounts/:accountNumber/statement', authenticate, ledgerController.getStatement);
router.get('/accounts', authenticate, requireRole('ADMIN', 'AUDITOR'), ledgerController.getAllAccounts);

module.exports = router;
