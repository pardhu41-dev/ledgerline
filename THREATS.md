# THREATS.md — LedgerLine Threat Modeling & Concurrency Defense

This document details the threat model for LedgerLine, the attack vectors evaluated, the defense mechanisms implemented in the engine, and the residual engineering trade-offs accepted.

---

## 1. Concurrency & Race Condition Attacks

### 1.1 Double-Spend via Parallel Debits
* **Attack Vector:** An attacker with ₹1,000 in Account A fires two simultaneous withdrawal requests of ₹800 at the exact same millisecond. If the server reads the balance without an exclusive lock, both threads observe `balance >= 800`, pass validation, and deduct ₹800, leaving the account at -₹600.
* **Mitigation:**
  - **Pessimistic Row Locking (`SELECT ... FOR UPDATE`):** Before evaluating balances, the database acquires an exclusive row lock on the source account within an explicit transaction (`BEGIN ... COMMIT`). The second concurrent query blocks at the database level until the first commits.
  - **Storage Constraint:** The table defines `CONSTRAINT chk_positive_balance CHECK (balance >= 0)`. Even if application-level logic were compromised, the storage engine rejects any debit attempting to drive balance below zero.
* **Verification:** Validated by automated test `Attack 2: Concurrent Race Condition` in `tests/ledger.test.js`.

### 1.2 Cross-Transfer Deadlock Attack
* **Attack Vector:** Account A transfers to Account B while Account B simultaneously transfers to Account A. If Thread 1 locks A and waits for B, while Thread 2 locks B and waits for A, PostgreSQL detects a cyclic deadlock and terminates one transaction with an unhandled failure.
* **Mitigation:**
  - **Deterministic Lock Acquisition:** The service sorts the account UUIDs alphabetically (`[sourceAcc.id, destAcc.id].sort()`) and acquires locks strictly in that deterministic order. Neither transaction can hold one lock while waiting on the other out of sequence.

---

## 2. Network Failure & Replay Attacks

### 2.1 Dropped Response Retries (Idempotency)
* **Attack Vector:** A user transfers ₹500. The server processes the transaction, but a network drop occurs before the client receives the HTTP 200 response. The client retries the request with the same idempotency key, causing a second ₹500 debit.
* **Mitigation:**
  - **Two-Phase Idempotency Lock:** Every mutating request requires an `Idempotency-Key` header.
  - The transaction inserts the key with status `'PENDING'` under an exclusive lock (`FOR UPDATE`).
  - If a duplicate key arrives while the first is in-flight, it blocks until completion; if already `'PROCESSED'`, it returns the stored cached status code and payload immediately with `_cached_idempotent_replay: true` without moving money again.
* **Verification:** Validated by automated test `Attack 1: Idempotency Protection` in `tests/ledger.test.js`.

---

## 3. Privilege Escalation & Authorization Boundary

### 3.1 Unauthorized Account Draining
* **Attack Vector:** An authenticated Account Holder identifies another user's account number and submits a transfer specifying that account as the debit source.
* **Mitigation:**
  - **Server-Side Identity Verification:** The authorization middleware verifies the JWT signature and extracts the authenticated `user_id`.
  - The transfer engine enforces that for the `ACCOUNT_HOLDER` role, `sourceAcc.user_id === req.user.id`. Requests attempting to debit foreign accounts are rejected with HTTP 403 Forbidden before acquiring balance locks.
* **Verification:** Validated by automated test `Attack 3: Authorization Boundary` in `tests/ledger.test.js`.

---

## 4. Ledger Tampering & Audit Trail Integrity

### 4.1 Modifying or Deleting Audit Rows
* **Attack Vector:** An insider or compromised process alters a transaction row in `ledger_entries` to conceal a transfer or adjust balance history.
* **Mitigation:**
  - **Append-Only Architecture:** The application exposes only `INSERT` queries against `ledger_entries`. No `UPDATE` or `DELETE` API endpoints or application methods exist.
  - **Complete Attempt Logging:** Both successful movements (`SUCCESS`) and rejected attempts (`REFUSED`, such as overdrafts) write an immutable row recording source, destination, initiating user ID, timestamp, and resulting balance.

---

## 5. Invariant: Conservation of Money

* **Invariant Definition:** Internal money movement must net to zero ($\sum \Delta \text{Balances} = 0$). Money is neither created nor destroyed during transfers. Total aggregate system balance changes exclusively through verified external deposits and withdrawals.
* **Implementation:** Every transfer debits source account by $X$ and credits destination account by exactly $X$ within the identical atomic commit.
* **Verification:** Validated by automated test `Invariant Check: Conservation of Money` in `tests/ledger.test.js`.

---

## 6. Accepted Risks & Deliberate Constraints

1. **Pessimistic Locking Throughput:** Using `SELECT ... FOR UPDATE` serializes concurrent transactions targeting the exact same account. In high-frequency trading this reduces write throughput, but for core banking ledgers, **zero data corruption and strict non-negative balances take priority over raw speed**.
2. **Clock Source:** Timestamps rely on PostgreSQL server time (`TIMESTAMPTZ`) to eliminate vulnerability to client clock drift or manipulation.