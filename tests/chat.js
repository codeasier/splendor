'use strict';
/** 局内快捷聊天的纯数据层回归：白名单 / 视图模型 / 队列 / 云端降级 */
const path = require('path');
const C = require(path.join(__dirname, '..', 'utils', 'chat.js'));

function assert(cond, msg) { if (!cond) throw new Error('FAIL: ' + msg); }
function eq(a, b, msg) { assert(a === b, msg + ' expect=' + JSON.stringify(b) + ' got=' + JSON.stringify(a)); }

const NOW = 1700000000000;

/* ---------- 1. 发送白名单：唯一防线，伪造 id 必须拿不到任何内容 ---------- */
assert(C.QUICK_TEXTS.length >= 8, '至少提供 8 条快捷语');
assert(C.QUICK_EMOJIS.length >= 9, '至少提供 9 个互动表情（含西红柿）');
assert(C.findPreset('emoji', 'e9') && C.findPreset('emoji', 'e9').label === '扔西红柿',
  '应提供定向投掷的西红柿表情');
eq(C.aimFor('tomato'), 'throw', '西红柿属于投掷类');
eq(C.aimFor('egg'), 'throw', '鸡蛋属于投掷类');
eq(C.aimFor('tea'), 'gift', '递茶属于递送类');
assert(C.QUICK_EMOJIS.every(function (e) { return e.aim === 'throw' || e.aim === 'gift'; }),
  '每个表情都必须带动画类型，不能出现对着空气发的表情');
assert(C.findPreset('text', 't1') && C.findPreset('text', 't1').text.indexOf('快点') >= 0, '斗地主经典催牌短语应存在');
assert(C.findPreset('emoji', 'e3') && C.findPreset('emoji', 'e3').icon === '💣', '炸弹表情应存在');
eq(C.findPreset('text', 'e3'), null, '跨类型 id 不得命中');
eq(C.findPreset('emoji', 't1'), null, '跨类型 id 不得命中（反向）');
eq(C.findPreset('text', '__proto__'), null, '原型链 key 不得命中');
eq(C.findPreset('text', '自由输入：违规内容'), null, '任意用户字符串不得命中');
eq(C.findPreset('bogus', 't1'), null, '非法 kind 不得命中');
console.log('OK  预设白名单 · 8 短语 / 8 表情 / 越界 id 全部拒绝');

/* ---------- 2. 消息对象：预设内容不携带任何自由文本 ---------- */
const tmsg = C.makeMessage('ABC234', 1, 'u-1', '在线甲', 'text', C.findPreset('text', 't2'), NOW);
eq(tmsg.kind, 'text', 'kind');
eq(tmsg.text, '你的牌打得也太好了', 'text 应来自预设');
eq(tmsg.icon, '', '文字消息不带表情');
eq(tmsg.roomCode, 'ABC234', 'roomCode');
eq(tmsg.seat, 1, 'seat');
assert(/^\d{4}-\d{2}-\d{2}T/.test(tmsg.iso), 'created_at 应为 ISO 字符串');
const emsg = C.makeMessage('ABC234', 0, 'u-0', '我', 'emoji', C.findPreset('emoji', 'e1'), NOW);
eq(emsg.text, '', '表情消息不带自由文本');
eq(emsg.label, '递茶', '表情名称来自预设');
eq(emsg.icon, '🍵', '表情图标来自预设');
eq(emsg.targetSeat, -1, '未指定目标时记 -1');
const aimed = C.makeMessage('ABC234', 0, 'u-0', '我', 'emoji',
  C.findPreset('emoji', 'e9'), NOW, 2);
eq(aimed.targetSeat, 2, '表情应记录目标席位');
eq(aimed.tone, 'tomato', 'tone 随预设带入，供云端还原动画');
eq(aimed.aim, 'throw', '西红柿按 tone 判定为投掷类');
eq(tmsg.targetSeat, -1, '快捷语不需要目标');
console.log('OK  消息结构 · 文字/表情均无自由文本 · 定向 targetSeat / tone / aim');

