/* 家电延保门户前端（原生 JS，无构建依赖） */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  tokens: { dealer: localStorage.getItem('wp_dealer_token') || null,
            admin: localStorage.getItem('wp_admin_token') || null },
  currentDeviceSerial: null,
  adminStatus: 'pending'
};

// ---------- 基础工具 ----------
function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
function escAttr(v) { return esc(v); }

async function api(path, { method = 'GET', body, role } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const token = role ? state.tokens[role] : null;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let payload;
  try { payload = await res.json(); } catch { payload = {}; }
  if (!res.ok || payload.ok === false) {
    const err = new Error(payload?.error?.message || `请求失败 (${res.status})`);
    err.status = res.status;
    err.code = payload?.error?.code;
    err.data = payload?.error?.data || payload?.data || null;
    throw err;
  }
  return payload.data;
}

let toastTimer = null;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function openModal(html) {
  $('#modal-body').innerHTML = html;
  $('#modal').hidden = false;
}
function closeModal() { $('#modal').hidden = true; }
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]')) closeModal();
});

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ---------- Tab 切换 ----------
$$('#tabs .tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#tabs .tab').forEach((b) => b.classList.toggle('active', b === btn));
    const view = btn.dataset.view;
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  });
});

// ================================================================
// 用户查询
// ================================================================
$$('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    $('#lookup-serial').value = chip.dataset.fill;
    $('#lookup-region').value = chip.textContent.includes('广州') ? '广州' : '';
  });
});

$('#lookup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const serial = $('#lookup-serial').value;
  const region = $('#lookup-region').value;
  const box = $('#lookup-result');
  if (!serial.trim()) { toast('请输入序列号'); return; }
  box.innerHTML = '<div class="card"><p class="muted">查询中…</p></div>';
  try {
    const data = await api('/api/public/lookup', { method: 'POST', body: { serial, region } });
    if (!data.found) {
      box.innerHTML = renderNotFound(data.serial, data.hint);
      bindReviewForm(data.serial);
    } else {
      state.currentDeviceSerial = data.device.serial;
      box.innerHTML = renderDevice(data.device);
      bindAfterLookup(data.device);
    }
  } catch (err) {
    box.innerHTML = `<div class="card"><div class="callout error">${esc(err.message)}</div></div>`;
  }
});

function statusBadge(status, label) {
  return `<span class="badge ${esc(status)}">${esc(label)}</span>`;
}

function renderNotFound(serial, hint) {
  return `
  <div class="card">
    <div class="result-head"><h2>未查询到该设备</h2>${statusBadge('unknown', '品牌库无记录')}</div>
    <div class="callout warn">
      序列号 <code>${esc(serial)}</code> 在品牌设备库中没有匹配记录。${esc(hint)}
    </div>
    ${reviewFormHTML(serial, { compact: false })}
  </div>`;
}

function reviewFormHTML(serial, opts = {}) {
  return `
  <div class="section-title">📝 申请人工审核${opts.followup ? '（补录购买日期/发票）' : ''}</div>
  <form class="review-form" data-review-form>
    <input type="hidden" name="serial" value="${escAttr(serial)}" />
    <div class="row2">
      <label>联系人姓名<input type="text" name="customerName" maxlength="40" placeholder="如：张三" required /></label>
      <label>联系电话<input type="text" name="contact" maxlength="20" placeholder="用于审核沟通" required /></label>
    </div>
    <div class="row2">
      <label>所在城市<input type="text" name="region" maxlength="40" placeholder="如：青岛" /></label>
      <label>凭证图片编号（选填）<input type="text" name="evidenceImage" maxlength="120"
        placeholder="上传小票/付款截图后的文件编号" /></label>
    </div>
    <label>情况说明（至少 10 字）
      <textarea name="reason" rows="3" minlength="10" required
        placeholder="请描述购买渠道、时间、发票遗失/缺失原因，以及可提供的其他购买凭证"></textarea>
    </label>
    <div><button type="submit" class="btn primary">提交人工审核</button></div>
    <p class="error-text" data-review-error></p>
  </form>`;
}

