/* Edge Lab private history: loaded separately from dashboard markup. */
(() => {
  const form = document.getElementById('edgeLabUnlockForm');
  const status = document.getElementById('edgeLabHistoryStatus');
  const list = document.getElementById('edgeLabHistoryList');
  const input = document.getElementById('edgeLabToken');
  const lock = document.getElementById('edgeLabLock');
  if (!form || !status || !list || !input || !lock) return;

  const formatMoney = value => {
    const number = Number(value);
    return value != null && Number.isFinite(number)
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number)
      : '—';
  };
  const textNode = (tag, value, className) => {
    const node = document.createElement(tag);
    node.textContent = value == null ? '—' : String(value);
    if (className) node.className = className;
    return node;
  };
  const spaced = value => String(value || 'UNKNOWN').replaceAll('_', ' ');
  const lockHistory = () => {
    input.value = '';
    list.replaceChildren();
    status.textContent = 'Private history locked. Your code is not stored by the page.';
  };

  function renderSlip(slip) {
    const card = document.createElement('article');
    card.className = 'card';
    card.appendChild(textNode('div', String(slip.event_date || 'Unknown date') + ' · ' + String(slip.source || 'Saved ticket'), 'match'));
    card.appendChild(textNode('div',
      'Entry ' + formatMoney(slip.ticket_wager_usd) +
      ' · Potential payout ' + formatMoney(slip.potential_payout_usd) +
      ' · ' + spaced(slip.reported_slip_status) +
      ' · Captured ' + spaced(slip.recorded_at_stage), 'reason'));
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;gap:8px;margin-top:12px';
    for (const leg of Array.isArray(slip.legs) ? slip.legs : []) {
      const item = document.createElement('div');
      item.className = 'stat';
      const headline = document.createElement('div');
      const player = textNode('strong', leg.player);
      headline.appendChild(player);
      headline.appendChild(document.createTextNode(
        ' · ' + String(leg.side || '') + ' ' + String(leg.line ?? '') +
        ' ' + spaced(leg.market)
      ));
      item.appendChild(headline);
      const original = leg.prior_assistant_paper_buy
        ? 'Paper model candidate' +
          (leg.prior_paper_line != null ? ' (original line ' + leg.prior_paper_line + ')' : '')
        : 'User ticket leg only';
      item.appendChild(textNode('div', 'Screenshot stat: ' + (leg.screenshot_stat ?? '—') + ' · ' + original, 'small'));
      grid.appendChild(item);
    }
    card.appendChild(grid);
    card.appendChild(textNode('p', slip.integrity_notes || 'Unverified screenshot data', 'reason'));
    return card;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const token = input.value;
    input.value = '';
    list.replaceChildren();
    status.textContent = 'Loading private slips…';
    try {
      const response = await fetch('/api/dashboard?view=edge-lab-history', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
        credentials: 'same-origin'
      });
      if (!response.ok) {
        status.textContent = response.status === 401
          ? 'Incorrect access code.'
          : 'History unavailable. Check the server configuration.';
        return;
      }
      const data = await response.json();
      if (!Array.isArray(data.slips)) throw new Error('Invalid archive response');
      status.textContent = data.slips.length + ' saved slip(s). Results are historical evidence, not official settlement.';
      for (const slip of data.slips) list.appendChild(renderSlip(slip));
    } catch {
      status.textContent = 'History request failed. Please try again.';
    }
  });
  lock.addEventListener('click', lockHistory);
})();
