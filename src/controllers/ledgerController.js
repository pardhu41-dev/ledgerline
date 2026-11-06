const db = require('../config/db');

exports.transfer = async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required for transfers' });
  }

  const { sourceAccountNumber, destinationAccountNumber, amount } = req.body;
  const parsedAmount = parseInt(amount, 10);

  if (!sourceAccountNumber || !destinationAccountNumber || isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Valid source, destination, and positive integer amount (in paise) are required' });
  }

  if (sourceAccountNumber === destinationAccountNumber) {
    return res.status(400).json({ error: 'Cannot transfer to the same account' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // 1. Idempotency Check
    const existingKey = await client.query(
      'SELECT * FROM idempotency_keys WHERE key = $1 FOR UPDATE',
      [idempotencyKey]
    );

    if (existingKey.rows.length > 0) {
      const record = existingKey.rows[0];
      await client.query('COMMIT');
      return res.status(record.response_code).json({
        ...record.response_body,
        _cached_idempotent_replay: true
      });
    }

    // Register idempotency key as PENDING
    await client.query(
      'INSERT INTO idempotency_keys (key, user_id, status) VALUES ($1, $2, $3)',
      [idempotencyKey, req.user.id, 'PENDING']
    );

    // 2. Fetch Accounts
    const accResult = await client.query(
      'SELECT * FROM accounts WHERE account_number IN ($1, $2)',
      [sourceAccountNumber, destinationAccountNumber]
    );

    const sourceAcc = accResult.rows.find(a => a.account_number === sourceAccountNumber);
    const destAcc = accResult.rows.find(a => a.account_number === destinationAccountNumber);

    if (!sourceAcc || !destAcc) {
      const response = { error: 'One or both accounts not found' };
      await client.query(
        'UPDATE idempotency_keys SET status = $1, response_code = $2, response_body = $3 WHERE key = $4',
        ['FAILED', 404, JSON.stringify(response), idempotencyKey]
      );
      await client.query('COMMIT');
      return res.status(404).json(response);
    }

    // 3. Authorization Check: Account Holder can only debit their own accounts
    if (req.user.role === 'ACCOUNT_HOLDER' && sourceAcc.user_id !== req.user.id) {
      const response = { error: 'Unauthorized: You do not own the source account' };
      await client.query(
        'UPDATE idempotency_keys SET status = $1, response_code = $2, response_body = $3 WHERE key = $4',
        ['FAILED', 403, JSON.stringify(response), idempotencyKey]
      );
      await client.query('COMMIT');
      return res.status(403).json(response);
    }

    // 4. Deadlock-Free Row-Level Locking (Order by UUID ascending)
    const [firstId, secondId] = [sourceAcc.id, destAcc.id].sort();
    await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [firstId]);
    await client.query('SELECT id FROM accounts WHERE id = $2 FOR UPDATE', [secondId]);

    // Re-read source balance under lock
    const lockedSource = await client.query('SELECT balance FROM accounts WHERE id = $1', [sourceAcc.id]);
    const currentSourceBalance = parseInt(lockedSource.rows[0].balance, 10);

    // 5. Balance Verification
    if (currentSourceBalance < parsedAmount) {
      // Record refused attempt in append-only ledger
      await client.query(`
        INSERT INTO ledger_entries (
          idempotency_key, source_account_id, destination_account_id, amount,
          type, status, reason, source_balance_after, destination_balance_after, initiated_by
        ) VALUES ($1, $2, $3, $4, 'TRANSFER', 'REFUSED', 'Insufficient funds', $5, NULL, $6)
      `, [idempotencyKey, sourceAcc.id, destAcc.id, parsedAmount, currentSourceBalance, req.user.id]);

      const response = { error: 'Insufficient funds for transfer' };
      await client.query(
        'UPDATE idempotency_keys SET status = $1, response_code = $2, response_body = $3 WHERE key = $4',
        ['FAILED', 400, JSON.stringify(response), idempotencyKey]
      );
      await client.query('COMMIT');
      return res.status(400).json(response);
    }

    // 6. Execute Transfer
    const newSourceBalance = currentSourceBalance - parsedAmount;
    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [newSourceBalance, sourceAcc.id]);

    const lockedDest = await client.query('SELECT balance FROM accounts WHERE id = $1', [destAcc.id]);
    const currentDestBalance = parseInt(lockedDest.rows[0].balance, 10);
    const newDestBalance = currentDestBalance + parsedAmount;
    await client.query('UPDATE accounts SET balance = $1 WHERE id = $2', [newDestBalance, destAcc.id]);

    // 7. Write to Append-Only Ledger
    const ledgerEntry = await client.query(`
      INSERT INTO ledger_entries (
        idempotency_key, source_account_id, destination_account_id, amount,
        type, status, reason, source_balance_after, destination_balance_after, initiated_by
      ) VALUES ($1, $2, $3, $4, 'TRANSFER', 'SUCCESS', 'Transfer completed', $5, $6, $7)
      RETURNING *
    `, [idempotencyKey, sourceAcc.id, destAcc.id, parsedAmount, newSourceBalance, newDestBalance, req.user.id]);

    const response = {
      message: 'Transfer successful',
      transferId: ledgerEntry.rows[0].id,
      sourceAccountNumber,
      destinationAccountNumber,
      amountTransferred: parsedAmount,
      newSourceBalance
    };

    // 8. Update Idempotency Table
    await client.query(
      'UPDATE idempotency_keys SET status = $1, response_code = $2, response_body = $3 WHERE key = $4',
      ['PROCESSED', 200, JSON.stringify(response), idempotencyKey]
    );

    await client.query('COMMIT');
    return res.status(200).json(response);
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Transaction failed', details: err.message });
  } finally {
    client.release();
  }
};

// Statement Generation (Debits, credits, refused attempts, running balances)
exports.getStatement = async (req, res) => {
  const { accountNumber } = req.params;

  try {
    const accResult = await db.query('SELECT * FROM accounts WHERE account_number = $1', [accountNumber]);
    if (accResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accResult.rows[0];

    // Authorization: Account Holder can only view their own account
    if (req.user.role === 'ACCOUNT_HOLDER' && account.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Access denied to this account statement' });
    }

    const statementQuery = `
      SELECT 
        l.id,
        l.idempotency_key,
        l.type,
        l.status,
        l.amount,
        l.reason,
        l.source_balance_after,
        l.destination_balance_after,
        l.created_at,
        u.name as initiated_by_name,
        sa.account_number as source_account,
        da.account_number as destination_account
      FROM ledger_entries l
      JOIN users u ON l.initiated_by = u.id
      LEFT JOIN accounts sa ON l.source_account_id = sa.id
      LEFT JOIN accounts da ON l.destination_account_id = da.id
      WHERE l.source_account_id = $1 OR l.destination_account_id = $1
      ORDER BY l.created_at DESC;
    `;

    const entries = await db.query(statementQuery, [account.id]);

    res.json({
      accountNumber: account.account_number,
      currentBalance: parseInt(account.balance, 10),
      entries: entries.rows
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve statement', details: err.message });
  }
};

// All accounts list (Admin & Auditor only)
exports.getAllAccounts = async (req, res) => {
  try {
    const query = `
      SELECT a.id, a.account_number, a.balance, a.created_at, u.name as owner_name, u.email as owner_email
      FROM accounts a
      JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at ASC;
    `;
    const result = await db.query(query);
    res.json({ accounts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
};
