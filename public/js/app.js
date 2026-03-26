let currentJourneys = [];
let trendChart = null;
let rankingChart = null;

// Pull from config (set by config.js before this script runs)
const _cfg = (typeof window !== 'undefined' && window.CX_CONFIG) ? window.CX_CONFIG : {};
const PRIMARY   = _cfg.primary   || '#f64d50';
const SECONDARY = _cfg.secondary || '#006a62';
const TERTIARY  = _cfg.tertiary  || '#8e4a0c';
const ON_SURFACE = '#201a1a';
const ON_SURFACE_VARIANT = '#534343';
const SURFACE_CONTAINER  = '#eeeeee';
const THRESHOLDS = _cfg.thresholds || {
    openRate:       { good: 25,  warn: 15 },
    clickRate:      { good: 5,   warn: 2  },
    ctor:           { good: 15,  warn: 8  },
    completionRate: { good: 80,  warn: 50 }
};

document.addEventListener('DOMContentLoaded', () => {
    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');

    const storedStart = localStorage.getItem('dashboardStart');
    const storedEnd = localStorage.getItem('dashboardEnd');

    if (storedStart && storedEnd) {
        if (startDateInput) startDateInput.value = storedStart;
        if (endDateInput) endDateInput.value = storedEnd;
        fetchAll(storedStart, storedEnd);
    } else {
        fetchAll();
    }

    if (startDateInput && endDateInput) {
        const onChange = () => {
            if (startDateInput.value && endDateInput.value) {
                localStorage.setItem('dashboardStart', startDateInput.value);
                localStorage.setItem('dashboardEnd', endDateInput.value);
                fetchAll(startDateInput.value, endDateInput.value);
            }
        };
        startDateInput.addEventListener('change', onChange);
        endDateInput.addEventListener('change', onChange);
    }

    const searchInput = document.getElementById('journey-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => renderJourneys(e.target.value.trim().toLowerCase()));
    }
});

async function fetchAll(start, end) {
    const qs = start && end ? `?start=${start}&end=${end}` : '';
    const [dashData, trendData, bounceData] = await Promise.all([
        fetchJSON(`/api/dashboard${qs}`),
        fetchJSON(`/api/trends${qs}`),
        fetchJSON(`/api/bounces${qs}`)
    ]);
    if (dashData) renderDashboard(dashData, bounceData);
    if (trendData) renderTrendChart(trendData);
    if (dashData && dashData.journeys) renderRankingChart(dashData.journeys);
}

async function fetchJSON(url) {
    try {
        const res = await fetch(url);
        return await res.json();
    } catch (e) {
        console.error('Fetch error:', url, e);
        return null;
    }
}

