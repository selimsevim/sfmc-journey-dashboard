const PRIMARY = '#f64d50';
const SECONDARY = '#006a62';
const ON_SURFACE = '#201a1a';
const ON_SURFACE_VARIANT = '#534343';
const SURFACE_CONTAINER = '#f1e7e7';

let stepChart = null;

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const jId = urlParams.get('id');
    const vId = urlParams.get('version');

    if (!jId || !vId) {
        document.getElementById('journey-name').textContent = 'Journey ID Missing';
        return;
    }

    const startDateInput = document.getElementById('start-date');
    const endDateInput = document.getElementById('end-date');

    const storedStart = localStorage.getItem('dashboardStart');
    const storedEnd = localStorage.getItem('dashboardEnd');

    if (storedStart && storedEnd) {
        if (startDateInput) startDateInput.value = storedStart;
        if (endDateInput) endDateInput.value = storedEnd;
        fetchJourneyDetails(jId, vId, storedStart, storedEnd);
    } else {
        fetchJourneyDetails(jId, vId);
    }

    if (startDateInput && endDateInput) {
        const onChange = () => {
            if (startDateInput.value && endDateInput.value) {
                localStorage.setItem('dashboardStart', startDateInput.value);
                localStorage.setItem('dashboardEnd', endDateInput.value);
                fetchJourneyDetails(jId, vId, startDateInput.value, endDateInput.value);
            }
        };
        startDateInput.addEventListener('change', onChange);
        endDateInput.addEventListener('change', onChange);
    }
});

