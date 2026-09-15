// JSON 文件持久化；首次启动写入演示种子数据
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR
  ? (process.env.DATA_DIR.startsWith('/') ? process.env.DATA_DIR : join(__dirname, '..', process.env.DATA_DIR))
  : join(__dirname, '..', 'data');
const DB_FILE = join(DATA_DIR, 'db.json');

let db = null;
let writeChain = Promise.resolve();

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function seed() {
  const now = new Date().toISOString();
  return {
    meta: { version: 1, createdAt: now },
    users: [
      { id: 'admin-01', role: 'admin', username: 'admin', password: hashPassword('admin123'),
        name: '平台管理员', brand: null, dealerId: null },
      { id: 'dealer-haier', role: 'dealer', username: 'dealer01', password: hashPassword('dealer123'),
        name: '海尔青岛旗舰店', brand: 'haier', dealerId: 'dealer-haier' },
      { id: 'dealer-midea', role: 'dealer', username: 'dealer02', password: hashPassword('dealer123'),
        name: '美的广州天河店', brand: 'midea', dealerId: 'dealer-midea' },
      { id: 'dealer-gree', role: 'dealer', username: 'dealer03', password: hashPassword('dealer123'),
        name: '格力成都武侯店', brand: 'gree', dealerId: 'dealer-gree' }
    ],
    dealers: [
      { id: 'dealer-haier', name: '海尔青岛旗舰店', brand: 'haier',
        address: '青岛市市北区台东一路 12 号', phone: '0532-83000001' },
      { id: 'dealer-midea', name: '美的广州天河店', brand: 'midea',
        address: '广州市天河区天河路 208 号', phone: '020-38880002' },
      { id: 'dealer-gree', name: '格力成都武侯店', brand: 'gree',
        address: '成都市武侯区一环路南三段 66 号', phone: '028-85000003' }
    ],
    devices: [
      { id: 'dev-1001', serial: 'HL-2025FR-100231', brand: 'haier', applianceType: 'fridge',
        model: 'BCD-470WGHTD', purchaseDate: '2025-12-18', invoiceNo: 'INV-HL-20251218-77',
        hasInvoice: true, invoiceImage: null, purchaseVerifiedManually: false,
        soldByDealerId: 'dealer-haier',
        extension: null, customer: { name: '李建国', phone: '13900112233' },
        createdAt: now },
      { id: 'dev-1002', serial: 'HL-2024WA-100874', brand: 'haier', applianceType: 'washer',
        model: 'EG100MATE5S', purchaseDate: '2024-11-02', invoiceNo: 'INV-HL-20241102-12',
        hasInvoice: true, invoiceImage: null, purchaseVerifiedManually: false,
        soldByDealerId: 'dealer-haier',
        extension: { planId: 'haier-plus-12', planName: '海尔安心保 1 年', months: 12,
          coverage: '整机+核心部件', purchasedAt: '2024-11-05' },
        customer: { name: '王芳', phone: '13800223344' }, createdAt: now },
      { id: 'dev-1003', serial: 'HL-2023AC-101590', brand: 'haier', applianceType: 'ac',
        model: 'KFR-35GW/81@U1-Ge', purchaseDate: '2023-03-25', invoiceNo: 'INV-HL-20230325-05',
        hasInvoice: true, invoiceImage: null, purchaseVerifiedManually: false,
        soldByDealerId: 'dealer-haier',
        extension: null, customer: { name: '赵磊', phone: '13700334455' }, createdAt: now },
      { id: 'dev-1004', serial: 'HL-2025FR-100562', brand: 'haier', applianceType: 'fridge',
        model: 'BCD-510WGHFD', purchaseDate: '2025-10-10', invoiceNo: 'INV-HL-20251010-33',
        hasInvoice: true, invoiceImage: null, purchaseVerifiedManually: false,
        soldByDealerId: 'dealer-haier',
        extension: null, customer: { name: '陈静', phone: '13600445566' }, createdAt: now },
      { id: 'dev-1005', serial: 'MD-2025FR-200455', brand: 'midea', applianceType: 'fridge',
        model: 'BCD-508WTPZM(E)', purchaseDate: null, invoiceNo: null,
        hasInvoice: false, invoiceImage: null, purchaseVerifiedManually: false,
        soldByDealerId: 'dealer-midea',
        extension: null, customer: { name: '周敏', phone: '13800001111' },
        note: '门店样机转售，发票补开中', createdAt: now },
      { id: 'dev-1006', serial: 'MD-2024WA-200312', brand: 'midea', applianceType: 'washer',
        model: 'MG100V33WY', purchaseDate: '2024-08-10', invoiceNo: 'INV-MD-20240810-21',
        hasInvoice: true, invoiceImage: null, purchaseVerifiedManually: false,
        soldByDealerId: 'dealer-midea',
        extension: { planId: 'midea-plus-24', planName: '美的延享保 2 年', months: 24,
          coverage: '整机+核心部件', purchasedAt: '2024-08-12' },
        customer: { name: '黄强', phone: '13500556677' }, createdAt: now },
      { id: 'dev-1007', serial: 'MD-2024AC-200780', brand: 'midea', applianceType: 'ac',
        model: 'KFR-26GW/BP3DN8Y', purchaseDate: '2024-05-16', invoiceNo: null,
        hasInvoice: false, invoiceImage: null, purchaseVerifiedManually: true,
        soldByDealerId: 'dealer-midea',
        extension: null, customer: { name: '吴琳', phone: '13400667788' },
        note: '发票遗失，购买日期经人工审核采信', createdAt: now },
      { id: 'dev-1008', serial: 'GR-2025AC-300768', brand: 'gree', applianceType: 'ac',
        model: 'KFR-26GW/NhGc1B', purchaseDate: '2026-07-20', invoiceNo: 'INV-GR-20260720-08',
        hasInvoice: true, invoiceImage: null, purchaseVerifiedManually: false,
        soldByDealerId: 'dealer-gree',
        extension: null, customer: { name: '孙浩', phone: '13300778899' }, createdAt: now }
    ],
    outlets: [
      { id: 'svc-hl-01', name: '海尔星级服务中心（市北店）', brands: ['haier'],
        applianceTypes: ['fridge', 'washer', 'ac'], region: '青岛',
        address: '青岛市市北区辽宁路 88 号', phone: '0532-85661234',
        hours: '周一至周日 08:30-18:00', authorized: true },
      { id: 'svc-hl-02', name: '海尔授权服务站（济南历下）', brands: ['haier'],
        applianceTypes: ['fridge', 'ac'], region: '济南',
        address: '济南市历下区解放路 121 号', phone: '0531-81772233',
        hours: '周一至周六 09:00-17:30', authorized: true },
      { id: 'svc-md-01', name: '美的客户服务中心（天河店）', brands: ['midea'],
        applianceTypes: ['fridge', 'washer', 'ac'], region: '广州',
        address: '广州市天河区黄埔大道西 100 号', phone: '020-85994411',
        hours: '周一至周日 08:00-19:00', authorized: true },
      { id: 'svc-md-02', name: '美的售后网点（深圳南山）', brands: ['midea'],
        applianceTypes: ['washer', 'ac'], region: '深圳',
        address: '深圳市南山区南山大道 1108 号', phone: '0755-26663322',
        hours: '周一至周日 09:00-18:00', authorized: true },
      { id: 'svc-md-03', name: '社区快修·番禺店', brands: ['midea'],
        applianceTypes: ['fridge', 'washer'], region: '广州',
        address: '广州市番禺区市桥街大北路 27 号', phone: '020-34991122',
        hours: '周一至周日 10:00-20:00', authorized: false },
      { id: 'svc-gr-01', name: '格力电器售后服务中心（武侯店）', brands: ['gree'],
        applianceTypes: ['ac', 'fridge'], region: '成都',
        address: '成都市武侯区武侯祠大街 18 号', phone: '028-85556677',
        hours: '周一至周日 08:30-18:00', authorized: true },
      { id: 'svc-gr-02', name: '格力授权服务站（重庆渝中）', brands: ['gree'],
        applianceTypes: ['ac'], region: '重庆',
        address: '重庆市渝中区中山三路 156 号', phone: '023-63882211',
        hours: '周一至周六 09:00-17:30', authorized: true },
      { id: 'svc-ind-01', name: '全国家电联保服务点（武汉洪山）', brands: ['haier', 'midea', 'gree'],
        applianceTypes: ['fridge', 'washer', 'ac'], region: '武汉',
        address: '武汉市洪山区珞喻路 456 号', phone: '027-87660099',
        hours: '周一至周日 09:00-18:00', authorized: false }
    ],
    reviews: [
      { id: 'rv-20260910-01', deviceId: 'dev-1005', serial: 'MD-2025FR-200455',
        customerName: '周敏', contact: '13800001111', region: '广州',
        reason: '发票遗失，购买日期无法确认；门店记录为 2025 年 12 月样机转售',
        evidenceImage: 'evidence-zhoumin.jpg', status: 'pending',
        createdAt: '2026-09-10T02:14:00.000Z', resolvedAt: null, reviewedBy: null,
        adminNote: null, verifiedPurchaseDate: null },
      { id: 'rv-20260901-02', deviceId: null, serial: 'XX-9999XX-000000',
        customerName: '未知', contact: '13000009999', region: '',
        reason: '序列号在品牌库中查不到，也无任何购买凭证，尝试申请保修',
        evidenceImage: null, status: 'rejected',
        createdAt: '2026-09-01T06:30:00.000Z', resolvedAt: '2026-09-03T01:00:00.000Z',
        reviewedBy: 'admin-01', adminNote: '无法在品牌库核验到该序列号，且无购买凭证，不予认定',
        verifiedPurchaseDate: null },
      { id: 'rv-20260820-03', deviceId: 'dev-1007', serial: 'MD-2024AC-200780',
        customerName: '吴琳', contact: '13400667788', region: '深圳',
        reason: '发票丢失，提供了购机时的送货单照片与付款记录',
        evidenceImage: 'evidence-wulin.jpg', status: 'approved',
        createdAt: '2026-08-20T09:45:00.000Z', resolvedAt: '2026-08-22T03:20:00.000Z',
        reviewedBy: 'admin-01', adminNote: '送货单与付款记录可相互印证，采信购买日期 2024-05-16',
        verifiedPurchaseDate: '2024-05-16' }
    ],
    sessions: []
  };
}

