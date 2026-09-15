// 端到端冒烟测试：启动服务 -> 验证查询/审核/经销商隔离/管理员审批
import { spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://127.0.0.1:3100';
let failures = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); }
  else { failures++; console.error(`  ❌ ${msg}`); }
}

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const json = await res.json();
  return { status: res.status, ...json };
}

// 启动被测服务（使用独立端口和临时数据文件）
const TMP_DATA = await mkdtemp(join(tmpdir(), 'wp-smoke-'));
const srv = spawn(process.execPath, ['server.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: '3100', DATA_DIR: TMP_DATA },
  stdio: ['ignore', 'pipe', 'inherit']
});
srv.stdout.on('data', (d) => process.env.DEBUG ? process.stdout.write(d) : null);

try {
  // 等待启动
  for (let i = 0; i < 30; i++) {
    try { await fetch(BASE + '/api/meta'); break; } catch { await sleep(100); }
  }

  console.log('\n[1] 公开查询：保修中设备');
  let r = await req('/api/public/lookup', { method: 'POST', body: { serial: 'HL-2025FR-100231', region: '青岛' } });
  assert(r.ok && r.data.found, '找到设备');
  assert(r.data.device.warranty.status === 'active', '状态为基础保修中');
  assert(r.data.device.warranty.baseWholeEnd === '2026-12-18', `整机保修至 2026-12-18（实际 ${r.data.device?.warranty?.baseWholeEnd}）`);
  assert(r.data.device.outlets[0]?.inRegion && r.data.device.outlets[0].region === '青岛', '同城青岛网点排首位');
  assert(r.data.device.soldBy?.name === '海尔青岛旗舰店', '展示售出门店名称');
  assert(!JSON.stringify(r.data.device).includes('13900112233'), '公开结果不泄露客户电话');

  console.log('\n[2] 公开查询：延保中设备（洗衣机整机基础保到期后进入延保）');
  r = await req('/api/public/lookup', { method: 'POST', body: { serial: 'HL-2024WA-100874' } });
  assert(r.data.device.warranty.extension, '返回延保信息');
  assert(r.data.device.warranty.extension.end === '2026-11-02', `延保至 2026-11-02（实际 ${r.data.device?.warranty?.extension?.end}）`);
  assert(['extended', 'active'].includes(r.data.device.warranty.status), '状态为延保中/基础保修中');

  console.log('\n[3] 公开查询：已过保设备');
  r = await req('/api/public/lookup', { method: 'POST', body: { serial: 'HL-2023AC-101590' } });
  assert(r.data.device.warranty.status === 'expired', '空调整机已过保');

  console.log('\n[4] 公开查询：临期设备（30 天内到期）');
  r = await req('/api/public/lookup', { method: 'POST', body: { serial: 'HL-2025FR-100562' } });
  assert(r.data.device.warranty.expiringSoon === true, '标记为即将到期');

  console.log('\n[5] 公开查询：购买日期缺失 -> unknown + 可审核');
  r = await req('/api/public/lookup', { method: 'POST', body: { serial: 'MD-2025FR-200455' } });
  assert(r.data.device.warranty.status === 'unknown', '状态为购买日期待核实');
  assert(r.data.device.review?.status === 'pending', '展示既有待审核工单');

  console.log('\n[6] 未知序列号 -> found=false');
  r = await req('/api/public/lookup', { method: 'POST', body: { serial: 'XX-2020FR-000001' } });
  assert(r.ok && r.data.found === false, '返回未找到而非报错');

  console.log('\n[7] 提交人工审核（含校验）');
  r = await req('/api/public/reviews', { method: 'POST',
    body: { serial: 'md-2025fr-200455', customerName: '周敏', contact: '13800001111', reason: '发票遗失，只有付款记录，申请核实购买日期' } });
  assert(r.status === 409 && r.error.code === 'duplicate_review', '同序列号+电话重复提交被拒绝');
  r = await req('/api/public/reviews', { method: 'POST',
    body: { serial: 'XX-2020FR-000001', customerName: '陈测试', contact: '13922223333', region: '武汉',
      reason: '二手购入无发票，附付款截图申请人工核验保修资格' } });
  assert(r.ok && r.data.status === 'pending' && r.data.deviceFound === false, '未知序列号也可提交审核');
  const newReviewId = r.data.reviewId;

  console.log('\n[8] 审核进度公开查询（不暴露姓名电话）');
  r = await req(`/api/public/reviews/${newReviewId}`);
  assert(r.ok && r.data.review.status === 'pending', '可凭工单编号查询');
  assert(!('contact' in r.data.review) && !('customerName' in r.data.review), '不返回申请人隐私字段');

  console.log('\n[9] 经销商登录 + 门店数据隔离');
  r = await req('/api/auth/login/dealer', { method: 'POST', body: { username: 'dealer01', password: 'wrong' } });
  assert(r.status === 401, '错误密码被拒绝');
  r = await req('/api/auth/login/dealer', { method: 'POST', body: { username: 'dealer01', password: 'dealer123' } });
  assert(r.ok, '海尔经销商登录成功');
  const dealerToken = r.data.token;
  assert(r.data.user.brand === 'haier', '登录后返回所属品牌 haier');

  r = await req('/api/dealer/devices', { token: dealerToken });
  assert(r.data.devices.every((d) => d.brand === 'haier'), '只能看到海尔设备');
  assert(r.data.devices.every((d) => d.soldBy.id === 'dealer-haier'), '只能看到本门店卖出的设备');
  assert(r.data.total === 4, `海尔门店共 4 台（实际 ${r.data.total}）`);
  assert(!r.data.devices.some((d) => d.serial === 'MD-2025FR-200455'), '看不到美的设备');

  // 直接猜测其他门店设备 ID 也必须拒绝
  r = await req('/api/dealer/devices/dev-1005', { token: dealerToken });
  assert(r.status === 404, '越权访问美的设备 ID 返回 404');

  // 无 token
  r = await req('/api/dealer/devices');
  assert(r.status === 401, '未登录不可访问经销商接口');

  console.log('\n[10] 经销商令牌无法访问管理员接口（角色隔离）');
  r = await req('/api/admin/reviews', { token: dealerToken });
  assert(r.status === 403, '经销商不能访问审核后台');

  console.log('\n[11] 管理员登录并审批工单');
  r = await req('/api/auth/login/admin', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  assert(r.ok, '管理员登录成功');
  const adminToken = r.data.token;

  r = await req('/api/admin/reviews?status=pending', { token: adminToken });
  const pending = r.data.reviews;
  const zhoumin = pending.find((x) => x.serial === 'MD-2025FR-200455');
  assert(!!zhoumin, '待审核列表包含周敏工单');
  assert(zhoumin.deviceFound && zhoumin.device.brand === 'midea', '工单匹配到美的设备');

  // 管理员可跨品牌看到所有品牌工单
  const all = await req('/api/admin/reviews', { token: adminToken });
  assert(new Set(all.data.reviews.map((x) => x.serial)).size >= 3, '管理员可见全部工单');

  // 通过审核必须带购买日期
  r = await req(`/api/admin/reviews/${zhoumin.id}/approve`, { method: 'POST', token: adminToken, body: {} });
  assert(r.status === 400, '缺少购买日期时拒绝通过');

  r = await req(`/api/admin/reviews/${zhoumin.id}/approve`, {
    method: 'POST', token: adminToken,
    body: { verifiedPurchaseDate: '2025-12-10', adminNote: '门店系统记录与付款时间一致，采信' }
  });
  assert(r.ok && r.data.review.status === 'approved', '审核通过');

  // 设备保修按核定日期重算
  r = await req('/api/public/lookup', { method: 'POST', body: { serial: 'MD-2025FR-200455' } });
  assert(r.data.device.purchaseDate === '2025-12-10', '购买日期已写回设备档案');
  assert(r.data.device.purchaseVerifiedManually === true, '标记为人工核定');
  assert(r.data.device.warranty.status === 'active', '核定后状态变为保修中');
  assert(r.data.device.warranty.baseWholeEnd === '2026-12-10', `保修至 2026-12-10（实际 ${r.data.device.warranty.baseWholeEnd}）`);

  // 已处理工单不能重复审批
  r = await req(`/api/admin/reviews/${zhoumin.id}/reject`, { method: 'POST', token: adminToken, body: { adminNote: '重复操作' } });
  assert(r.status === 409, '已处理工单不能重复操作');

  // 驳回新工单需要原因
  r = await req(`/api/admin/reviews/${newReviewId}/reject`, { method: 'POST', token: adminToken, body: { adminNote: '理由' } });
  assert(r.status === 400, '驳回原因过短被拒绝（至少 4 字）');
  r = await req(`/api/admin/reviews/${newReviewId}/reject`, {
    method: 'POST', token: adminToken,
    body: { adminNote: '无法在品牌库核验，且付款记录无法证明购买日期' }
  });
  assert(r.ok && r.data.review.status === 'rejected', '驳回成功');

  console.log('\n[12] 静态页面与 SPA 回退');
  r = await fetch(BASE + '/');
  assert(r.status === 200, '首页 200');
  r = await fetch(BASE + '/app.js');
  assert(r.status === 200, '前端 JS 200');
  // 目录穿越需发送原始路径（fetch 会自动规范化 URL）
  const raw = await new Promise((resolve) => {
    const req2 = httpRequest(BASE, { method: 'GET', path: '/../server.js' }, (res2) => {
      let body = '';
      res2.on('data', (c) => (body += c));
      res2.on('end', () => resolve({ status: res2.statusCode, body }));
    });
    req2.end();
  });
  assert(raw.status === 403 || !raw.body.includes('createServer'), '目录穿越被拦截');

} catch (err) {
  failures++;
  console.error('测试异常:', err);
} finally {
  srv.kill('SIGTERM');
  await new Promise((resolve) => srv.on('exit', resolve));
  await rm(TMP_DATA, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n🎉 全部冒烟测试通过\n' : `\n💥 ${failures} 项测试失败\n`);
process.exit(failures === 0 ? 0 : 1);
