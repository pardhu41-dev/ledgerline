-- 1. Roles
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('ADMIN', 'ACCOUNT_HOLDER', 'AUDITOR');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role user_role NOT NULL DEFAULT 'ACCOUNT_HOLDER',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 3. Accounts with balance constraint (Invariant: cannot go negative)
CREATE TABLE IF NOT EXISTS accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    account_number VARCHAR(32) UNIQUE NOT NULL,
    balance BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_positive_balance CHECK (balance >= 0)
);

-- 4. Idempotency Table (Guarantees exactly-once execution)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL,
    response_code INT,
    response_body JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 5. Append-Only Ledger (Tamper-proof audit trail)
DO $$ BEGIN
    CREATE TYPE entry_type AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    idempotency_key VARCHAR(255) REFERENCES idempotency_keys(key),
    source_account_id UUID REFERENCES accounts(id),
    destination_account_id UUID REFERENCES accounts(id),
    amount BIGINT NOT NULL,
    type entry_type NOT NULL,
    status VARCHAR(20) NOT NULL, -- 'SUCCESS', 'REFUSED'
    reason VARCHAR(255),
    source_balance_after BIGINT,
    destination_balance_after BIGINT,
    initiated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);