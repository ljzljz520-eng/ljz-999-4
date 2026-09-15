// 家电延保序列号门户 —— 零依赖 Node HTTP 服务
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import {
  initStore, getDB, save,
  findDeviceBySerial, normalizeSerial, getDevice, getDealer,
  findUserByUsername, getUser,
  createSession, getSession, deleteSession,
  addReview, getReview, listReviews, listReviewsForDevice,
  listDevices, updateReview, updateDevice, listOutlets
} from './src/store.js';
import { verifyPassword, newToken } from './src/auth.js';
import {
  APPLIANCES, BRANDS, BASE_WARRANTY, EXT_PLANS, deriveWarranty, matchOutlets
} from './src/warranty.js';
import { isValidDate, todayUTC, toISODate } from './src/dates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png'
};

// ---------- HTTP 辅助 ----------
function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function ok(res, data) { sendJSON(res, 200, { ok: true, data }); }
function fail(res, status, code, message, extra = {}) {
  sendJSON(res, status, { ok: false, error: { code, message, ...extra } });
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) { reject(new Error('payload too large')); req.destroy(); return; }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

// ---------- 鉴权 ----------
function getToken(req) {
  const header = req.headers['authorization'] || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

function authenticate(req) {
  const token = getToken(req);
  if (!token) return null;
  const session = getSession(token);
  if (!session) return null;
  if (session.expiresAt && new Date(session.expiresAt) < new Date()) return null;
  return getUser(session.userId);
}

function requireAuth(req, res, role) {
  const user = authenticate(req);
  if (!user) { fail(res, 401, 'unauthorized', '请先登录'); return null; }
  if (role && user.role !== role) {
    fail(res, 403, 'forbidden', '无权访问该资源');
    return null;
  }
  return user;
}

// ---------- 视图投影 ----------
function publicDeviceView(device, region) {
  const dealer = device.soldByDealerId ? getDealer(device.soldByDealerId) : null;
  const warranty = deriveWarranty(device);
  const outlets = matchOutlets(listOutlets(), device, region);
  const reviews = listReviewsForDevice(device.id);
  const latestReview = reviews[0] || null;
  return {
    serial: device.serial,
    brand: device.brand,
    brandLabel: BRANDS[device.brand] || device.brand,
    applianceType: device.applianceType,
    applianceLabel: APPLIANCES[device.applianceType]?.label || device.applianceType,
    systemLabel: APPLIANCES[device.applianceType]?.systemLabel || '核心部件',
    model: device.model,
    purchaseDate: device.purchaseDate,
    purchaseVerified: warranty.purchaseVerified,
    purchaseVerifiedManually: !!device.purchaseVerifiedManually,
    hasInvoice: !!device.hasInvoice,
    soldBy: dealer ? { name: dealer.name } : null,
    warranty: {
      status: warranty.status,
      statusLabel: warranty.statusLabel,
      baseWholeMonths: BASE_WARRANTY[device.applianceType]?.whole ?? null,
      baseSystemMonths: BASE_WARRANTY[device.applianceType]?.system ?? null,
      baseWholeEnd: warranty.baseWholeEnd,
      baseSystemEnd: warranty.baseSystemEnd,
      systemCovered: warranty.systemCovered,
      extension: warranty.extension,
      coverageEnd: warranty.coverageEnd,
      daysRemaining: warranty.daysRemaining,
      expiringSoon: warranty.expiringSoon
    },
    availablePlans: EXT_PLANS[device.brand] || [],
    outlets,
    review: latestReview
      ? {
          status: latestReview.status,
          reason: latestReview.status === 'rejected' ? undefined : latestReview.reason,
          adminNote: latestReview.adminNote,
          verifiedPurchaseDate: latestReview.verifiedPurchaseDate,
          createdAt: latestReview.createdAt,
          resolvedAt: latestReview.resolvedAt
        }
      : null
  };
}

function dealerDeviceView(device) {
  const warranty = deriveWarranty(device);
  const dealer = getDealer(device.soldByDealerId);
  const reviews = listReviewsForDevice(device.id);
  return {
    id: device.id,
    serial: device.serial,
    brand: device.brand,
    brandLabel: BRANDS[device.brand] || device.brand,
    applianceType: device.applianceType,
    applianceLabel: APPLIANCES[device.applianceType]?.label || device.applianceType,
    model: device.model,
    purchaseDate: device.purchaseDate,
    hasInvoice: !!device.hasInvoice,
    purchaseVerifiedManually: !!device.purchaseVerifiedManually,
    customer: device.customer || null,
    note: device.note || null,
    soldBy: dealer ? { id: dealer.id, name: dealer.name } : null,
    warranty: {
      status: warranty.status,
      statusLabel: warranty.statusLabel,
      baseWholeEnd: warranty.baseWholeEnd,
      baseSystemEnd: warranty.baseSystemEnd,
      extension: warranty.extension,
      coverageEnd: warranty.coverageEnd,
      daysRemaining: warranty.daysRemaining,
      expiringSoon: warranty.expiringSoon
    },
    pendingReview: reviews.find((r) => r.status === 'pending')
      ? { id: reviews.find((r) => r.status === 'pending').id, status: 'pending' }
      : null
  };
}

function reviewView(r, detail = false) {
  const device = r.deviceId ? getDevice(r.deviceId) : null;
  const out = {
    id: r.id,
    serial: r.serial,
    customerName: r.customerName,
    contact: r.contact,
    region: r.region,
    reason: r.reason,
    evidenceImage: r.evidenceImage,
    status: r.status,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    adminNote: r.adminNote,
    verifiedPurchaseDate: r.verifiedPurchaseDate,
    deviceFound: !!device,
    device: device ? {
      id: device.id,
      brand: device.brand,
      brandLabel: BRANDS[device.brand] || device.brand,
      applianceType: device.applianceType,
      applianceLabel: APPLIANCES[device.applianceType]?.label || device.applianceType,
      model: device.model,
      soldByDealerId: device.soldByDealerId
    } : null
  };
  if (!detail) delete out.reason;
  return out;
}

// ---------- 业务处理 ----------
const SERIAL_RE = /^[A-Z]{2}-[0-9]{4}[A-Z]{2}-[0-9]{6}$/;

async function handlePublicLookup(req, res) {
  const body = await readBody(req);
  const serial = normalizeSerial(body.serial);
  if (!serial || serial.length < 6) {
    return fail(res, 400, 'invalid_serial', '请输入有效的设备序列号');
  }
  const device = findDeviceBySerial(serial);
  if (!device) {
    return ok(res, {
      found: false,
      serial,
      hint: '品牌库未查询到该序列号。若您确认设备为正规渠道购买，可提交人工审核。'
    });
  }
  ok(res, { found: true, device: publicDeviceView(device, String(body.region || '')) });
}

async function handlePublicSubmitReview(req, res) {
  const body = await readBody(req);
  const serial = normalizeSerial(body.serial);
  if (!SERIAL_RE.test(serial)) {
    return fail(res, 400, 'invalid_serial',
      '序列号格式应为 XX-YYYYXX-NNNNNN（如 HL-2025FR-100231）');
  }
  const customerName = String(body.customerName || '').trim().slice(0, 40);
  const contact = String(body.contact || '').trim().slice(0, 40);
  const region = String(body.region || '').trim().slice(0, 40);
  const reason = String(body.reason || '').trim().slice(0, 1000);
  const evidenceImage = body.evidenceImage ? String(body.evidenceImage).trim().slice(0, 120) : null;

  if (customerName.length < 2) return fail(res, 400, 'invalid_name', '请填写联系人姓名');
  if (!/^[0-9+\-\s]{6,20}$/.test(contact)) {
    return fail(res, 400, 'invalid_contact', '请填写有效的联系电话');
  }
  if (reason.length < 10) {
    return fail(res, 400, 'invalid_reason', '请至少用 10 个字说明购买与发票情况');
  }

  const device = findDeviceBySerial(serial);

  // 同一序列号 + 同一电话存在待审核工单时不允许重复提交
  const dup = listReviews().find((r) =>
    r.serial === serial && r.contact === contact && r.status === 'pending');
  if (dup) {
    return fail(res, 409, 'duplicate_review', '该序列号已有进行中的人工审核，请耐心等待', {
      reviewId: dup.id
    });
  }

  const review = {
    id: `rv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    deviceId: device ? device.id : null,
    serial,
    customerName,
    contact,
    region,
    reason,
    evidenceImage,
    status: 'pending',
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    reviewedBy: null,
    adminNote: null,
    verifiedPurchaseDate: null
  };
  await addReview(review);
  ok(res, {
    reviewId: review.id,
    deviceFound: !!device,
    status: 'pending',
    message: '人工审核申请已提交，预计 1-3 个工作日内处理'
  });
}

async function handlePublicReviewStatus(req, res, id) {
  const review = getReview(id);
  if (!review) return fail(res, 404, 'not_found', '审核工单不存在');
  // 工单编号为随机生成，持有者凭编号查询（不暴露他人电话明细）
  const view = reviewView(review, true);
  delete view.contact;
  delete view.customerName;
  ok(res, { review: view });
}

async function handleLogin(req, res, expectedRole) {
  const body = await readBody(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return fail(res, 400, 'invalid_input', '请输入账号和密码');

  const user = findUserByUsername(username);
  if (!user || user.role !== expectedRole || !verifyPassword(password, user.password)) {
    return fail(res, 401, 'bad_credentials', '账号或密码错误');
  }
  const token = newToken();
  await createSession({
    token,
    userId: user.id,
    role: user.role,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 12 * 3600 * 1000).toISOString()
  });
  ok(res, {
    token,
    user: {
      id: user.id,
      role: user.role,
      name: user.name,
      brand: user.brand,
      dealerId: user.dealerId
    }
  });
}

async function handleLogout(req, res) {
  const token = getToken(req);
  if (token) await deleteSession(token);
  ok(res, { loggedOut: true });
}

async function handleMe(req, res) {
  const user = authenticate(req);
  if (!user) return fail(res, 401, 'unauthorized', '未登录');
  ok(res, {
    user: { id: user.id, role: user.role, name: user.name, brand: user.brand, dealerId: user.dealerId }
  });
}

async function handleDealerDevices(req, res, url) {
  const user = requireAuth(req, res, 'dealer');
  if (!user) return;
  const items = listDevices(user, {
    brand: url.searchParams.get('brand') || undefined,
    applianceType: url.searchParams.get('type') || undefined,
    q: url.searchParams.get('q') || undefined
  });
  const views = items.map(dealerDeviceView)
    // 保修状态过滤（在领域计算之后过滤，避免与库内冗余字段不一致）
    .filter((d) => !url.searchParams.get('status') || d.warranty.status === url.searchParams.get('status'));
  ok(res, {
    dealer: { id: user.dealerId, name: user.name, brand: user.brand },
    total: views.length,
    devices: views
  });
}

async function handleDealerDeviceDetail(req, res, id) {
  const user = requireAuth(req, res, 'dealer');
  if (!user) return;
  const device = getDevice(id);
  if (!device || device.soldByDealerId !== user.dealerId) {
    // 越权访问与"不存在"统一返回 404，避免探测其他品牌设备是否存在
    return fail(res, 404, 'not_found', '设备不存在或不属于您的门店');
  }
  ok(res, { device: dealerDeviceView(device), reviews: listReviewsForDevice(device.id).map((r) => reviewView(r)) });
}

async function handleAdminReviews(req, res, url) {
  const user = requireAuth(req, res, 'admin');
  if (!user) return;
  const status = url.searchParams.get('status');
  let items = listReviews();
  if (status) items = items.filter((r) => r.status === status);
  ok(res, { reviews: items.map((r) => reviewView(r, true)) });
}

async function resolveReview(req, res, id, decision) {
  const user = requireAuth(req, res, 'admin');
  if (!user) return;
  const body = await readBody(req);
  const review = getReview(id);
  if (!review) return fail(res, 404, 'not_found', '审核工单不存在');
  if (review.status !== 'pending') {
    return fail(res, 409, 'already_resolved', `该工单已${review.status === 'approved' ? '通过' : '驳回'}`);
  }
  const adminNote = String(body.adminNote || '').trim().slice(0, 1000);
  const verifiedPurchaseDate = String(body.verifiedPurchaseDate || '').trim();

  if (decision === 'approved') {
    if (!isValidDate(verifiedPurchaseDate)) {
      return fail(res, 400, 'invalid_date', '通过审核需填写经核实的购买日期（YYYY-MM-DD）');
    }
    if (new Date(verifiedPurchaseDate) > todayUTC()) {
      return fail(res, 400, 'future_date', '购买日期不能晚于今天');
    }
    const device = review.deviceId ? getDevice(review.deviceId) : null;
    if (device) {
      await updateDevice(device.id, {
        purchaseDate: verifiedPurchaseDate,
        purchaseVerifiedManually: true
      });
    }
    await updateReview(review.id, {
      status: 'approved',
      resolvedAt: new Date().toISOString(),
      reviewedBy: user.id,
      adminNote: adminNote || '材料真实有效，购买日期予以认定',
      verifiedPurchaseDate
    });
  } else {
    if (adminNote.length < 4) {
      return fail(res, 400, 'invalid_note', '驳回时必须填写原因说明');
    }
    await updateReview(review.id, {
      status: 'rejected',
      resolvedAt: new Date().toISOString(),
      reviewedBy: user.id,
      adminNote
    });
  }
  ok(res, { review: reviewView(getReview(id), true) });
}

// ---------- 静态资源 ----------
async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  // 防目录穿越
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    });
    res.end(data);
  } catch {
    // SPA 回退到首页（前端路由只有单页，直接返回 index）
    try {
      const index = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(index);
    } catch {
      res.writeHead(404); res.end('Not found');
    }
  }
}

// ---------- 路由 ----------
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  const method = req.method;
  try {
    // 公开
    if (p === '/api/public/lookup' && method === 'POST') return await handlePublicLookup(req, res);
    if (p === '/api/public/reviews' && method === 'POST') return await handlePublicSubmitReview(req, res);
    const reviewStatusMatch = /^\/api\/public\/reviews\/([A-Za-z0-9-]+)$/.exec(p);
    if (reviewStatusMatch && method === 'GET') {
      return await handlePublicReviewStatus(req, res, reviewStatusMatch[1]);
    }
    // 认证
    if (p === '/api/auth/login/dealer' && method === 'POST') return await handleLogin(req, res, 'dealer');
    if (p === '/api/auth/login/admin' && method === 'POST') return await handleLogin(req, res, 'admin');
    if (p === '/api/auth/logout' && method === 'POST') return await handleLogout(req, res);
    if (p === '/api/auth/me' && method === 'GET') return await handleMe(req, res);
    // 经销商
    if (p === '/api/dealer/devices' && method === 'GET') return await handleDealerDevices(req, res, url);
    const dealerDevMatch = /^\/api\/dealer\/devices\/([A-Za-z0-9-]+)$/.exec(p);
    if (dealerDevMatch && method === 'GET') return await handleDealerDeviceDetail(req, res, dealerDevMatch[1]);
    // 管理员
    if (p === '/api/admin/reviews' && method === 'GET') return await handleAdminReviews(req, res, url);
    const approveMatch = /^\/api\/admin\/reviews\/([A-Za-z0-9-]+)\/approve$/.exec(p);
    if (approveMatch && method === 'POST') return await resolveReview(req, res, approveMatch[1], 'approved');
    const rejectMatch = /^\/api\/admin\/reviews\/([A-Za-z0-9-]+)\/reject$/.exec(p);
    if (rejectMatch && method === 'POST') return await resolveReview(req, res, rejectMatch[1], 'rejected');
    // 元数据（前端下拉框）
    if (p === '/api/meta' && method === 'GET') {
      return ok(res, { appliances: APPLIANCES, brands: BRANDS, extPlans: EXT_PLANS });
    }
    if (p.startsWith('/api/')) return fail(res, 404, 'not_found', '接口不存在');
    return await serveStatic(req, res, url);
  } catch (err) {
    if (err.message === 'invalid JSON') return fail(res, 400, 'bad_request', '请求体不是合法 JSON');
    if (err.message === 'payload too large') return fail(res, 413, 'too_large', '请求内容过大');
    console.error('[server error]', err);
    if (!res.headersSent) fail(res, 500, 'internal', '服务器内部错误');
  }
});

await initStore();
server.listen(PORT, () => {
  console.log(`家电延保序列号门户已启动: http://localhost:${PORT}`);
  console.log(`演示账号 — 管理员: admin/admin123 | 经销商: dealer01/dealer123 (海尔)、dealer02 (美的)、dealer03 (格力)`);
});
