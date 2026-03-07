/* AgentFolio Client-Side Interactivity */

// ============================================
// TABLE SORTING
// ============================================
function initLeaderboardSort() {
  const table = document.getElementById('leaderboard-table');
  if (!table) return;

  const headers = table.querySelectorAll('th[data-sort]');
  let currentSort = 'rep';
  let currentDir = 'desc';

  headers.forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (currentSort === col) {
        currentDir = currentDir === 'desc' ? 'asc' : 'desc';
      } else {
        currentSort = col;
        currentDir = 'desc';
      }
      sortTable(table, col, currentDir);
      // Update arrows
      headers.forEach(h => h.classList.remove('sorted'));
      th.classList.add('sorted');
      const arrow = th.querySelector('.sort-arrow');
      if (arrow) arrow.textContent = currentDir === 'desc' ? '↓' : '↑';
    });
  });
}

function sortTable(table, col, dir) {
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));

  rows.sort((a, b) => {
    let va = a.dataset[col] || a.querySelector(`[data-val-${col}]`)?.dataset[`val${col.charAt(0).toUpperCase()+col.slice(1)}`] || '';
    let vb = b.dataset[col] || b.querySelector(`[data-val-${col}]`)?.dataset[`val${col.charAt(0).toUpperCase()+col.slice(1)}`] || '';

    // Try numeric
    const na = parseFloat(va), nb = parseFloat(vb);
    if (!isNaN(na) && !isNaN(nb)) {
      return dir === 'desc' ? nb - na : na - nb;
    }
    // String compare
    return dir === 'desc' ? vb.localeCompare(va) : va.localeCompare(vb);
  });

  rows.forEach((row, i) => {
    row.querySelector('td:first-child').textContent = i + 1;
    tbody.appendChild(row);
  });
}

// ============================================
// LIVE SEARCH / FILTER (Homepage)
// ============================================
function initSearch() {
  const searchInput = document.getElementById('header-search') || document.getElementById('search');
  if (!searchInput) return;

  let debounceTimer;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const q = searchInput.value.trim().toLowerCase();
      filterAgents(q);
    }, 200);
  });

  // Cmd+K shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
}

function filterAgents(query) {
  // Filter table rows
  const tableRows = document.querySelectorAll('#leaderboard-table tbody tr');
  tableRows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(query) ? '' : 'none';
  });

  // Filter cards
  const cards = document.querySelectorAll('.cards-grid .card');
  cards.forEach(card => {
    const text = card.textContent.toLowerCase();
    card.style.display = text.includes(query) ? '' : 'none';
  });
}

// ============================================
// PROFILE TABS
// ============================================
function initTabs() {
  const tabs = document.querySelectorAll('.profile-tab');
  if (!tabs.length) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const target = tab.dataset.tab;
      // Deactivate all
      tabs.forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      // Activate target
      tab.classList.add('active');
      const content = document.getElementById(`tab-${target}`);
      if (content) content.classList.add('active');
    });
  });
}

// ============================================
// SPARKLINE SVG GENERATOR
// ============================================
function generateSparkline(containerId, data, color = '#06b6d4') {
  const container = document.getElementById(containerId);
  if (!container || !data || !data.length) return;

  const w = container.offsetWidth || 200;
  const h = 40;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x},${y}`;
  });

  const svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <polygon points="${points.join(' ')} ${w},${h} 0,${h}" fill="url(#sparkGrad)"/>
    <polyline points="${points.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  container.innerHTML = svg;
}

// ============================================
// COUNT-UP ANIMATION
// ============================================
function animateCountUp(el) {
  const target = parseInt(el.dataset.count || el.textContent);
  if (isNaN(target)) return;
  
  const duration = 600;
  const start = Date.now();
  const startVal = 0;

  function update() {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(startVal + (target - startVal) * eased);
    if (progress < 1) requestAnimationFrame(update);
  }
  update();
}

// ============================================
// MOBILE NAV
// ============================================
function initMobileNav() {
  const hamburger = document.querySelector('.hamburger');
  const overlay = document.querySelector('.mobile-nav-overlay');
  if (!hamburger || !overlay) return;

  hamburger.addEventListener('click', () => overlay.classList.add('open'));
  overlay.querySelector('.close-btn')?.addEventListener('click', () => overlay.classList.remove('open'));
  overlay.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => overlay.classList.remove('open'));
  });
}

// ============================================
// THEME TOGGLE
// ============================================
function initTheme() {
  const toggle = document.querySelector('.theme-toggle');
  if (!toggle) return;

  const current = localStorage.getItem('theme') || 'dark';
  document.documentElement.setAttribute('data-theme', current);
  toggle.textContent = current === 'dark' ? '🌙' : '☀️';

  toggle.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    toggle.textContent = next === 'dark' ? '🌙' : '☀️';
  });
}

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initSearch();
  initLeaderboardSort();
  initTabs();
  initMobileNav();

  // Count-up for stats
  document.querySelectorAll('[data-count]').forEach(el => {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          animateCountUp(el);
          observer.disconnect();
        }
      });
    });
    observer.observe(el);
  });

  // Init sparklines if data present
  const sparkData = window.__sparklineData;
  if (sparkData) {
    Object.keys(sparkData).forEach(id => {
      generateSparkline(id, sparkData[id]);
    });
  }
});
