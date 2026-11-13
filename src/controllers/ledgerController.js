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

    // 1. Check idempotency record under lock
    const existingKey = await client.query(
      'SELECT * FROM idempotency_keys WHERE key = $1::TEXT FOR UPDATE',
      [idempotencyKey]
    );

    if (existingKey.rows.length > 0) {
      const record = existingKey.rows[0];
      await client.query('COMMIT');
      return res.status(record.response_code || 200).json({
        ...(typeof record.response_body === 'string' ? JSON.parse(record.response_body) : record.response_body),
        _cached_idempotent_replay: true
      });
    }

    // Insert pending idempotency key
    await client.query(
      'INSERT INTO idempotency_keys (key, user_id, status) VALUES ($1::TEXT, $2::UUID, $3::TEXT)',
      [idempotencyKey, req.user.id, 'PENDING']
    );

    // 2. Fetch Accounts
    const accResult = await client.query(
      'SELECT id, user_id, account_number, balance FROM accounts WHERE account_number IN ($1::TEXT, $2::TEXT)',
      [sourceAccountNumber, destinationAccountNumber]
    );

    const sourceAcc = accResult.rows.find(a => a.account_number === sourceAccountNumber);
    const destAcc = accResult.rows.find(a => a.account_number === destinationAccountNumber);

    if (!sourceAcc || !destAcc) {
      const response = { error: 'One or both accounts not found' };
      await client.query(
        'UPDATE idempotency_keys SET status = $1::TEXT, response_code = $2::INT, response_body = $3::JSONB WHERE key = $4::TEXT',
        ['FAILED', 404, JSON.stringify(response), idempotencyKey]
      );
      await client.query('COMMIT');
      return res.status(404).json(response);
    }

    // 3. Ownership & Role Authorization check
    if (req.user.role === 'AUDITOR') {
      const response = { error: 'Forbidden: Auditor role is strictly read-only' };
      await client.query(
        'UPDATE idempotency_keys SET status = $1::TEXT, response_code = $2::INT, response_body = $3::JSONB WHERE key = $4::TEXT',
        ['FAILED', 403, JSON.stringify(response), idempotencyKey]
      );
      await client.query('COMMIT');
      return res.status(403).json(response);
    }

    if (req.user.role !== 'ADMIN' && sourceAcc.user_id !== req.user.id) {
      const response = { error: 'Unauthorized: You do not own the source account' };
      await client.query(
        'UPDATE idempotency_keys SET status = $1::TEXT, response_code = $2::INT, response_body = $3::JSONB WHERE key = $4::TEXT',
        ['FAILED', 403, JSON.stringify(response), idempotencyKey]
      );
      await client.query('COMMIT');
      return res.status(403).json(response);
    }

    // 4. Deadlock-free row-level locking (Sort by UUID ascending)
    const sortedIds = [sourceAcc.id, destAcc.id].sort();
    await client.query('SELECT id FROM accounts WHERE id = $1::UUID FOR UPDATE', [sortedIds[0]]);
    await client.query('SELECT id FROM accounts WHERE id = $1::UUID FOR UPDATE', [sortedIds[1]]);

    // Re-fetch current source balance under row lock
    const lockedSourceRes = await client.query('SELECT balance FROM accounts WHERE id = $1::UUID', [sourceAcc.id]);
    const currentSourceBalance = parseInt(lockedSourceRes.rows[0].balance, 10);

    // 5. Invariant check: No overdraft
    if (currentSourceBalance < parsedAmount) {
      // Record refused attempt in audit ledger
      await client.query(`
        INSERT INTO ledger_entries (
          idempotency_key, source_account_id, destination_account_id, amount,
          type, status, reason, source_balance_after, destination_balance_after, initiated_by
        ) VALUES (
          $1::TEXT, $2::UUID, $3::UUID, $4::BIGINT, 
          'TRANSFER', 'REFUSED', 'Insufficient funds', $5::BIGINT, NULL::BIGINT, $6::UUID
        )
      `, [idempotencyKey, sourceAcc.id, destAcc.id, parsedAmount, currentSourceBalance, req.user.id]);

      const response = { error: 'Insufficient funds for transfer' };
      await client.query(
        'UPDATE idempotency_keys SET status = $1::TEXT, response_code = $2::INT, response_body = $3::JSONB WHERE key = $4::TEXT',
        ['FAILED', 400, JSON.stringify(response), idempotencyKey]
      );
      await client.query('COMMIT');
      return res.status(400).json(response);
    }

    // 6. Update balances atomically
    const newSourceBalance = currentSourceBalance - parsedAmount;
    await client.query('UPDATE accounts SET balance = $1::BIGINT WHERE id = $2::UUID', [newSourceBalance, sourceAcc.id]);

    const lockedDestRes = await client.query('SELECT balance FROM accounts WHERE id = $1::UUID', [destAcc.id]);
    const currentDestBalance = parseInt(lockedDestRes.rows[0].balance, 10);
    const newDestBalance = currentDestBalance + parsedAmount;
    await client.query('UPDATE accounts SET balance = $1::BIGINT WHERE id = $2::UUID', [newDestBalance, destAcc.id]);

    // 7. Insert successful ledger entry
    const ledgerEntry = await client.query(`
      INSERT INTO ledger_entries (
        idempotency_key, source_account_id, destination_account_id, amount,
        type, status, reason, source_balance_after, destination_balance_after, initiated_by
      ) VALUES (
        $1::TEXT, $2::UUID, $3::UUID, $4::BIGINT, 
        'TRANSFER', 'SUCCESS', 'Transfer completed', $5::BIGINT, $6::BIGINT, $7::UUID
      )
      RETURNING id
    `, [idempotencyKey, sourceAcc.id, destAcc.id, parsedAmount, newSourceBalance, newDestBalance, req.user.id]);

    const response = {
      message: 'Transfer successful',
      transferId: ledgerEntry.rows[0].id,
      sourceAccountNumber,
      destinationAccountNumber,
      amountTransferred: parsedAmount,
      newSourceBalance
    };

    // 8. Cache response in idempotency records
    await client.query(
      'UPDATE idempotency_keys SET status = $1::TEXT, response_code = $2::INT, response_body = $3::JSONB WHERE key = $4::TEXT',
      ['PROCESSED', 200, JSON.stringify(response), idempotencyKey]
    );

    await client.query('COMMIT');
    return res.status(200).json(response);

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Transfer execution error:', err.message);
    return res.status(500).json({ error: 'Transaction failed', details: err.message });
  } finally {
    client.release();
  }
};

