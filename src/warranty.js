// 保修领域逻辑：购买日期 -> 基础保/延保状态；维修网点匹配
import { parseDate, addMonths, diffDays, todayUTC } from './dates.js';

export const APPLIANCES = {
  fridge: { label: '冰箱', systemLabel: '压缩机/制冷系统' },
  washer: { label: '洗衣机', systemLabel: '电机/驱动系统' },
  ac: { label: '空调', systemLabel: '压缩机' }
};

export const BRANDS = {
  haier: '海尔',
  midea: '美的',
  gree: '格力'
};

// 基础保修（月）：整机 + 核心部件
export const BASE_WARRANTY = {
  fridge: { whole: 12, system: 36 },
  washer: { whole: 12, system: 36 },
  ac: { whole: 36, system: 60 } // 空调整机保修通常更长
};

// 各品牌可售延保套餐
export const EXT_PLANS = {
  haier: [{ id: 'haier-plus-12', name: '海尔安心保 1 年', months: 12, coverage: '整机+核心部件' }],
  midea: [{ id: 'midea-plus-24', name: '美的延享保 2 年', months: 24, coverage: '整机+核心部件' }],
  gree: [{ id: 'gree-plus-12', name: '格力无忧保 1 年', months: 12, coverage: '整机+核心部件' }]
};

/**
 * 计算设备保修视图
 * @param {object} device 设备记录
 * @param {Date} [now] 当前日期（UTC 00:00），默认今天
 */
export function deriveWarranty(device, now = todayUTC()) {
  const base = BASE_WARRANTY[device.applianceType] ?? { whole: 12, system: 36 };
  const purchaseDate = device.purchaseDate ? parseDate(device.purchaseDate) : null;

  if (!purchaseDate) {
    // 无有效购买日期：无法起算，转人工
    return {
      status: 'unknown',
      statusLabel: '购买日期待核实',
      purchaseVerified: false,
      baseWholeEnd: null,
      baseSystemEnd: null,
      extension: null,
      coverageEnd: null,
      daysRemaining: null,
      expiringSoon: false
    };
  }

  const baseWholeEnd = addMonths(purchaseDate, base.whole);
  const baseSystemEnd = addMonths(purchaseDate, base.system);

  let extension = null;
  if (device.extension && device.extension.months > 0) {
    // 延保自整机基础保结束日次日起算（到期日 = 基础保到期 + N 月）
    const end = addMonths(baseWholeEnd, device.extension.months);
    extension = {
      planId: device.extension.planId,
      planName: device.extension.planName,
      months: device.extension.months,
      coverage: device.extension.coverage,
      start: baseWholeEnd.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      endDate: end
    };
  }

  // 总保障截止日：有延保按延保，否则按整机基础保
  const coverageEnd = extension ? extension.endDate : baseWholeEnd;
  const remaining = diffDays(now, coverageEnd);

  let status;
  let statusLabel;
  if (remaining < 0) {
    status = 'expired';
    statusLabel = '已过保';
  } else if (extension && now.getTime() > baseWholeEnd.getTime()) {
    // 已超出整机基础保、在延保期内
    status = 'extended';
    statusLabel = '延保中';
  } else if (remaining === 0) {
    status = 'active';
    statusLabel = '保修中（今日到期）';
  } else {
    status = 'active';
    statusLabel = extension && now.getTime() <= extension.endDate.getTime()
      ? '基础保修中（已购延保）'
      : '基础保修中';
  }

  return {
    status,
    statusLabel,
    purchaseVerified: true,
    baseWholeEnd: baseWholeEnd.toISOString().slice(0, 10),
    baseSystemEnd: baseSystemEnd.toISOString().slice(0, 10),
    systemCovered: now.getTime() <= baseSystemEnd.getTime(),
    extension: extension
      ? { planName: extension.planName, months: extension.months, coverage: extension.coverage,
          start: extension.start, end: extension.end }
      : null,
    coverageEnd: coverageEnd.toISOString().slice(0, 10),
    daysRemaining: Math.max(remaining, 0),
    expiringSoon: remaining >= 0 && remaining <= 30
  };
}

/**
 * 匹配维修网点：品牌授权 + 支持该品类 + 同区域优先
 * @param {Array} outlets 网点列表
 * @param {object} device 设备记录
 * @param {string} [region] 用户所在区域（城市/区县关键词）
 */
export function matchOutlets(outlets, device, region = '') {
  const regionKey = String(region || '').trim();
  return outlets
    .filter((o) => o.brands.includes(device.brand) && o.applianceTypes.includes(device.applianceType))
    .map((o) => {
      const inRegion = !!regionKey && (o.region.includes(regionKey) || regionKey.includes(o.region));
      return { outlet: o, inRegion };
    })
    .sort((a, b) => {
      if (a.inRegion !== b.inRegion) return a.inRegion ? -1 : 1;
      if (a.outlet.authorized !== b.outlet.authorized) return a.outlet.authorized ? -1 : 1;
      return a.outlet.name.localeCompare(b.outlet.name, 'zh-Hans-CN');
    })
    .map((x) => ({
      id: x.outlet.id,
      name: x.outlet.name,
      region: x.outlet.region,
      address: x.outlet.address,
      phone: x.outlet.phone,
      hours: x.outlet.hours,
      authorized: x.outlet.authorized,
      inRegion: x.inRegion
    }));
}