export async function initStore() {
  if (db) return db;
  if (await fileExists(DB_FILE)) {
    db = JSON.parse(await readFile(DB_FILE, 'utf8'));
  } else {
    db = await seed();
    await persist();
  }
  return db;
}

function persist() {
  const snapshot = JSON.stringify(db, null, 2);
  writeChain = writeChain.then(async () => {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(DB_FILE, snapshot, 'utf8');
  });
  return writeChain;
}

export function getDB() {
  if (!db) throw new Error('store not initialized');
  return db;
}

export { persist as save };

// ---------- 查询 ----------
export function normalizeSerial(serial) {
  return String(serial || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function findDeviceBySerial(serial) {
  const s = normalizeSerial(serial);
  return getDB().devices.find((d) => d.serial === s) || null;
}

export function getDevice(id) {
  return getDB().devices.find((d) => d.id === id) || null;
}

export function getDealer(id) {
  return getDB().dealers.find((d) => d.id === id) || null;
}

export function findUserByUsername(username) {
  return getDB().users.find((u) => u.username === String(username).trim()) || null;
}

export function getUser(id) {
  return getDB().users.find((u) => u.id === id) || null;
}

export function createSession(session) {
  getDB().sessions.push(session);
  return persist().then(() => session);
}

export function getSession(token) {
  return getDB().sessions.find((s) => s.token === token) || null;
}

export function deleteSession(token) {
  const all = getDB().sessions;
  const idx = all.findIndex((s) => s.token === token);
  if (idx >= 0) all.splice(idx, 1);
  return persist();
}

export function addReview(review) {
  getDB().reviews.push(review);
  return persist().then(() => review);
}

export function getReview(id) {
  return getDB().reviews.find((r) => r.id === id) || null;
}

export function listReviews() {
  return [...getDB().reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function listReviewsForDevice(deviceId) {
  return getDB().reviews
    .filter((r) => r.deviceId === deviceId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 设备列表（经销商门户用）
 * @param {object} viewer 当前登录用户
 */
export function listDevices(viewer, { brand, applianceType, status, q } = {}) {
  let items = [...getDB().devices];
  // 经销商数据隔离：只能看自己门店卖出的设备（天然限定单一品牌）
  if (viewer.role === 'dealer') {
    items = items.filter((d) => d.soldByDealerId === viewer.dealerId);
  }
  if (brand) items = items.filter((d) => d.brand === brand);
  if (applianceType) items = items.filter((d) => d.applianceType === applianceType);
  if (q) {
    const key = normalizeSerial(q);
    items = items.filter((d) => d.serial.includes(key));
  }
  return items;
}

export function updateReview(id, patch) {
  const r = getReview(id);
  if (!r) return null;
  Object.assign(r, patch);
  return persist().then(() => r);
}

export function updateDevice(id, patch) {
  const d = getDevice(id);
  if (!d) return null;
  Object.assign(d, patch);
  return persist().then(() => d);
}

export function listOutlets() {
  return getDB().outlets;
}
