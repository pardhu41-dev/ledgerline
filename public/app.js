let currentUser = null;
let currentToken = localStorage.getItem('token');
let currentAccount = null;

// Raw balance in major currency units (Rupees)
let rawCurrentBalance = 0;
let isCurrency = true;
let isCompact = false;

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
const balanceLoadingDots = document.getElementById('balanceLoadingDots');
const badgeStatus = document.getElementById('badgeStatus');
const badgeLabel = document.getElementById('badgeLabel');
const switchCurrencyEl = document.getElementById('switchCurrency');
const switchCompactEl = document.getElementById('switchCompact');

// Number Animation (matching AnimateNumber visualDuration & spring bounce)
let currentDisplayedValue = 0;
let numberAnimationId = null;

function animateNumber(targetValue, durationMs = 600) {
    const startValue = currentDisplayedValue;
    const startTime = performance.now();

    if (numberAnimationId) cancelAnimationFrame(numberAnimationId);

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / durationMs, 1);

        // Spring ease curve approximation
        const ease = 1 - Math.pow(1 - progress, 3);
        const interpolated = startValue + (targetValue - startValue) * ease;
        currentDisplayedValue = interpolated;

        renderFormattedBalance(interpolated);

        if (progress < 1) {
            numberAnimationId = requestAnimationFrame(step);
        } else {
            currentDisplayedValue = targetValue;
            renderFormattedBalance(targetValue);
        }
    }

    numberAnimationId = requestAnimationFrame(step);
}

function renderFormattedBalance(val) {
    let display = '';

    if (isCompact) {
        if (val >= 1000000) {
            display = (val / 1000000).toFixed(1) + 'M';
        } else if (val >= 1000) {
            display = (val / 1000).toFixed(1) + 'K';
        } else {
            display = Math.trunc(val).toString();
        }
    } else {
        display = val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    cardBalanceEl.textContent = isCurrency ? `₹${display}` : display;
}

// Switch Event Handlers
switchCurrencyEl.addEventListener('click', () => {
    isCurrency = !isCurrency;
    switchCurrencyEl.setAttribute('data-is-on', isCurrency);
    renderFormattedBalance(currentDisplayedValue);
});

switchCompactEl.addEventListener('click', () => {
    isCompact = !isCompact;
    switchCompactEl.setAttribute('data-is-on', isCompact);
    renderFormattedBalance(currentDisplayedValue);
});

// Viewport Scroll Handling
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

function setBadgeState(text, isError = false) {
    badgeLabel.textContent = text;
    badgeStatus.className = `motion-badge transition ${isError ? 'border-red-900/60 text-red-400' : 'border-zinc-800 text-zinc-300'}`;
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
        setBadgeState('AUTHENTICATING...');
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
        setBadgeState('VERIFIED');
        initApp();
    } catch (err) {
        setBadgeState('AUTH FAILED', true);
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
    setBadgeState('LOGGED OUT');
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
        balanceLoadingDots.classList.remove('hidden');
        const res = await fetch(`/api/ledger/accounts/${currentAccount}/statement`, {
            headers: { 'Authorization': `Bearer ${currentToken}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        rawCurrentBalance = data.currentBalance / 100;
        animateNumber(rawCurrentBalance, 650);

        journalFeedContainer.innerHTML = '';

        if (data.entries.length === 0) {
            journalFeedContainer.innerHTML = `
        <div class="p-8 text-center text-xs text-muted-foreground font-mono">
          No audit entries recorded for this account.
        </div>
      `;
            return;
        }

        const sorted = [...data.entries].reverse();

        sorted.forEach((entry) => {
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
    } finally {
        balanceLoadingDots.classList.add('hidden');
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
        setBadgeState('LOCKING...');
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

        setBadgeState('COMMITTED');
        showToast(`Transfer settled: ₹${amountRupees.toFixed(2)}`);
        document.getElementById('transferAmount').value = '';
        await refreshStatement();
    } catch (err) {
        setBadgeState('REFUSED', true);
        showToast(err.message, true);
        await refreshStatement();
    }
});

async function simulateRaceCondition() {
    setBadgeState('ATTACK SIMULATION');
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
    setBadgeState('ENGINE READY');
}

if (currentToken) {
    initApp();
}