async function fetchJourneyDetails(jId, vId, start, end) {
    try {
        let url = `/api/journey/${jId}/${vId}`;
        if (start && end) url += `?start=${start}&end=${end}`;

        const res = await fetch(url);
        const data = await res.json();

        if (data.error) {
            document.getElementById('journey-name').textContent = 'Journey Not Found';
            return;
        }

        document.getElementById('journey-name').textContent = `${data.name} (v${data.version})`;

        let totalPop = 0;
        let journeyOpens = 0;
        let journeyClicks = 0;

        // Population from StartInteractionActivity
        const startStep = data.activitiesList.find(a => a.type === 'StartInteractionActivity');
        if (startStep) totalPop = startStep.populationCount;

        const emailsOnly = data.activitiesList.filter(act =>
            act.type && act.type.toLowerCase().includes('email')
        );

        emailsOnly.forEach(act => {
            if (totalPop === 0) totalPop = act.populationCount;
            journeyOpens += act.uniqueOpens;
            journeyClicks += act.uniqueClicks;
        });

        // KPI Cards
        setText('total-pop', formatNumber(totalPop));
        setText('total-opens', formatNumber(journeyOpens));
        setText('total-clicks', formatNumber(journeyClicks));
        const ctor = journeyOpens > 0 ? ((journeyClicks / journeyOpens) * 100).toFixed(1) + '%' : '-';
        setText('total-ctor', ctor);

        // Animated bars
        setTimeout(() => {
            const openPct = totalPop > 0 ? (journeyOpens / totalPop) * 100 : 0;
            const clickPct = totalPop > 0 ? (journeyClicks / totalPop) * 100 : 0;
            const ctorPct = journeyOpens > 0 ? (journeyClicks / journeyOpens) * 100 : 0;
            setBar('bar-opens', Math.min(100, openPct));
            setBar('bar-clicks', Math.min(100, clickPct * 3));
            setBar('bar-ctor', Math.min(100, ctorPct));
        }, 100);

        // Step chart
        renderStepChart(emailsOnly);

        // Step cards
        const stepsDiv = document.getElementById('journey-steps');
        stepsDiv.innerHTML = '';
        const stepCountEl = document.getElementById('step-count');
        if (stepCountEl) stepCountEl.textContent = `${emailsOnly.length} Email Step${emailsOnly.length !== 1 ? 's' : ''}`;

        emailsOnly.forEach((act, index) => {
            const openColor = rateColorClass(act.openRate, 25, 15);
            const clickColor = rateColorClass(act.clickRate, 5, 2);
            const ctorVal = act.uniqueOpens > 0 ? ((act.uniqueClicks / act.uniqueOpens) * 100).toFixed(1) : '0.0';
            const isLast = index === emailsOnly.length - 1;

            const wrapper = document.createElement('div');
            wrapper.className = 'flex gap-6 items-start fade-in';

            wrapper.innerHTML = `
                <div class="hidden md:flex flex-col items-center flex-shrink-0" style="margin-top:4px">
                    <div class="w-11 h-11 rounded-full bg-primary flex items-center justify-center text-on-primary font-extrabold shadow-lg text-sm" style="box-shadow:0 4px 16px #f64d5030">${index + 1}</div>
                    ${!isLast ? '<div style="width:2px;height:64px;background:#d8c2c2;margin-top:4px"></div>' : ''}
                </div>
                <div class="flex-grow bg-surface-container-low rounded-2xl p-5 w-full transition-all hover:bg-surface-container" style="border-left:4px solid ${PRIMARY}">
                    <div class="flex flex-col md:flex-row md:items-start justify-between gap-4">
                        <div class="flex gap-3 items-start">
                            <div class="w-12 h-12 bg-surface-container-lowest rounded-xl flex items-center justify-center flex-shrink-0">
                                <span class="material-symbols-outlined text-primary text-2xl">mail</span>
                            </div>
                            <div>
                                <p class="text-[0.625rem] font-bold text-primary uppercase tracking-widest mb-0.5">Email Step</p>
                                <h3 class="text-lg font-bold text-on-surface leading-tight">${escapeHtml(act.name)}</h3>
                                <p class="text-xs text-on-surface-variant font-medium mt-0.5">${formatNumber(act.populationCount)} recipients</p>
                            </div>
                        </div>
                        <div class="flex gap-8 md:gap-10 flex-shrink-0">
                            <div>
                                <p class="text-[0.625rem] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Open Rate</p>
                                <p class="text-2xl font-extrabold ${openColor}">${act.openRate.toFixed(1)}%</p>
                                <div class="mt-1.5 h-1 w-20 bg-surface-container rounded-full overflow-hidden">
                                    <div class="bg-primary h-full kpi-bar" style="width:${Math.min(100, act.openRate)}%"></div>
                                </div>
                            </div>
                            <div>
                                <p class="text-[0.625rem] font-bold text-on-surface-variant uppercase tracking-wider mb-1">Click Rate</p>
                                <p class="text-2xl font-extrabold ${clickColor}">${act.clickRate.toFixed(1)}%</p>
                                <div class="mt-1.5 h-1 w-20 bg-surface-container rounded-full overflow-hidden">
                                    <div class="bg-secondary h-full kpi-bar" style="width:${Math.min(100, act.clickRate * 5)}%"></div>
                                </div>
                            </div>
                            <div>
                                <p class="text-[0.625rem] font-bold text-on-surface-variant uppercase tracking-wider mb-1">CTOR</p>
                                <p class="text-2xl font-extrabold text-on-surface">${ctorVal}%</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            stepsDiv.appendChild(wrapper);
        });

        if (emailsOnly.length === 0) {
            stepsDiv.innerHTML = `<div class="text-center py-12 text-on-surface-variant font-medium">No email steps found for this journey in the selected date range.</div>`;
        }

    } catch (e) {
        console.error('Failed to fetch journey detail', e);
    }
}

function renderStepChart(emailsOnly) {
    const canvas = document.getElementById('stepChart');
    if (!canvas || emailsOnly.length === 0) return;

    const labels = emailsOnly.map((a, i) => {
        const n = a.name && a.name.length > 22 ? a.name.substring(0, 22) + '…' : (a.name || `Step ${i + 1}`);
        return n;
    });

    if (stepChart) stepChart.destroy();

    stepChart = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: 'Open Rate %',
                    data: emailsOnly.map(a => Number(a.openRate).toFixed(1)),
                    backgroundColor: PRIMARY + 'cc',
                    borderRadius: 6,
                    borderSkipped: false
                },
                {
                    label: 'Click Rate %',
                    data: emailsOnly.map(a => Number(a.clickRate).toFixed(1)),
                    backgroundColor: SECONDARY + 'cc',
                    borderRadius: 6,
                    borderSkipped: false
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
                    borderColor: '#d8c2c2',
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
                        maxRotation: 25
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
    if (num === null || num === undefined || Number.isNaN(Number(num))) return '-';
    num = Number(num);
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 10000) return (num / 1000).toFixed(1) + 'k';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
