const express = require('express');
const cors = require('cors');
require('dotenv').config();

const authRoutes = require('./routes/authRoutes');
const ledgerRoutes = require('./routes/ledgerRoutes');

const app = express();
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/ledger', ledgerRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'LedgerLine API', timestamp: new Date() });
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`LedgerLine backend running on port ${PORT}`);
  });
}

module.exports = app;
