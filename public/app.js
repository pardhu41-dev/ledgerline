let currentUser = null;
let currentToken = localStorage.getItem('token');
let currentAccount = null;

// DOM references
const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const authHeaderState = document.getElementById('authHeaderState');
const loginForm = document.getElementById('loginForm');
const transferForm = document.getElementById('transferForm');
const toastEl = document.getElementById('toast');

function showToast(msg, isError = false) {
    toastEl.innerHTML = `
    <i class="fa-solid ${isError ? 'fa-triangle-exclamation text-rose-300' : 'fa-circle-check text-emerald-950'} text-sm"></i>
    <span>${msg}</span>
  `;
    toastEl.className = `fixed bottom-6 right-6 px-4 py-3 rounded-2xl shadow-2xl text-xs font-semibold z-50 flex items-center space-x-2.5 transition-all ${isError ? 'bg-rose-500 text-white border border-rose-400/30' : 'bg-emerald-400 text-slate-950 border border-emerald-300/40'
        }`;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 4500);
}

function prefill(email, pass) {
    document.getElementById('loginEmail').value = email;
    document.getElementById('loginPassword').value = pass;
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        currentToken = data.token;
        currentUser = data.user;
        localStorage.setItem('token', currentToken);
        localStorage.setItem('user', JSON.stringify(currentUser));
        initApp();
    } catch (err) {
        showToast(err.message, true);
    }
});

function logout() {
    localStorage.clear();
    currentToken = null;
    currentUser = null;
    currentAccount = null;
    dashboardSection.classList.add('hidden');
    loginSection.classList.remove('hidden');
    authHeaderState.innerHTML = '';
}

async function initApp() {
    const storedUser = localStorage.getItem('user');
    if (storedUser) currentUser = JSON.parse(storedUser);

    loginSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');

    authHeaderState.innerHTML = `
    <div class="text-right">
      <p class="text-xs font-bold text-white leading-tight">${currentUser.name}</p>
      <span class="text-[10px] uppercase font-mono font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">${currentUser.role}</span>
    </div>
    <button onclick="logout()" class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 rounded-xl text-xs font-semibold border border-slate-800 transition">
      Sign Out
    </button>
  `;

    document.getElementById('cardRole').textContent = currentUser.role;

    // Set default view based on persona
    if (currentUser.role === 'ADMIN' || currentUser.role === 'AUDITOR') {
        currentAccount = 'ACC-ALPHA-100';
        document.getElementById('sourceAccInput').value = 'ACC-ALPHA-100';
        document.getElementById('destAccInput').value = 'ACC-BETA-200';
    } else if (currentUser.email === 'alpha@ledgerline.internal') {
        currentAccount = 'ACC-ALPHA-100';
        document.getElementById('sourceAccInput').value = 'ACC-ALPHA-100';
        document.getElementById('destAccInput').value = 'ACC-BETA-200';
    } else {
        currentAccount = 'ACC-BETA-200';
        document.getElementById('sourceAccInput').value = 'ACC-BETA-200';
        document.getElementById('destAccInput').value = 'ACC-ALPHA-100';
    }

    document.getElementById('cardAccount').textContent = currentAccount;
    await refreshStatement();
}

async function refreshStatement() {
    if (!currentAccount) return;
    try {
        const res = await fetch(`/api/ledger/accounts/${currentAccount}/statement`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        document.getElementById('cardBalance').textContent = `₹${(data.currentBalance / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

        const tbody = document.getElementById('statementTableBody');
        tbody.innerHTML = '';

        if (data.entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="py-8 text-center text-slate-500 font-sans">No journal entries recorded for this ledger account.</td></tr>`;
            return;
        }

        data.entries.forEach(entry => {
            const isRefused = entry.status === 'REFUSED';
            const statusBadge = isRefused
                ? `<span class="px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[10px] font-bold">REFUSED</span>`
                : `<span class="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold">SETTLED</span>`;

            const time = new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const tr = document.createElement('tr');
            tr.className = 'hover:bg-slate-900/40 transition-colors';
            tr.innerHTML = `
        <td class="py-3 px-3.5 text-slate-400 text-[11px]">${time}</td>
        <td class="py-3 px-3.5 font-bold text-white">${entry.type}</td>
        <td class="py-3 px-3.5">${statusBadge}</td>
        <td class="py-3 px-3.5 text-slate-300 text-[11px]">${entry.source_account || 'EXT'} &rarr; ${entry.destination_account || 'EXT'}</td>
        <td class="py-3 px-3.5 font-bold ${isRefused ? 'text-slate-500 line-through' : 'text-slate-100'}">₹${(entry.amount / 100).toFixed(2)}</td>
        <td class="py-3 px-3.5 text-emerald-400 font-semibold">${entry.source_balance_after !== null ? `₹${(entry.source_balance_after / 100).toFixed(2)}` : '-'}</td>
      `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        showToast(err.message, true);
    }
}

transferForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const sourceAccountNumber = document.getElementById('sourceAccInput').value.trim();
    const destinationAccountNumber = document.getElementById('destAccInput').value.trim();
    const amountRupees = parseFloat(document.getElementById('transferAmount').value);
    const amountPaise = Math.round(amountRupees * 100);

    const idempotencyKey = `web-tx-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    try {
        const res = await fetch('/api/ledger/transfer', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${currentToken}`,
                'Idempotency-Key': idempotencyKey
            },
            body: JSON.stringify({ sourceAccountNumber, destinationAccountNumber, amount: amountPaise })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast(`Transfer settled: ₹${amountRupees.toFixed(2)}`);
        document.getElementById('transferAmount').value = '';
        await refreshStatement();
    } catch (err) {
        showToast(err.message, true);
        await refreshStatement();
    }
});

async function simulateRaceCondition() {
    showToast('Dispatching simultaneous race-condition transfer requests...');
    const key1 = `race-ui-1-${Date.now()}`;
    const key2 = `race-ui-2-${Date.now()}`;

    const send = (key) => fetch('/api/ledger/transfer', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${currentToken}`,
            'Idempotency-Key': key
        },
        body: JSON.stringify({
            sourceAccountNumber: 'ACC-ALPHA-100',
            destinationAccountNumber: 'ACC-BETA-200',
            amount: 80000 // ₹800
        })
    });

    const [res1, res2] = await Promise.all([send(key1), send(key2)]);
    showToast(`Simulated: Request 1 (${res1.status}), Request 2 (${res2.status})`);
    await refreshStatement();
}

if (currentToken) {
    initApp();
}