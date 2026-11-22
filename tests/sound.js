'use strict';

/**
 * 音效引擎测试（第六十九轮）
 * ------------------------------------------------------------------
 * 重点不是「能发声」（Node 里没有音频设备），而是三条不变量：
 *   1. 无 wx / 无 createWebAudioContext 时必须静默降级，绝不抛错；
 *   2. 静音开关必须真的拦住播放调用，且能持久化；
 *   3. 音频上下文和振荡器不能被重复创建 / 泄漏。
 * 同时校验音效定义的合法性（频率、时长、包络参数合理）。
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOUND_PATH = path.join(ROOT, 'utils', 'sound.js');

/* 每次 require 都拿到干净模块，避免测试间互相污染 */
function fresh() {
  delete require.cache[require.resolve(SOUND_PATH)];
  return require(SOUND_PATH);
}

/* 构造一个假的 WebAudio 上下文，记录所有调用 */
function makeFakeWx() {
  const calls = { osc: [], gain: [], started: 0, stopped: 0, closed: 0, created: 0 };
  const fakeCtx = {
    currentTime: 0,
    destination: { id: 'dest' },
    createOscillator() {
      const o = {
        type: '',
        frequency: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {},
        start() { calls.started += 1; },
        stop() { calls.stopped += 1; }
      };
      calls.osc.push(o);
      return o;
    },
    createGain() {
      const g = {
        gain: {
          setValueAtTime() {},
          exponentialRampToValueAtTime() {}
        },
        connect() {}
      };
      calls.gain.push(g);
      return g;
    },
    close() { calls.closed += 1; }
  };
  const store = {};
  const wx = {
    createWebAudioContext() { calls.created += 1; return fakeCtx; },
    getStorageSync(k) { return store[k] === undefined ? '' : store[k]; },
    setStorageSync(k, v) { store[k] = v; }
  };
  return { wx: wx, calls: calls, store: store };
}

/* ---------- 1. 无 wx 环境静默降级 ---------- */

(function () {
  delete global.wx;
  const S = fresh();
  // 不该抛错
  S.init();
  S.play('tap');
  S.play('nonexistent-sound');   // 未知音效也不能炸
  S.setMuted(true);
  assert.equal(S.isMuted(), true);
  S.destroy();
  console.log('OK  音效 · 无 wx 环境静默降级不抛错');
})();

/* ---------- 2. 有 API 时按定义播放，且上下文只建一次 ---------- */

(function () {
  const f = makeFakeWx();
  global.wx = f.wx;
  const S = fresh();
  S.init();

  S.play('buyCard');   // 两音
  assert.equal(f.calls.created, 1, '首次播放应建上下文');
  assert.equal(f.calls.osc.length, 2, 'buyCard 应合成两个音');
  assert.equal(f.calls.started, 2, '两个音都应 start');

  S.play('win');       // 五音，上下文应复用
  assert.equal(f.calls.created, 1, '上下文必须复用，不能重复创建');
  assert.equal(f.calls.osc.length, 7, 'win 应再合成五个音');

  S.play('tap');
  assert.equal(f.calls.created, 1, '第三次播放仍复用同一上下文');

  S.destroy();
  assert.equal(f.calls.closed, 1, 'destroy 应关闭上下文');
  global.wx = undefined;
  console.log('OK  音效 · 合成调用正确 / 上下文复用 / destroy 释放');
})();

/* ---------- 3. 静音开关真的拦住播放 ---------- */

(function () {
  const f = makeFakeWx();
  global.wx = f.wx;
  const S = fresh();
  S.init();

  S.setMuted(true);
  assert.equal(f.store['sfx_muted'], 1, '静音应写入存储');

  S.play('tap');
  assert.equal(f.calls.osc.length, 0, '静音时不该合成任何音');
  assert.equal(f.calls.created, 0, '静音时连上下文都不该建');

  // 新模块实例应读回静音状态
  const S2 = fresh();
  S2.init();
  assert.equal(S2.isMuted(), true, '静音状态应持久化');

  S2.setMuted(false);
  assert.equal(f.store['sfx_muted'], 0, '取消静音应写回存储');

  // toggle 往返
  const S3 = fresh();
  S3.init();
  assert.equal(S3.toggle(), true, 'toggle 应从 false 变 true');
  assert.equal(S3.toggle(), false, '再 toggle 回到 false');

  S.destroy();
  global.wx = undefined;
  console.log('OK  音效 · 静音开关短路播放 / 状态持久化 / toggle 往返');
})();

/* ---------- 4. 上下文创建失败后不反复重试 ---------- */

(function () {
  let attempts = 0;
  global.wx = {
    createWebAudioContext() { attempts += 1; throw new Error('audio unavailable'); },
    getStorageSync() { return ''; },
    setStorageSync() {}
  };
  const S = fresh();
  S.init();
  S.play('tap');
  S.play('tap');
  S.play('tap');
  assert.equal(attempts, 1, '创建失败后应记住失败，不反复重试');
  S.destroy();
  global.wx = undefined;
  console.log('OK  音效 · 上下文创建失败只尝试一次');
})();

/* ---------- 5. 音效定义合法性 ---------- */

(function () {
  const S = fresh();
  const names = Object.keys(S.SOUNDS);
  assert(names.length >= 8, '至少 8 个音效，实际 ' + names.length);

  names.forEach(function (name) {
    const def = S.SOUNDS[name];
    assert(Array.isArray(def.steps) && def.steps.length > 0, name + ' 必须有 steps');
    def.steps.forEach(function (s, i) {
      assert(typeof s.freq === 'number' && s.freq > 0, name + '[' + i + '] 频率必须为正');
      assert(s.freq <= 8000, name + '[' + i + '] 频率过高会刺耳');
      assert(typeof s.dur === 'number' && s.dur > 0, name + '[' + i + '] 时长必须为正');
      assert(s.dur <= 1.2, name + '[' + i + '] 单音时长过长（游戏音效应短）');
      assert(s.gain === undefined || (s.gain > 0 && s.gain <= 0.25),
        name + '[' + i + '] gain 超出安全区间（>0.25 会破音）');
      assert(s.to === undefined || s.to > 0, name + '[' + i + '] 滑音目标必须为正');
      assert(s.delay === undefined || s.delay >= 0, name + '[' + i + '] delay 不能为负');
    });
    // 总时长不超过 1.5s，否则会盖住后续音效
    const total = def.steps.reduce(function (m, s) {
      return Math.max(m, (s.delay || 0) + s.dur);
    }, 0);
    assert(total <= 1.5, name + ' 总时长 ' + total + 's 过长');
  });
  console.log('OK  音效 · ' + names.length + ' 个定义合法（频率/时长/gain/滑音/总长）');
})();

/* ---------- 6. 未调用 init 也能工作（防御性） ---------- */

(function () {
  const f = makeFakeWx();
  global.wx = f.wx;
  const S = fresh();
  // 故意不 init
  S.play('tap');
  assert.equal(f.calls.osc.length, 1, '未 init 也应能播放');
  S.destroy();
  global.wx = undefined;
  console.log('OK  音效 · 未 init 时仍可播放（内部自愈）');
})();

console.log('ALL SOUND TESTS PASS');