function bindReviewForm(serial) {
  const form = document.querySelector('[data-review-form]');
  if (!form) return;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errEl = form.querySelector('[data-review-error]');
    errEl.textContent = '';
    const payload = Object.fromEntries(new FormData(form).entries());
    payload.serial = serial;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = await api('/api/public/reviews', { method: 'POST', body: payload });
      $('#lookup-result').insertAdjacentHTML('beforeend', `
        <div class="card"><div class="callout success">
          ✅ ${esc(data.message)}<br/>请牢记工单编号（用于进度查询）：
          <code>${esc(data.reviewId)}</code>
        </div></div>`);
      form.remove();
      $('#review-status-card').hidden = false;
      $('#review-status-id').value = data.reviewId;
    } catch (err) {
      errEl.textContent = err.message;
      if (err.code === 'duplicate_review' && err.data?.reviewId) {
        $('#review-status-card').hidden = false;
        $('#review-status-id').value = err.data.reviewId;
      }
    } finally {
      btn.disabled = false;
    }
  });
}

function renderDevice(d) {
  const w = d.warranty;
  const ext = w.extension;
  let coverageLine = '';
  if (w.status === 'unknown') {
    coverageLine = `
      <div class="callout warn">
        ⚠️ 该设备缺少有效购买日期，保修期无法起算。请补充发票或提交人工审核后核定保修权益。
      </div>`;
  } else {
    const remain = w.status === 'expired'
      ? '保障已到期'
      : `剩余 <strong>${w.daysRemaining}</strong> 天`;
    coverageLine = `
      <div class="callout ${w.expiringSoon ? 'warn' : 'info'}">
        整机保障至 <strong>${esc(w.coverageEnd)}</strong>（${remain}）
        ${w.expiringSoon && w.status !== 'expired' ? '｜⏳ 即将到期，建议尽快续保' : ''}
      </div>`;
  }

  const outlets = d.outlets.length ? `
    <div class="section-title">🔧 可服务维修网点（${d.outlets.length}）</div>
    <div class="outlet-list">
      ${d.outlets.map((o) => `
        <div class="outlet">
          <div>
            <div class="o-name">${esc(o.name)}
              ${o.authorized ? '<span class="tag auth">品牌授权</span>' : '<span class="tag third">第三方联保</span>'}
              ${o.inRegion ? '<span class="tag region">📍 同城优先</span>' : ''}
            </div>
            <div class="o-meta">${esc(o.address)}</div>
            <div class="o-meta">服务时间：${esc(o.hours)}</div>
          </div>
          <div class="o-meta" style="text-align:right">☎️ ${esc(o.phone)}<br/>${esc(o.region)}</div>
        </div>`).join('')}
    </div>` : `
    <div class="section-title">🔧 维修网点</div>
    <p class="muted">暂未查询到可服务该品类的网点，请提交人工审核获取协助。</p>`;

  const plans = !d.availablePlans.length || w.status === 'unknown' ? '' : `
    <div class="section-title">🛡️ 可购买的延保服务</div>
    ${d.availablePlans.map((p) => `
      <div class="plan">
        <strong>${esc(p.name)}</strong>
        <span class="muted">${esc(p.coverage)} ｜ 延长 ${p.months} 个月（自基础保修到期日起）</span>
      </div>`).join('')}`;

  const reviewBlock = d.review ? `
    <div class="section-title">📨 最近人工审核</div>
    <div class="callout ${d.review.status === 'approved' ? 'success' : d.review.status === 'rejected' ? 'error' : 'warn'}">
      状态：${({ pending: '审核中', approved: '已通过', rejected: '已驳回' })[d.review.status]}
      ${d.review.status === 'approved' && d.review.verifiedPurchaseDate
        ? `｜核定购买日期 <strong>${esc(d.review.verifiedPurchaseDate)}</strong>` : ''}
      ${d.review.adminNote ? `<br/>审核说明：${esc(d.review.adminNote)}` : ''}
      ${d.review.status === 'pending' ? '｜预计 1-3 个工作日处理' : ''}
    </div>` : '';

  const needsReview = w.status === 'unknown' || !d.hasInvoice;

  return `
  <div class="card">
    <div class="result-head">
      <h2>${esc(d.brandLabel)} ${esc(d.applianceLabel)} · ${esc(d.model)}</h2>
      ${statusBadge(w.status, w.statusLabel)}
      ${ext ? '<span class="badge extended">已购延保</span>' : ''}
      ${d.purchaseVerifiedManually ? '<span class="badge approved">购买日期经人工核定</span>' : ''}
    </div>
    <p class="muted serial-cell" style="font-family:ui-monospace,Menlo,Consolas,monospace">
      序列号：${esc(d.serial)}
    </p>

    <dl class="info-grid">
      <div><dt>购买日期</dt><dd>${d.purchaseDate ? esc(d.purchaseDate) : '<span style="color:var(--unknown)">缺失，待核实</span>'}</dd></div>
      <div><dt>购机门店</dt><dd>${d.soldBy ? esc(d.soldBy.name) : '—'}</dd></div>
      <div><dt>发票</dt><dd>${d.hasInvoice ? '有有效发票' : '<span style="color:var(--danger)">发票缺失</span>'}</dd></div>
      <div><dt>整机基础保修</dt><dd>${w.baseWholeMonths} 个月${w.baseWholeEnd ? `（至 ${esc(w.baseWholeEnd)}）` : ''}</dd></div>
      <div><dt>${esc(d.systemLabel)}</dt><dd>${w.baseSystemMonths} 个月${w.baseSystemEnd ? `（至 ${esc(w.baseSystemEnd)}）` : ''}
        ${w.systemCovered === true ? ' · 在保' : w.systemCovered === false ? ' · 已出保' : ''}</dd></div>
      <div><dt>延保服务</dt><dd>${ext ? `${esc(ext.planName)}（${ext.months} 个月，至 ${esc(ext.end)}）` : '未购买'}</dd></div>
    </dl>

    ${coverageLine}
    ${reviewBlock}
    ${plans}
    ${outlets}
    ${needsReview ? reviewFormHTML(d.serial, { followup: true }) : ''}
  </div>`;
}

