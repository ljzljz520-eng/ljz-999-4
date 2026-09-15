// 认证工具：scrypt 密码哈希 + 不透明会话令牌（零第三方依赖）
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEYLEN = 64;

/** 输出 salt:hash（均为 hex） */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(String(password), salt, KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const hash = scryptSync(String(password), salt, KEYLEN);
  const expectedBuf = Buffer.from(expected, 'hex');
  if (expectedBuf.length !== hash.length) return false;
  return timingSafeEqual(hash, expectedBuf);
}

export function newToken() {
  return randomBytes(32).toString('hex');
}