/* ---------- 3. 队列裁剪：窗口 + 上限 ---------- */
const many = [];
for (let i = 0; i < 40; i++) many.push(C.makeMessage('r', 0, '', 'x', 'text', C.findPreset('text', 't1'), NOW - 1000 + i));
const trimmed = C.trim(many, NOW);
eq(trimmed.length, C.MAX_LOCAL, '超出上限应截断到 MAX_LOCAL');
const stale = C.trim([
  C.makeMessage('r', 0, '', 'x', 'text', C.findPreset('text', 't1'), NOW - C.WINDOW_MS - 1),
  C.makeMessage('r', 0, '', 'x', 'text', C.findPreset('text', 't1'), NOW)
], NOW);
eq(stale.length, 1, '窗口外消息应被丢弃');
console.log('OK  队列裁剪 · 60s 窗口 / 24 条上限');

/* ---------- 4. 合并去重 ---------- */
const a = C.makeMessage('r', 0, '', 'x', 'text', C.findPreset('text', 't1'), NOW);
const b = C.makeMessage('r', 1, '', 'y', 'text', C.findPreset('text', 't2'), NOW + 10);
const m1 = C.merge([a], [a, b], NOW);
eq(m1.list.length, 2, '同 id 不得重复入队');
eq(m1.added, 1, '新增条数应为 1');
eq(C.merge([a, b], [b], NOW).added, 0, '全已存在时新增 0');
console.log('OK  远端合并 · 按 id 幂等去重');

/* ---------- 5. 气泡视图模型 ---------- */
const msgs = [
  C.makeMessage('r', 0, '', '我', 'text', C.findPreset('text', 't1'), NOW - 500),
  C.makeMessage('r', 0, '', '我', 'text', C.findPreset('text', 't2'), NOW - 100),
  C.makeMessage('r', 1, '', '在线甲', 'emoji', C.findPreset('emoji', 'e3'), NOW - 50),
  C.makeMessage('r', 2, '', '在线乙', 'text', C.findPreset('text', 't3'), NOW - 40),
  C.makeMessage('r', 4, '', '太旧的', 'text', C.findPreset('text', 't5'), NOW - C.BUBBLE_TTL_MS - 1)
];
const vm = C.chatVM(msgs, 0, NOW, false, 'text');
eq(vm.bubbles.length, 3, '气泡最多 3 条');
eq(vm.bubbles.filter(function (x) { return x.seat === 0; }).length, 1, '同一席位只显示最新一条');
eq(vm.bubbles.filter(function (x) { return x.seat === 0; })[0].text, '你的牌打得也太好了', '应取最新那条');
eq(vm.bubbles.filter(function (x) { return x.seat === 4; }).length, 0, '过期气泡不显示');
assert(vm.bubbles.filter(function (x) { return x.seat === 0; })[0].mine, '自己席位应标 mine');
assert(vm.bubbles.filter(function (x) { return x.seat === 1; })[0].isEmoji, '表情消息应标 isEmoji');
eq(vm.open, false, '面板默认关闭');
eq(vm.isText, true, 'text tab 互斥布尔');
eq(vm.isEmoji, false, 'text tab 下表情页关闭');
const vm2 = C.chatVM([], 0, NOW, true, 'emoji');
eq(vm2.isEmoji, true, 'emoji tab 互斥布尔');
eq(vm2.isText, false, 'emoji tab 下文字页关闭');
eq(vm2.flyList.length, 0, 'flyList 默认空');
const pickVM = C.chatVM([], 0, NOW, true, 'emoji', {});
eq(pickVM.isPick, true, '未暂存表情时停在第一步「选表情」');
eq(pickVM.isTarget, false, '未暂存表情不渲染目标列表');
const targetVM = C.chatVM([], 0, NOW, true, 'emoji', {
  pendingEmoji: C.findPreset('emoji', 'e9'),
  targets: [{ seat: 0 }, { seat: 1 }],
  projectiles: [{ id: 'p1' }]
});
eq(targetVM.isTarget, true, '暂存表情后进入第二步「选目标」');
eq(targetVM.isPick, false, '选目标时表情格必须消失');
eq(targetVM.pending.label, '扔西红柿', '暂存的是白名单 preset');
eq(targetVM.targets.length, 2, '目标列表透传');
eq(targetVM.projectiles.length, 1, '投射动画透传');
eq(C.chatVM([], 0, NOW, true, 'text', {
  pendingEmoji: C.findPreset('emoji', 'e9')
}).isPick, true, '切回快捷语 tab 不应残留选目标阶段');
console.log('OK  气泡视图模型 · TTL / 同席去重 / 3 条上限 / tab 互斥 / 两步定向');