function bindAfterLookup(device) {
  $('#review-status-card').hidden = false;
  const form = document.querySelector('[data-review-form]');
  if (form) bindReviewForm(device.serial);
}

// 审核进度查询
$('#review-status-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#review-status-id').value.trim();
  const box = $('#review-status-result');
  if (!id) return;
  box.innerHTML = '<p class="muted">查询中…</p>';
  try {
    const data = await api(`/api/public/reviews/${encodeURIComponent(id)}`);
    const r = data.review;
    box.innerHTML = `
      <div class="callout ${r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'error' : 'warn'}">
        工单 <code>${esc(r.id)}</code><br/>
        序列号：<code>${esc(r.serial)}</code><br/>
        状态：${({ pending: '⏳ 审核中', approved: '✅ 已通过', rejected: '❌ 已驳回' })[r.status]}<br/>
        提交时间：${fmtDateTime(r.createdAt)}${r.resolvedAt ? `<br/>处理时间：${fmtDateTime(r.resolvedAt)}` : ''}
        ${r.verifiedPurchaseDate ? `<br/>核定购买日期：<strong>${esc(r.verifiedPurchaseDate)}</strong>` : ''}
        ${r.adminNote ? `<br/>审核说明：${esc(r.adminNote)}` : ''}
      </div>`;
  } catch (err) {
    box.innerHTML = `<div class="callout error">${esc(err.message)}</div>`;
  }
});

// ================================================================
// 经销商门户
// ================================================================
$('#dealer-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#dealer-login-error');
  errEl.textContent = '';
  try {
    const data = await api('/api/auth/login/dealer', {
      method: 'POST',
      body: { username: $('#dealer-username').value, password: $('#dealer-password').value }
    });
    state.tokens.dealer = data.token;
    localStorage.setItem('wp_dealer_token', data.token);
    await enterDealer(data);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

$('#dealer-logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', role: 'dealer' }); } catch {}
  state.tokens.dealer = null;
  localStorage.removeItem('wp_dealer_token');
  $('#dealer-login').hidden = false;
  $('#dealer-panel').hidden = true;
});

