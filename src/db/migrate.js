const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Running database migrations...');
        const schemaSql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
        await client.query(schemaSql);
        console.log('Schema tables created successfully.');

        // Seed default users for testing & evaluation
        console.log('Seeding initial users and accounts...');
        const passwordHash = await bcrypt.hash('Password@123', 10);

        // Seed Admin
        const adminRes = await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('System Admin', 'admin@ledgerline.internal', $1, 'ADMIN')
      ON CONFLICT (email) DO UPDATE SET password_hash = $1
      RETURNING id;
    `, [passwordHash]);

        // Seed Auditor
        await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('Chief Auditor', 'auditor@ledgerline.internal', $1, 'AUDITOR')
      ON CONFLICT (email) DO UPDATE SET password_hash = $1;
    `, [passwordHash]);

        // Seed Account Holder A
        const userARes = await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('User Alpha', 'alpha@ledgerline.internal', $1, 'ACCOUNT_HOLDER')
      ON CONFLICT (email) DO UPDATE SET password_hash = $1
      RETURNING id;
    `, [passwordHash]);

        // Seed Account Holder B
        const userBRes = await client.query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ('User Beta', 'beta@ledgerline.internal', $1, 'ACCOUNT_HOLDER')
      ON CONFLICT (email) DO UPDATE SET password_hash = $1
      RETURNING id;
    `, [passwordHash]);

        // Seed Accounts with initial balances (in paise: 100000 = ₹1000.00)
        if (userARes.rows[0]) {
            await client.query(`
        INSERT INTO accounts (user_id, account_number, balance)
        VALUES ($1, 'ACC-ALPHA-100', 100000)
        ON CONFLICT (account_number) DO NOTHING;
      `, [userARes.rows[0].id]);
        }

        if (userBRes.rows[0]) {
            await client.query(`
        INSERT INTO accounts (user_id, account_number, balance)
        VALUES ($1, 'ACC-BETA-200', 50000)
        ON CONFLICT (account_number) DO NOTHING;
      `, [userBRes.rows[0].id]);
        }

        console.log('Seeding completed successfully!');
    } catch (err) {
        console.error('Migration error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();