/* ---------- 6. 云端读写：字段契约 + 异常静默降级 ---------- */
function mockCloud(rows, fail) {
  const calls = [];
  const q = {
    from(t) { calls.push(['from', t]); return q; },
    upsert(row) {
      calls.push(['upsert', row]);
      return Promise.resolve(fail ? { error: { message: 'table missing' } } : { data: [row], error: null });
    },
    select() { calls.push(['select']); return q; },
    eq(k, v) { calls.push(['eq', k, v]); return q; },
    gte(k, v) { calls.push(['gte', k, v]); return q; },
    limit(n) { calls.push(['limit', n]); return q; },
    then(resolve, reject) {
      return Promise.resolve(fail ? { error: { message: 'boom' } } : { data: rows || [], error: null })
        .then(resolve, reject);
    }
  };
  return { cloud: { database: { from: function (t) { return q.from(t); } } }, calls: calls };
}

async function runCloud() {
  const ok = mockCloud([], false);
  const sent = await C.send(ok.cloud, tmsg);
  eq(sent.ok, true, '有云时应写入成功');
  const up = ok.calls.filter(function (c) { return c[0] === 'upsert'; })[0];
  assert(up, '应调用 upsert 写一行');
  eq(up[1].room_code, 'ABC234', '写 room_code');
  eq(up[1].kind, 'text', '写 kind');
  eq(up[1].created_at, tmsg.iso, '写 ISO 时间');
  eq(up[1].target_seat, -1, '文字消息写 -1 目标');
  eq(ok.calls[0][1], C.CHAT_TABLE, '应写入独立聊天表，不碰 splendor_games');

  const ok2 = mockCloud([], false);
  await C.send(ok2.cloud, aimed);
  const up2 = ok2.calls.filter(function (c) { return c[0] === 'upsert'; })[0];
  eq(up2[1].target_seat, 2, '定向表情把目标席位写进云端');
  eq(up2[1].tone, 'tomato', 'tone 也要落库，对端才能还原投掷动画');

  const rows = [{
    id: 'remote-1', room_code: 'ABC234', seat: 2, from_uid: 'u2', from_name: '在线乙',
    kind: 'emoji', text: '', icon: '🍅', label: '扔西红柿',
    tone: 'tomato', target_seat: 1, created_at: new Date(NOW).toISOString()
  }];
  const pulled = mockCloud(rows, false);
  const list = await C.list(pulled.cloud, 'ABC234', NOW);
  eq(list.length, 1, '应拉回 1 条');
  eq(list[0].seat, 2, 'seat 映射');
  eq(list[0].icon, '🍅', 'icon 映射');
  eq(list[0].targetSeat, 1, '读回目标席位');
  eq(list[0].aim, 'throw', '按 tone 还原动画类型，不信任客户端自报的 aim');
  eq(list[0].at, NOW, 'created_at 解析为毫秒时间戳');
  assert(pulled.calls.some(function (c) { return c[0] === 'gte' && c[1] === 'created_at'; }), '应带时间窗口条件');
  assert(pulled.calls.some(function (c) { return c[0] === 'eq' && c[2] === 'ABC234'; }), '应按房间号过滤');

  // 无云 / 表不存在 / 抛异常：全部静默返回，绝不把牌桌打断
  eq((await C.send(null, tmsg)).ok, false, '无云时 send 应降级');
  eq((await C.list(null, 'r', NOW)).length, 0, '无云时 list 应返回空');
  const bad = mockCloud([], true);
  eq((await C.send(bad.cloud, tmsg)).ok, false, '云端报错时 send 应降级');
  eq((await C.list(bad.cloud, 'r', NOW)).length, 0, '云端报错时 list 应返回空');
  console.log('OK  云端契约 · 独立表 / 时间窗口 / 无云与报错均静默降级');
}

runCloud().then(function () {
  console.log('ALL PASS');
}).catch(function (e) {
  console.error(e.message || e);
  process.exitCode = 1;
});