$('#dealer-filter-form').addEventListener('submit', (e) => { e.preventDefault(); loadDealerDevices(); });
$('#dealer-filter-reset').addEventListener('click', () => {
  $('#dealer-q').value = '';
  $('#dealer-type').value = '';
  $('#dealer-status').value = '';
  loadDealerDevices();
});

async function enterDealer(data) {
  $('#dealer-login').hidden = true;
  $('#dealer-panel').hidden = false;
  $('#dealer-name').textContent = data.user.name;
  $('#dealer-brand').textContent =
    `品牌授权：${({ haier: '海尔', midea: '美的', gree: '格力' })[data.user.brand] || data.user.brand} ｜ 仅可查看本门店售出设备`;
  await loadDealerDevices();
}

async function loadDealerDevices() {
  const params = new URLSearchParams();
  const q = $('#dealer-q').value.trim();
  const type = $('#dealer-type').value;
  const status = $('#dealer-status').value;
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  if (status) params.set('status', status);
  const tbody = $('#dealer-tbody');
  tbody.innerHTML = '<tr><td colspan="7" class="muted">加载中…</td></tr>';
  try {
    const data = await api(`/api/dealer/devices?${params}`, { role: 'dealer' });
    $('#dealer-count').textContent =
      `共 ${data.total} 台设备（数据范围：${data.dealer.name} 本店售出）`;
    if (!data.devices.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty">没有符合条件的设备</td></tr>';
      return;
    }
    tbody.innerHTML = data.devices.map((d) => `
      <tr>
        <td class="serial-cell">${esc(d.serial)}</td>
        <td>${esc(d.applianceLabel)}<br/><span class="muted">${esc(d.model)}</span></td>
        <td>${d.purchaseDate ? esc(d.purchaseDate) : '<span class="badge unknown">待核实</span>'}</td>
        <td>${d.warranty.coverageEnd ? esc(d.warranty.coverageEnd) : '—'}
          ${d.warranty.expiringSoon ? '<span class="tag region">临期</span>' : ''}</td>
        <td>${statusBadge(d.warranty.status, d.warranty.statusLabel)}</td>
        <td>${d.warranty.extension ? `已购（${esc(d.warranty.extension.planName)}）` : '—'}</td>
        <td><button class="btn sm" data-device-id="${esc(d.id)}">详情</button></td>
      </tr>`).join('');
    $$('#dealer-tbody [data-device-id]').forEach((btn) => {
      btn.addEventListener('click', () => showDealerDevice(btn.dataset.deviceId));
    });
  } catch (err) {
    if (err.status === 401) {
      state.tokens.dealer = null;
      localStorage.removeItem('wp_dealer_token');
      $('#dealer-login').hidden = false;
      $('#dealer-panel').hidden = true;
    } else {
      toast(err.message);
    }
  }
}

async function showDealerDevice(id) {
  try {
    const data = await api(`/api/dealer/devices/${encodeURIComponent(id)}`, { role: 'dealer' });
    const d = data.device;
    const w = d.warranty;
    openModal(`
      <div class="result-head">
        <h2>${esc(d.serial)}</h2>${statusBadge(w.status, w.statusLabel)}
      </div>
      <dl class="info-grid">
        <div><dt>品牌/品类</dt><dd>${esc(d.brandLabel)} ${esc(d.applianceLabel)}</dd></div>
        <div><dt>型号</dt><dd>${esc(d.model)}</dd></div>
        <div><dt>购买日期</dt><dd>${d.purchaseDate ? esc(d.purchaseDate) : '待核实'}</dd></div>
        <div><dt>保障截止</dt><dd>${w.coverageEnd ? esc(w.coverageEnd) : '—'}</dd></div>
        <div><dt>发票</dt><dd>${d.hasInvoice ? '有' : '缺失'}</dd></div>
        <div><dt>延保</dt><dd>${w.extension ? `${esc(w.extension.planName)}（至 ${esc(w.extension.end)}）` : '未购买'}</dd></div>
        <div><dt>客户</dt><dd>${esc(d.customer?.name || '—')} ${esc(d.customer?.phone || '')}</dd></div>
        <div><dt>所属门店</dt><dd>${esc(d.soldBy?.name || '—')}</dd></div>
      </dl>
      ${d.note ? `<div class="callout info">备注：${esc(d.note)}</div>` : ''}
      ${data.reviews.length ? `
        <div class="section-title">关联审核工单</div>
        ${data.reviews.map((r) => `
          <div class="review-item">
            <div class="ri-head"><strong>${esc(r.id)}</strong>${statusBadge(r.status, ({ pending: '审核中', approved: '已通过', rejected: '已驳回' })[r.status])}</div>
            <div class="ri-meta">提交：${fmtDateTime(r.createdAt)}${r.adminNote ? `<br/>说明：${esc(r.adminNote)}` : ''}</div>
          </div>`).join('')}` : ''}
      <div style="margin-top:14px;text-align:right">
        <button class="btn ghost" data-close>关闭</button>
      </div>`);
  } catch (err) { toast(err.message); }
}

