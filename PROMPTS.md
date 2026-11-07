
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