let currentUser = null;
let currentToken = localStorage.getItem('token');
let currentAccount = null;

// DOM Elements
const loginSection = document.getElementById('loginSection');
const dashboardSection = document.getElementById('dashboardSection');
const authHeaderState = document.getElementById('authHeaderState');
const loginForm = document.getElementById('loginForm');
const transferForm = document.getElementById('transferForm');
const toastEl = document.getElementById('toast');
const journalViewport = document.getElementById('journalViewport');
const journalFeedContainer = document.getElementById('journalFeedContainer');
const btnScrollToLatest = document.getElementById('btnScrollToLatest');
const cardBalanceEl = document.getElementById('cardBalance');

// Character scramble effect matching animejs scrambleText() behavior
function scrambleAnimate(element, targetText, duration = 600) {
    const chars = '!<>-_\\/[]{}—=+*^?#________0123456789';
    const start = performance.now();
    const originalLength = targetText.length;

    function update(time) {
        const elapsed = time - start;
        const progress = Math.min(elapsed / duration, 1);
        const revealedLength = Math.floor(progress * originalLength);

        let output = '';
        for (let i = 0; i < originalLength; i++) {
            if (i < revealedLength) {
                output += targetText[i];
            } else {
                output += chars[Math.floor(Math.random() * chars.length)];
            }
        }

        element.textContent = output;

        if (progress < 1) {
            requestAnimationFrame(update);
        } else {
            element.textContent = targetText;
        }
    }

    requestAnimationFrame(update);
}

// Scroll detection for "Jump to latest" button
if (journalViewport) {
    journalViewport.addEventListener('scroll', () => {
        const isAtBottom = journalViewport.scrollHeight - journalViewport.scrollTop - journalViewport.clientHeight < 60;
        if (isAtBottom) {
            btnScrollToLatest.classList.add('hidden');
        } else {
            btnScrollToLatest.classList.remove('hidden');
        }
    });
}

function scrollToLatest() {
    if (journalViewport) {
        journalViewport.scrollTo({ top: journalViewport.scrollHeight, behavior: 'smooth' });
    }
}

function showToast(msg, isError = false) {
    toastEl.innerHTML = `
    <div class="flex items-center space-x-2">
      <i class="fa-solid ${isError ? 'fa-circle-xmark text-red-400' : 'fa-circle-check text-emerald-400'} text-xs"></i>
      <span>${msg}</span>
    </div>
  `;
    toastEl.className = `fixed bottom-5 right-5 px-4 py-2.5 rounded-lg shadow-2xl text-xs font-medium z-50 flex items-center transition-all animate-spring-pop ${isError
            ? 'bg-zinc-950 text-red-300 border-red-900/50'
            : 'bg-zinc-950 text-emerald-300 border-emerald-900/50'
        }`;
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 4000);
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
      <p class="text-xs font-medium text-white leading-tight">${currentUser.name}</p>
      <span class="text-[10px] font-mono text-muted-foreground uppercase">${currentUser.role}</span>
    </div>
    <button onclick="logout()" class="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-md text-xs font-mono border border-border transition">
      Sign Out
    </button>
  `;

    document.getElementById('cardRole').textContent = currentUser.role;

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

        // Apply smooth character scramble to balance update
        const formattedBalance = `₹${(data.currentBalance / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
        scrambleAnimate(cardBalanceEl, formattedBalance, 500);

        journalFeedContainer.innerHTML = '';

        if (data.entries.length === 0) {
            journalFeedContainer.innerHTML = `
        <div class="p-8 text-center text-xs text-muted-foreground font-mono">
          No audit entries recorded for this account.
        </div>
      `;
            return;
        }

        // Chronological order: oldest to newest (newest at bottom)
        const sorted = [...data.entries].reverse();

        sorted.forEach((entry, idx) => {
            const isRefused = entry.status === 'REFUSED';
            const statusBadge = isRefused
                ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-red-950/40 text-red-400 border border-red-900/50">REFUSED</span>`
                : `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/40 text-emerald-400 border border-emerald-900/50">SETTLED</span>`;

            const time = new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const card = document.createElement('div');
            card.className = 'rounded-lg bg-muted border border-border p-3 text-xs transition hover:border-zinc-700 animate-spring-pop';
            card.innerHTML = `
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center space-x-2">
            <span class="font-mono text-zinc-400 text-[11px]">${time}</span>
            <span class="font-semibold text-white">${entry.type}</span>
            ${statusBadge}
          </div>
          <div class="text-right font-mono font-bold ${isRefused ? 'text-zinc-500 line-through' : 'text-white'}">
            ₹${(entry.amount / 100).toFixed(2)}
          </div>
        </div>
        <div class="flex items-center justify-between text-[11px] text-muted-foreground font-mono pt-1.5 border-t border-zinc-800">
          <span>Route: <span class="text-zinc-300">${entry.source_account || 'EXT'}</span> &rarr; <span class="text-zinc-300">${entry.destination_account || 'EXT'}</span></span>
          <span>Post Balance: <span class="text-emerald-400 font-semibold">${entry.source_balance_after !== null ? `₹${(entry.source_balance_after / 100).toFixed(2)}` : '-'}</span></span>
        </div>
        ${entry.reason ? `<div class="mt-1 text-[10px] font-mono text-red-400">Reason: ${entry.reason}</div>` : ''}
      `;
            journalFeedContainer.appendChild(card);
        });

        scrollToLatest();

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
    showToast('Simulating parallel debits via Promise.all()...');
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
    showToast(`Simulated: Req 1 (${res1.status}), Req 2 (${res2.status})`);
    await refreshStatement();
}

if (currentToken) {
    initApp();
}