// ================================================================
// 审核后台
// ================================================================
$('#admin-login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = $('#admin-login-error');
  errEl.textContent = '';
  try {
    const data = await api('/api/auth/login/admin', {
      method: 'POST',
      body: { username: $('#admin-username').value, password: $('#admin-password').value }
    });
    state.tokens.admin = data.token;
    localStorage.setItem('wp_admin_token', data.token);
    enterAdmin();
  } catch (err) { errEl.textContent = err.message; }
});

$('#admin-logout').addEventListener('click', async () => {
  try { await api('/api/auth/logout', { method: 'POST', role: 'admin' }); } catch {}
  state.tokens.admin = null;
  localStorage.removeItem('wp_admin_token');
  $('#admin-login').hidden = false;
  $('#admin-panel').hidden = true;
});

$$('#admin-seg .seg').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('#admin-seg .seg').forEach((b) => b.classList.toggle('active', b === btn));
    state.adminStatus = btn.dataset.status;
    loadAdminReviews();
  });
});

function enterAdmin() {
  $('#admin-login').hidden = true;
  $('#admin-panel').hidden = false;
  loadAdminReviews();
}

async function loadAdminReviews() {
  const box = $('#admin-review-list');
  box.innerHTML = '<p class="muted">加载中…</p>';
  try {
    const params = state.adminStatus ? `?status=${encodeURIComponent(state.adminStatus)}` : '';
    const data = await api(`/api/admin/reviews${params}`, { role: 'admin' });
    if (!data.reviews.length) {
      box.innerHTML = '<div class="empty">暂无工单</div>';
      return;
    }
    box.innerHTML = data.reviews.map((r) => `
      <div class="review-item">
        <div class="ri-head">
          <div>
            <strong class="serial-cell">${esc(r.serial)}</strong>
            ${r.deviceFound
              ? `<span class="tag auth">已匹配设备：${esc(r.device.brandLabel)} ${esc(r.device.applianceLabel)} ${esc(r.device.model)}</span>`
              : '<span class="tag third">设备库无匹配（需重点核验）</span>'}
          </div>
          ${statusBadge(r.status, ({ pending: '待审核', approved: '已通过', rejected: '已驳回' })[r.status])}
        </div>
        <div class="ri-meta">
          工单：${esc(r.id)} ｜ 申请人：${esc(r.customerName)} ｜ 电话：${esc(r.contact)}
          ｜ 城市：${esc(r.region || '—')} ｜ 提交：${fmtDateTime(r.createdAt)}
          ${r.evidenceImage ? ` ｜ 凭证：${esc(r.evidenceImage)}` : ' ｜ 无凭证附件'}
        </div>
        <pre class="reason">${esc(r.reason)}</pre>
        ${r.adminNote ? `<div class="callout ${r.status === 'approved' ? 'success' : 'error'}">
          审核说明：${esc(r.adminNote)}
          ${r.verifiedPurchaseDate ? `｜核定购买日期：<strong>${esc(r.verifiedPurchaseDate)}</strong>` : ''}
          ${r.resolvedAt ? `｜处理时间：${fmtDateTime(r.resolvedAt)}` : ''}
        </div>` : ''}
        ${r.status === 'pending' ? `
        <div class="review-actions">
          <button class="btn primary sm" data-approve="${esc(r.id)}" data-serial="${escAttr(r.serial)}"
            data-found="${r.deviceFound ? 1 : 0}">通过并核定购买日期</button>
          <button class="btn danger sm" data-reject="${esc(r.id)}">驳回</button>
        </div>` : ''}
      </div>`).join('');

    $$('[data-approve]').forEach((btn) => {
      btn.addEventListener('click', () => openApproveModal(btn.dataset.approve, btn.dataset.found === '1'));
    });
    $$('[data-reject]').forEach((btn) => {
      btn.addEventListener('click', () => openRejectModal(btn.dataset.reject));
    });
  } catch (err) {
    if (err.status === 401) {
      state.tokens.admin = null;
      localStorage.removeItem('wp_admin_token');
      $('#admin-login').hidden = false;
      $('#admin-panel').hidden = true;
    } else {
      toast(err.message);
    }
  }
}

