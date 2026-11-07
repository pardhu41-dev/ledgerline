# THREATS.md — LedgerLine Threat Modeling & Invariant Verification

This document analyzes the attack vectors against LedgerLine, how our architecture mitigates them, and the residual risks accepted in the system design.

---

## 1. Concurrency Attacks: Double-Spend & Negative Balances
* **Attack Scenario:** An account holder with ₹1,000 fires two simultaneous withdrawal requests of ₹800 at the exact same millisecond. If both threads check the balance concurrently (`balance >= 800`), both see sufficient funds and execute debits, resulting in an illegal negative balance of -₹600.
* **Mitigation:**
  - **Row-Level Locking:** We acquire exclusive locks using `SELECT id FROM accounts WHERE id = $1::UUID FOR UPDATE` within a single ACID transaction.
  - **Deadlock Prevention:** Accounts involved in transfers are locked deterministically by sorting their UUIDs alphabetically.
  - **Database Constraint:** A strict check constraint (`CONSTRAINT chk_positive_balance CHECK (balance >= 0)`) serves as an unbypassable storage-level backstop.
* **Test Verification:** Covered in `tests/ledger.test.js` (Attack 2: Concurrent Race Condition).

---

## 2. Network Timeouts & Replay Attacks
* **Attack Scenario:** A client initiates a ₹500 transfer. The request processes on the server, but the network drops before the client receives the 200 OK. The client automatically retries the request, causing a duplicate debit.
* **Mitigation:**
  - **Idempotency Keys:** Every mutating request requires a unique `Idempotency-Key` header.
  - **Pre-execution Check:** The key is checked and locked in `idempotency_keys`. If already processed, the original response payload and status code are returned immediately without touching account balances.
* **Test Verification:** Covered in `tests/ledger.test.js` (Attack 1: Idempotency Protection).

---

## 3. Privilege Escalation & Cross-Account Draining
* **Attack Scenario:** User B discovers User A's account number and sends a transfer request specifying User A's account as the source.
* **Mitigation:**
  - **Role & Ownership Verification:** Server-side middleware verifies the authenticated JWT identity against the `user_id` of the source account before transaction execution.
  - **Account Holder Restrictions:** Account Holders cannot initiate debits on accounts they do not own.
* **Test Verification:** Covered in `tests/ledger.test.js` (Attack 3: Authorization Boundary).

---

## 4. Ledger Tampering & Audit Integrity
* **Attack Scenario:** An insider or compromised process alters a transaction row in the database to disguise theft or retroactively adjust balances.
* **Mitigation:**
  - **Append-Only Model:** `ledger_entries` has no `UPDATE` or `DELETE` endpoints exposed.
  - **Complete Attempt Logging:** Both successful transactions and refused attempts (e.g., overdraft attempts) are permanently recorded with timestamps and initiating user IDs.

---

## 5. Accepted Risks & Trade-offs
1. **Clock Skew:** We rely on PostgreSQL server time (`TIMESTAMPTZ`) rather than client-reported timestamps to prevent client time spoofing.
2. **Lock Contention:** Using pessimistic row locking (`FOR UPDATE`) introduces slight latency under high transfer volumes for the same individual account. This is an intentional engineering trade-off: **correctness and zero-loss take precedence over raw write throughput.**