function renderDashboard(data, bounceData) {
    if (data.appliedDateRange) {
        const startDateInput = document.getElementById('start-date');
        const endDateInput = document.getElementById('end-date');
        if (startDateInput && !startDateInput.value) startDateInput.value = data.appliedDateRange.start;
        if (endDateInput && !endDateInput.value) endDateInput.value = data.appliedDateRange.end;
        localStorage.setItem('dashboardStart', data.appliedDateRange.start);
        localStorage.setItem('dashboardEnd', data.appliedDateRange.end);
    }

    if (data.flow) {
        const f = data.flow;
        setText('flow-journeys', formatNumber(f.totalJourneys || 0));
        setText('flow-active', f.activeJourneys != null ? formatNumber(f.activeJourneys) : '-');
        setText('flow-entered', formatNumber(f.uniqueEntered));
        setText('flow-processed', (f.conversionRate || 0).toFixed(1) + '%');

        // Animate progress bars
        setTimeout(() => {
            setBar('bar-journeys', Math.min(100, ((f.totalJourneys || 0) / 30) * 100));
            setBar('bar-active', f.activeJourneys != null ? Math.min(100, (f.activeJourneys / (f.totalJourneys || 1)) * 100) : 0);
            setBar('bar-entered', 100);
            setBar('bar-processed', f.conversionRate || 0);
        }, 100);
    }

    if (data.engagement) {
        const e = data.engagement;
        setText('eng-sent', formatNumber(e.sent));

        const openRateEl = document.getElementById('eng-open');
        if (openRateEl) {
            openRateEl.textContent = e.uniqueOpenRate.toFixed(1) + '%';
            openRateEl.className = `text-2xl font-extrabold ${rateColorClass(e.uniqueOpenRate, THRESHOLDS.openRate.good, THRESHOLDS.openRate.warn)}`;
        }
        const clickRateEl = document.getElementById('eng-click');
        if (clickRateEl) {
            clickRateEl.textContent = e.uniqueClickRate.toFixed(1) + '%';
            clickRateEl.className = `text-2xl font-extrabold ${rateColorClass(e.uniqueClickRate, THRESHOLDS.clickRate.good, THRESHOLDS.clickRate.warn)}`;
        }
        const ctorEl = document.getElementById('eng-ctor');
        if (ctorEl) {
            ctorEl.textContent = e.ctor.toFixed(1) + '%';
            ctorEl.className = `text-2xl font-extrabold ${rateColorClass(e.ctor, THRESHOLDS.ctor.good, THRESHOLDS.ctor.warn)}`;
        }
        setText('eng-unsub', e.unsubscribe.toFixed(2) + '%');
        setText('eng-bounce', e.bounce.toFixed(2) + '%');

        setTimeout(() => {
            setBar('bar-open', Math.min(100, e.uniqueOpenRate));
            setBar('bar-click', Math.min(100, e.uniqueClickRate * 5));
            setBar('bar-ctor', Math.min(100, e.ctor));
        }, 100);
    }

    // Quick Diagnostics panel
    if (data.diagnostics) {
        const d = data.diagnostics;

        // Highest Bounce Email
        if (d.mostBouncedEmail) {
            setText('diag-bounce-email', d.mostBouncedEmail.name);
            setText('diag-bounce-email-count',
                `${d.mostBouncedEmail.rate.toFixed(1)}% bounce rate — ${d.mostBouncedEmail.bounceCount.toLocaleString()} of ${d.mostBouncedEmail.sends.toLocaleString()} sends`);
        } else {
            setText('diag-bounce-email', 'No bounce data');
            setText('diag-bounce-email-count', '');
        }

        // Top Failing Journey
        if (d.topFailingJourney) {
            setText('diag-error', d.topFailingJourney.journey);
            setText('diag-error-count', `${d.topFailingJourney.failCount.toLocaleString()} failures (Status = Failed)`);
        } else {
            setText('diag-error', 'No journey failures');
            setText('diag-error-count', '');
        }

        // Most Emailed Contact
        if (d.topEmailedCustomer) {
            setText('diag-top-contact', d.topEmailedCustomer.subscriberKey);
            setText('diag-top-contact-count', `received ${d.topEmailedCustomer.emailCount.toLocaleString()} emails in period`);
        } else {
            setText('diag-top-contact', 'No data');
            setText('diag-top-contact-count', '');
        }
    }

    if (data.flow) {
        setText('diag-failed', formatNumber(data.flow.failedContacts || 0));
    }

    currentJourneys = data.journeys || [];
    const searchInput = document.getElementById('journey-search');
    renderJourneys(searchInput ? searchInput.value.trim().toLowerCase() : '');
}