function openApproveModal(id, deviceFound) {
  openModal(`
    <h2>通过审核</h2>
    <p class="muted">通过后，系统将把核定的购买日期写入设备档案，保修期限据此重新计算。</p>
    <form class="stack-form" id="approve-form">
      <label>核定购买日期（YYYY-MM-DD）
        <input type="date" name="verifiedPurchaseDate" required max="${new Date().toISOString().slice(0, 10)}" />
      </label>
      <label>审核说明
        <textarea name="adminNote" rows="3" placeholder="如：小票与付款记录一致，予以认定"></textarea>
      </label>
      ${deviceFound ? '' : '<div class="callout warn">注意：该序列号未匹配到设备库记录，通过将仅记录审核结论。</div>'}
      <p class="error-text" id="approve-error"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn ghost" data-close>取消</button>
        <button type="submit" class="btn primary">确认通过</button>
      </div>
    </form>`);
  $('#approve-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api(`/api/admin/reviews/${encodeURIComponent(id)}/approve`, {
        method: 'POST', role: 'admin', body: fd
      });
      closeModal();
      toast('已通过审核，保修日期已更新');
      loadAdminReviews();
    } catch (err) { $('#approve-error').textContent = err.message; }
  });
}

function openRejectModal(id) {
  openModal(`
    <h2>驳回审核</h2>
    <form class="stack-form" id="reject-form">
      <label>驳回原因（必填，将展示给申请人）
        <textarea name="adminNote" rows="4" required minlength="4"
          placeholder="如：序列号在品牌库无法核验，且未能提供有效购买凭证"></textarea>
      </label>
      <p class="error-text" id="reject-error"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button type="button" class="btn ghost" data-close>取消</button>
        <button type="submit" class="btn danger">确认驳回</button>
      </div>
    </form>`);
  $('#reject-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target).entries());
    try {
      await api(`/api/admin/reviews/${encodeURIComponent(id)}/reject`, {
        method: 'POST', role: 'admin', body: fd
      });
      closeModal();
      toast('已驳回该审核申请');
      loadAdminReviews();
    } catch (err) { $('#reject-error').textContent = err.message; }
  });
}

// ================================================================
// 会话恢复
// ================================================================
(async function restoreSessions() {
  if (state.tokens.dealer) {
    try {
      const data = await api('/api/auth/me', { role: 'dealer' });
      if (data.user.role === 'dealer') {
        $('#dealer-login').hidden = true;
        $('#dealer-panel').hidden = false;
        $('#dealer-name').textContent = data.user.name;
        $('#dealer-brand').textContent =
          `品牌授权：${({ haier: '海尔', midea: '美的', gree: '格力' })[data.user.brand]} ｜ 仅可查看本门店售出设备`;
        loadDealerDevices();
      }
    } catch { localStorage.removeItem('wp_dealer_token'); state.tokens.dealer = null; }
  }
  if (state.tokens.admin) {
    try {
      const data = await api('/api/auth/me', { role: 'admin' });
      if (data.user.role === 'admin') enterAdmin();
    } catch { localStorage.removeItem('wp_admin_token'); state.tokens.admin = null; }
  }
})();