// Deposit (External money entering the system)
exports.deposit = async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  const { accountNumber, amount } = req.body;
  const parsedAmount = parseInt(amount, 10);

  if (!accountNumber || isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Valid account number and positive integer amount (in paise) required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Idempotency check
    const existingKey = await client.query('SELECT * FROM idempotency_keys WHERE key = $1::TEXT FOR UPDATE', [idempotencyKey]);
    if (existingKey.rows.length > 0) {
      const record = existingKey.rows[0];
      await client.query('COMMIT');
      return res.status(record.response_code || 200).json({
        ...(typeof record.response_body === 'string' ? JSON.parse(record.response_body) : record.response_body),
        _cached_idempotent_replay: true
      });
    }

    await client.query('INSERT INTO idempotency_keys (key, user_id, status) VALUES ($1::TEXT, $2::UUID, $3::TEXT)', [idempotencyKey, req.user.id, 'PENDING']);

    const accRes = await client.query('SELECT id, user_id, balance FROM accounts WHERE account_number = $1::TEXT FOR UPDATE', [accountNumber]);
    if (accRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accRes.rows[0];
    const newBalance = parseInt(account.balance, 10) + parsedAmount;

    await client.query('UPDATE accounts SET balance = $1::BIGINT WHERE id = $2::UUID', [newBalance, account.id]);

    const entry = await client.query(`
      INSERT INTO ledger_entries (
        idempotency_key, destination_account_id, amount,
        type, status, reason, destination_balance_after, initiated_by
      ) VALUES ($1::TEXT, $2::UUID, $3::BIGINT, 'DEPOSIT', 'SUCCESS', 'External deposit', $4::BIGINT, $5::UUID)
      RETURNING id
    `, [idempotencyKey, account.id, parsedAmount, newBalance, req.user.id]);

    const response = {
      message: 'Deposit successful',
      depositId: entry.rows[0].id,
      accountNumber,
      amountDeposited: parsedAmount,
      newBalance
    };

    await client.query('UPDATE idempotency_keys SET status = $1::TEXT, response_code = $2::INT, response_body = $3::JSONB WHERE key = $4::TEXT', ['PROCESSED', 200, JSON.stringify(response), idempotencyKey]);
    await client.query('COMMIT');
    return res.status(200).json(response);
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Deposit failed', details: err.message });
  } finally {
    client.release();
  }
};

