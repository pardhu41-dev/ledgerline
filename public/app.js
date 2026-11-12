let currentUser = null;
let currentToken = localStorage.getItem('token');
let currentAccount = null;

let rawCurrentBalance = 0;
let isCurrency = true;
let isCompact = false;

// DOM References
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

// Alert Banner elements
const alertBannerContainer = document.getElementById('alertBannerContainer');
const alertTitle = document.getElementById('alertTitle');
const alertDescription = document.getElementById('alertDescription');
const alertIcon = document.getElementById('alertIcon');

// SplitText Character Animation
function splitTextAnimation(elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;
    const text = el.textContent;
    el.innerHTML = '';

    [...text].forEach((char, i) => {
        const span = document.createElement('span');
        span.textContent = char;
        span.className = 'split-char';
        span.style.opacity = '0';
        span.style.transform = i % 2 === 0 ? 'translateY(8px)' : 'translateY(-8px)';
        el.appendChild(span);

        setTimeout(() => {
            span.style.opacity = '1';
            span.style.transform = 'translateY(0)';
        }, 40 * i);
    });
}

// AnimateNumber Count Transition
let currentDisplayedValue = 0;
let numberAnimationId = null;

function animateNumber(targetValue, durationMs = 600) {
    const startValue = currentDisplayedValue;
    const startTime = performance.now();

    if (numberAnimationId) cancelAnimationFrame(numberAnimationId);

    function step(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
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

// Switch Listeners
if (switchCurrencyEl) {
    switchCurrencyEl.addEventListener('click', () => {
        isCurrency = !isCurrency;
        switchCurrencyEl.setAttribute('data-is-on', isCurrency);
        renderFormattedBalance(currentDisplayedValue);
    });
}

if (switchCompactEl) {
    switchCompactEl.addEventListener('click', () => {
        isCompact = !isCompact;
        switchCompactEl.setAttribute('data-is-on', isCompact);
        renderFormattedBalance(currentDisplayedValue);
    });
}

// Viewport Scroll Detection
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

// Alerts & Badges
function showAlert(title, desc, isError = false) {
    alertTitle.textContent = title;
    alertDescription.textContent = desc;
    alertBannerContainer.classList.remove('hidden');

    if (isError) {
        alertBanner.className = 'relative w-full rounded-lg border border-red-900/50 bg-red-950/20 p-4 text-red-300 flex items-start gap-3';
        alertIcon.setAttribute('data-lucide', 'alert-circle');
    } else {
        alertBanner.className = 'relative w-full rounded-lg border border-emerald-900/50 bg-emerald-950/20 p-4 text-emerald-300 flex items-start gap-3';
        alertIcon.setAttribute('data-lucide', 'check-circle-2');
    }
    lucide.createIcons();
}

function dismissAlert() {
    alertBannerContainer.classList.add('hidden');
}

function setBadgeState(text, isError = false) {
    badgeLabel.textContent = text;
    badgeStatus.className = `inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-[11px] font-mono border transition ${isError ? 'bg-red-950/40 text-red-400 border-red-900/50' : 'bg-muted text-zinc-300 border-border'
        }`;
}

function showToast(msg, isError = false) {
    toastEl.innerHTML = `
        <div class="flex items-center space-x-2">
          <i data-lucide="${isError ? 'alert-circle' : 'check-circle-2'}" class="w-4 h-4 ${isError ? 'text-red-400' : 'text-emerald-400'}"></i>
          <span>${msg}</span>
        </div>
    `;
    toastEl.className = `fixed bottom-5 right-5 px-4 py-2.5 rounded-lg shadow-2xl text-xs font-medium z-50 flex items-center transition-all animate-spring-pop ${isError ? 'bg-zinc-950 text-red-300 border-red-900/50' : 'bg-zinc-950 text-emerald-300 border-emerald-900/50'
        }`;
    toastEl.classList.remove('hidden');
    lucide.createIcons();
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
    dismissAlert();
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
    splitTextAnimation('brandTitle');
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
        animateNumber(rawCurrentBalance, 600);

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
                ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-red-950/50 text-red-400 border border-red-900/60">REFUSED</span>`
                : `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/50 text-emerald-400 border border-emerald-900/60">SETTLED</span>`;

            const time = new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

            const card = document.createElement('div');
            card.className = `rounded-lg bg-zinc-950/80 border p-3.5 text-xs transition-all hover:border-zinc-700 animate-spring-pop ${isRefused ? 'border-red-950/40' : 'border-border'
                }`;
            card.innerHTML = `
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center space-x-2">
                    <span class="font-mono text-zinc-500 text-[11px]">${time}</span>
                    <span class="font-semibold text-white tracking-wide">${entry.type}</span>
                    ${statusBadge}
                  </div>
                  <div class="text-right font-mono font-bold ${isRefused ? 'text-zinc-500 line-through' : 'text-white'}">
                    ₹${(entry.amount / 100).toFixed(2)}
                  </div>
                </div>
                <div class="flex items-center justify-between text-[11px] text-muted-foreground font-mono pt-2 border-t border-zinc-900">
                  <span>Route: <span class="text-zinc-300">${entry.source_account || 'EXT'}</span> &rarr; <span class="text-zinc-300">${entry.destination_account || 'EXT'}</span></span>
                  <span>Post Balance: <span class="text-emerald-400 font-semibold">${entry.source_balance_after !== null ? `₹${(entry.source_balance_after / 100).toFixed(2)}` : '-'}</span></span>
                </div>
                ${entry.reason ? `<div class="mt-1.5 text-[10px] font-mono ${isRefused ? 'text-red-400' : 'text-zinc-400'}">Reason: ${entry.reason}</div>` : ''}
            `;
            journalFeedContainer.appendChild(card);
        });

        scrollToLatest();
    } catch (err) {
        showToast(err.message, true);
    } finally {
        balanceLoadingDots.classList.add('hidden');
        lucide.createIcons();
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
        setBadgeState('LOCKING ROWS...');
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
        showAlert('Payment Succeeded', `Transferred ₹${amountRupees.toFixed(2)} to ${destinationAccountNumber}. Receipt logged to append-only ledger.`);
        showToast(`Transfer settled: ₹${amountRupees.toFixed(2)}`);
        document.getElementById('transferAmount').value = '';
        await refreshStatement();
    } catch (err) {
        setBadgeState('REFUSED', true);
        showAlert('Transaction Refused', err.message, true);
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
    showAlert('Concurrency Attack Executed', `Simultaneous requests completed: Req 1 status ${res1.status}, Req 2 status ${res2.status}. No balance overdraft permitted.`);
    showToast(`Simulated: Req 1 (${res1.status}), Req 2 (${res2.status})`);
    await refreshStatement();
    setBadgeState('ENGINE READY');
}

// Sandbox Demo Reset Handler
async function resetSandbox() {
    try {
        setBadgeState('RESETTING...');
        const res = await fetch('/api/ledger/sandbox/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to reset sandbox');

        showAlert('Demo Sandbox Restored', 'Account balances reset to Alpha=₹1,000, Beta=₹500. Audit feed refreshed.');
        showToast('Sandbox reset: Alpha=₹1,000, Beta=₹500');
        setBadgeState('ENGINE READY');
        await refreshStatement();
    } catch (err) {
        setBadgeState('ERROR', true);
        showAlert('Reset Failed', err.message, true);
        showToast(err.message, true);
    }
}

if (currentToken) {
    initApp();
}