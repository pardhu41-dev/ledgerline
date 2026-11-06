# LedgerLine — Money Movement with a Verifiable Ledger

LedgerLine is a multi-role financial ledger engine built to guarantee strict atomicity, idempotency, and concurrency safety.

## Live Deployment
- **Frontend URL:** [Pending]
- **API URL:** [Pending]

## Seed Credentials
| Role | Email | Password |
|---|---|---|
| Admin | admin@ledgerline.internal | Admin@123 |
| Account Holder A | user1@ledgerline.internal | User@123 |
| Account Holder B | user2@ledgerline.internal | User@123 |
| Auditor (Read-Only) | auditor@ledgerline.internal | Auditor@123 |

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