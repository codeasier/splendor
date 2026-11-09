'use strict';

/**
 * 一键回归：node tests/run-all.js
 *
 * 先做工程体积守卫（防止 >2MB 素材产物写回小程序工程目录导致预览编译失败），
 * 再重建矢量美术与浏览器预览页，最后依次跑：
 *   静态校验 / 规则引擎 120 局 / 多人房间适配层 / 用户系统与战绩 /
 *   页面运行时模拟 / H5 预览页渲染与交互。
 * 全部使用工程内的相对路径，不依赖任何临时目录或本机绝对路径。
 */

const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function run(rel) {
  return execFileSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

const steps = [
  ['工程体积守卫（2MB 上限）', 'tests/size-guard.js'],
  ['重建矢量美术', 'preview/art.js'],
  ['构建浏览器预览', 'preview/build.js'],
  ['静态校验', 'tests/static.js'],
  ['规则引擎 120 局对战', 'tests/engine.js'],
  ['多人模式与房间适配层', 'tests/multiplayer.js'],
  ['用户系统与战绩', 'tests/user.js'],
  ['页面运行时模拟', 'tests/page-runtime.js'],
  ['H5 预览页渲染与交互', 'tests/preview.js']
];

let failed = 0;
steps.forEach(function (step) {
  const label = step[0];
  try {
    const out = run(step[1]).trim().split('\n');
    const summary = out[out.length - 1] || '';
    console.log('PASS  ' + label + (summary ? '  · ' + summary : ''));
  } catch (e) {
    failed += 1;
    console.error('FAIL  ' + label);
    console.error(((e.stdout || '') + (e.stderr || '')).trim());
  }
});

console.log('');
if (failed > 0) {
  console.error(failed + ' / ' + steps.length + ' 步失败');
  process.exit(1);
}
console.log(steps.length + ' / ' + steps.length + ' 步全部通过');
