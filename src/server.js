const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend dashboard
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/ledger', ledgerRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LedgerLine API', timestamp: new Date() });
});

// SPA Fallback for Express 5 (handles all non-API routes cleanly)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, '../public/index.html'));
  }
  next();
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`LedgerLine backend running on port ${PORT}`);
  });
}

module.exports = app;