function renderTrendChart(trendData) {
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;

    const labels = trendData.map(d => {
        const dt = new Date(d.date);
        return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
    });
    const opens = trendData.map(d => d.opens);
    const clicks = trendData.map(d => d.clicks);
    const entries = trendData.map(d => d.entries);

    if (trendChart) trendChart.destroy();

    trendChart = new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: 'Opens',
                    data: opens,
                    borderColor: PRIMARY,
                    backgroundColor: PRIMARY + '18',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Clicks',
                    data: clicks,
                    borderColor: SECONDARY,
                    backgroundColor: SECONDARY + '18',
                    borderWidth: 2.5,
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Entries',
                    data: entries,
                    borderColor: TERTIARY,
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    borderDash: [4, 4],
                    pointRadius: 0,
                    pointHoverRadius: 5,
                    fill: false,
                    tension: 0.4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: ON_SURFACE,
                    bodyColor: ON_SURFACE_VARIANT,
                    borderColor: '#ebdede',
                    borderWidth: 1,
                    padding: 12,
                    titleFont: { family: 'Manrope', weight: '700', size: 13 },
                    bodyFont: { family: 'Manrope', size: 12 },
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${formatNumber(ctx.parsed.y)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        font: { family: 'Manrope', size: 11, weight: '500' },
                        color: ON_SURFACE_VARIANT,
                        maxTicksLimit: 10,
                        maxRotation: 0
                    }
                },
                y: {
                    grid: { color: SURFACE_CONTAINER, drawBorder: false },
                    border: { display: false },
                    ticks: {
                        font: { family: 'Manrope', size: 11, weight: '500' },
                        color: ON_SURFACE_VARIANT,
                        callback: v => formatNumber(v)
                    }
                }
            }
        }
    });
}

