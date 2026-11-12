'use strict';

/**
 * 昵称敏感字过滤。
 * ------------------------------------------------------------------
 * 规则：昵称中命中敏感字的字符全部替换为 '*'，长度不变 —— 长度变化会让
 * 「康爸」变成「*爸」看似正常，但「康康」会被压缩成「*」，
 * 榜单列宽与头像首字都会跟着跳，所以按字符一一替换而不是整词删除。
 *
 * 只在**显示层**过滤，不改数据库与本地存储：
 *   - 云端存量（如「康爸」「康康」）无需迁移即可生效
 *   - 日后要放开某个字，改这张表即可，历史数据不受影响
 *   - 用户自己填的昵称仍按原样保存，不会出现「保存后自己都认不出」的情况
 *
 * 为什么不用正则拼接：敏感字可能包含正则元字符（如 . * + ?），
 * 直接拼进 RegExp 会误伤或抛错，逐字符比对最稳。
 */

// 敏感字表。新增词直接往里加，无需改动任何调用点。
const SENSITIVE_CHARS = ['康'];

/**
 * 把昵称里的敏感字替换成 '*'。
 * @param {string} name 原始昵称
 * @returns {string} 过滤后的昵称；空值原样返回，避免把「未设置」变成 '*'
 */
function maskName(name) {
  const s = name === undefined || name === null ? '' : String(name);
  if (!s) return s;
  let out = '';
  for (const ch of s) {
    out += SENSITIVE_CHARS.indexOf(ch) >= 0 ? '*' : ch;
  }
  return out;
}

module.exports = {
  SENSITIVE_CHARS: SENSITIVE_CHARS,
  maskName: maskName
};