// Withdrawal (External money leaving the system)
exports.withdraw = async (req, res) => {
  const idempotencyKey = req.headers['idempotency-key'];
  if (!idempotencyKey) {
    return res.status(400).json({ error: 'Idempotency-Key header is required' });
  }

  const { accountNumber, amount } = req.body;
  const parsedAmount = parseInt(amount, 10);

  if (!accountNumber || isNaN(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ error: 'Valid account number and positive integer amount (in paise) required' });
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Idempotency check
    const existingKey = await client.query('SELECT * FROM idempotency_keys WHERE key = $1::TEXT FOR UPDATE', [idempotencyKey]);
    if (existingKey.rows.length > 0) {
      const record = existingKey.rows[0];
      await client.query('COMMIT');
      return res.status(record.response_code || 200).json({
        ...(typeof record.response_body === 'string' ? JSON.parse(record.response_body) : record.response_body),
        _cached_idempotent_replay: true
      });
    }

    await client.query('INSERT INTO idempotency_keys (key, user_id, status) VALUES ($1::TEXT, $2::UUID, $3::TEXT)', [idempotencyKey, req.user.id, 'PENDING']);

    const accRes = await client.query('SELECT id, user_id, balance FROM accounts WHERE account_number = $1::TEXT FOR UPDATE', [accountNumber]);
    if (accRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accRes.rows[0];

    // Authorization: Account Holder can only withdraw from their own account
    if (req.user.role === 'ACCOUNT_HOLDER' && account.user_id !== req.user.id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Unauthorized: You do not own this account' });
    }

    const currentBalance = parseInt(account.balance, 10);
    if (currentBalance < parsedAmount) {
      await client.query(`
        INSERT INTO ledger_entries (
          idempotency_key, source_account_id, amount,
          type, status, reason, source_balance_after, initiated_by
        ) VALUES ($1::TEXT, $2::UUID, $3::BIGINT, 'WITHDRAWAL', 'REFUSED', 'Insufficient funds', $4::BIGINT, $5::UUID)
      `, [idempotencyKey, account.id, parsedAmount, currentBalance, req.user.id]);

      const response = { error: 'Insufficient funds for withdrawal' };
      await client.query('UPDATE idempotency_keys SET status = $1::TEXT, response_code = $2::INT, response_body = $3::JSONB WHERE key = $4::TEXT', ['FAILED', 400, JSON.stringify(response), idempotencyKey]);
      await client.query('COMMIT');
      return res.status(400).json(response);
    }

    const newBalance = currentBalance - parsedAmount;
    await client.query('UPDATE accounts SET balance = $1::BIGINT WHERE id = $2::UUID', [newBalance, account.id]);

    const entry = await client.query(`
      INSERT INTO ledger_entries (
        idempotency_key, source_account_id, amount,
        type, status, reason, source_balance_after, initiated_by
      ) VALUES ($1::TEXT, $2::UUID, $3::BIGINT, 'WITHDRAWAL', 'SUCCESS', 'Withdrawal completed', $4::BIGINT, $5::UUID)
      RETURNING id
    `, [idempotencyKey, account.id, parsedAmount, newBalance, req.user.id]);

    const response = {
      message: 'Withdrawal successful',
      withdrawalId: entry.rows[0].id,
      accountNumber,
      amountWithdrawn: parsedAmount,
      newBalance
    };

    await client.query('UPDATE idempotency_keys SET status = $1::TEXT, response_code = $2::INT, response_body = $3::JSONB WHERE key = $4::TEXT', ['PROCESSED', 200, JSON.stringify(response), idempotencyKey]);
    await client.query('COMMIT');
    return res.status(200).json(response);
  } catch (err) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'Withdrawal failed', details: err.message });
  } finally {
    client.release();
  }
};

exports.getStatement = async (req, res) => {
  const { accountNumber } = req.params;

  try {
    const accResult = await db.query('SELECT * FROM accounts WHERE account_number = $1::TEXT', [accountNumber]);
    if (accResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accResult.rows[0];

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
      WHERE l.source_account_id = $1::UUID OR l.destination_account_id = $1::UUID
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