
# PROMPTS.md — AI Engineering & Review Log

## Entry 1: 2026-11-06 — Transfer Concurrency, Deadlock & Idempotency Engine
- **Prompt:** "Write a Node.js Express service for moving funds between two accounts in PostgreSQL."
- **AI Output:** Generated a naive read-then-write service:
  ```javascript
  const source = await db.query("SELECT balance FROM accounts WHERE id = $1", [fromId]);
  if (source.balance >= amount) {
    await db.query("UPDATE accounts SET balance = balance - $1 WHERE id = $2", [amount, fromId]);
    await db.query("UPDATE accounts SET balance = balance + $1 WHERE id = $2", [amount, toId]);
  }

## Entry 2: 2026-11-06 — Parameterized Type Coercion & Ledger Logging Failures
- **Prompt:** "Add append-only audit logging into `ledger_entries` inside the transfer transaction for both successful and refused operations."
- **AI Output:** Provided standard raw SQL insertion:
  ```sql
  INSERT INTO ledger_entries (idempotency_key, source_account_id, amount, status, reason, destination_balance_after)
  VALUES ($1, $2, $3, 'REFUSED', 'Insufficient funds', NULL);

## Entry 3: 2026-11-06 — Floating-Point Precision Vulnerability in Balance Calculations
- **Prompt:** "Write a helper function to calculate new account balances after transfers and format them for the API response."
- **AI Output:** Produced JavaScript floating-point arithmetic:
  ```javascript
  const newSourceBalance = (currentBalance - transferAmount).toFixed(2);
  const newDestBalance = (destBalance + transferAmount).toFixed(2);

## Entry 4: 2026-11-07 — In-Flight Idempotency Window & Replay Race Condition
- **Task / Feature:** Idempotency key deduplication implementation.
- **Tool Used:** Antigravity AI / Claude Assistant
- **Initial Prompt:**
  > "How should we prevent duplicate charges if a user clicks Submit twice or the network times out?"
- **AI Output:**
  ```javascript
  // AI suggested inserting the idempotency record only upon successful completion:
  const result = await executeTransfer(from, to, amount);
  await db.query('INSERT INTO idempotency_keys (key, response) VALUES ($1, $2)', [key, JSON.stringify(result)]);
  return res.json(result);

## Entry 5: 2026-11-07 — Express 5 Route Pattern Crash (`path-to-regexp` v8)
- **Task / Feature:** Single Page Application (SPA) static file serving and client-side routing fallback.
- **Tool Used:** Antigravity AI / Claude Assistant
- **Initial Prompt:**
  > "Add a fallback route in src/server.js so that all unmatched GET requests return public/index.html."
- **AI Output:**
  ```javascript
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
  });