function renderRankingChart(journeys) {
    const canvas = document.getElementById('rankingChart');
    if (!canvas) return;

    const sorted = [...journeys]
        .filter(j => j.opensRate > 0)
        .sort((a, b) => b.opensRate - a.opensRate)
        .slice(0, 12);

    const labels = sorted.map(j => j.name.length > 28 ? j.name.substring(0, 28) + '…' : j.name);
    const openRates = sorted.map(j => Number(j.opensRate).toFixed(1));
    const clickRates = sorted.map(j => Number(j.clicksRate).toFixed(1));

    if (rankingChart) rankingChart.destroy();

    rankingChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Open Rate %',
                    data: openRates,
                    backgroundColor: PRIMARY + 'cc',
                    borderRadius: 6,
                    borderSkipped: false,
                },
                {
                    label: 'Click Rate %',
                    data: clickRates,
                    backgroundColor: SECONDARY + 'cc',
                    borderRadius: 6,
                    borderSkipped: false,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: {
                        font: { family: 'Manrope', size: 11, weight: '600' },
                        color: ON_SURFACE_VARIANT,
                        boxWidth: 10,
                        boxHeight: 10,
                        borderRadius: 3,
                        useBorderRadius: true,
                        padding: 16
                    }
                },
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: ON_SURFACE,
                    bodyColor: ON_SURFACE_VARIANT,
                    borderColor: '#ebdede',
                    borderWidth: 1,
                    padding: 12,
                    titleFont: { family: 'Manrope', weight: '700', size: 13 },
                    bodyFont: { family: 'Manrope', size: 12 },
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y}%`
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    border: { display: false },
                    ticks: {
                        font: { family: 'Manrope', size: 10, weight: '500' },
                        color: ON_SURFACE_VARIANT,
                        maxRotation: 35
                    }
                },
                y: {
                    grid: { color: SURFACE_CONTAINER, drawBorder: false },
                    border: { display: false },
                    ticks: {
                        font: { family: 'Manrope', size: 11, weight: '500' },
                        color: ON_SURFACE_VARIANT,
                        callback: v => v + '%'
                    }
                }
            }
        }
    });
}

function renderJourneys(searchQuery) {
    const listDiv = document.getElementById('journey-list');
    if (!listDiv) return;
    listDiv.innerHTML = '';

    const filtered = currentJourneys.filter(j =>
        !searchQuery || j.name.toLowerCase().includes(searchQuery)
    );

    if (filtered.length === 0) {
        listDiv.innerHTML = `<div class="px-6 py-8 text-center text-on-surface-variant text-sm font-medium">No journeys match your filter.</div>`;
        return;
    }

    filtered.forEach(j => {
        const el = document.createElement('div');
        el.className = "grid grid-cols-12 px-6 py-5 items-center bg-surface-container-lowest rounded-xl hover:shadow-lg hover:shadow-primary/5 transition-all cursor-pointer group fade-in";
        el.style.borderLeft = '3px solid transparent';
        el.addEventListener('mouseenter', () => { el.style.borderLeftColor = PRIMARY; });
        el.addEventListener('mouseleave', () => { el.style.borderLeftColor = 'transparent'; });
        el.onclick = () => window.location.href = `/journey?id=${j.journeyId}&version=${j.versionId}`;

        const versionLabel = j.version ? ` <span class="text-on-surface-variant font-medium">(v${escapeHtml(j.version)})</span>` : '';
        const iconName = j.type === 'One-Off' ? 'send' : 'auto_awesome';
        const modifiedText = formatModifiedLabel(j.modifiedDate);
        const openColor = rateColorClass(j.opensRate, THRESHOLDS.openRate.good, THRESHOLDS.openRate.warn);
        const clickColor = rateColorClass(j.clicksRate, THRESHOLDS.clickRate.good, THRESHOLDS.clickRate.warn);
        const completionColor = rateColorClass(j.conversionRate, THRESHOLDS.completionRate.good, THRESHOLDS.completionRate.warn);

        const populationVal = j.sfmcCurrentPopulation != null ? formatNumber(j.sfmcCurrentPopulation) : '-';

        el.innerHTML = `
            <div class="col-span-3 flex items-center gap-3">
                <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary group-hover:bg-primary group-hover:text-on-primary transition-colors flex-shrink-0">
                    <span class="material-symbols-outlined text-sm">${escapeHtml(iconName)}</span>
                </div>
                <div class="min-w-0">
                    <h3 class="font-bold text-on-surface group-hover:text-primary transition-colors truncate">${escapeHtml(j.name)}${versionLabel}</h3>
                    <p class="text-[0.6875rem] text-on-surface-variant font-medium">${modifiedText}</p>
                </div>
            </div>
            <div class="col-span-2 text-center">
                <span class="text-xs font-bold px-2 py-1 rounded-lg ${j.type === 'One-Off' ? 'bg-tertiary-fixed text-on-tertiary-fixed' : 'bg-secondary-container text-on-secondary-container'}">${escapeHtml(j.type)}</span>
            </div>
            <div class="col-span-2 text-center">
                <span class="text-lg font-extrabold ${completionColor}">${Number(j.conversionRate || 0).toFixed(1)}%</span>
            </div>
            <div class="col-span-2 text-center font-medium text-on-surface-variant">${formatNumber(j.entries)}</div>
            <div class="col-span-1 text-center font-medium text-on-surface-variant text-sm">${populationVal}</div>
            <div class="col-span-1 text-center font-bold text-sm ${openColor}">${Number(j.opensRate || 0).toFixed(1)}%</div>
            <div class="col-span-1 text-center font-bold text-sm ${clickColor}">${Number(j.clicksRate || 0).toFixed(1)}%</div>
        `;
        listDiv.appendChild(el);
    });
}

// --- Helpers ---

function rateColorClass(value, goodThreshold, warnThreshold) {
    if (value >= goodThreshold) return 'rate-good';
    if (value >= warnThreshold) return 'rate-warn';
    return 'rate-bad';
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function setBar(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function formatNumber(num) {
    if (num === null || num === undefined || Number.isNaN(num)) return '-';
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 10000) return (num / 1000).toFixed(1) + 'k';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

function formatHours(hrs) {
    if (hrs < 1) return Math.round(hrs * 60) + ' min avg';
    if (hrs < 24) return hrs.toFixed(1) + 'h avg';
    return (hrs / 24).toFixed(1) + ' days avg';
}

function formatModifiedLabel(value) {
    if (!value) return 'Modified recently';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return `Modified ${escapeHtml(String(value))}`;
    return `Modified ${date.toLocaleString('sv-SE', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
