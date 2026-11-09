'use strict';

/**
 * 工程体积守卫：node tests/size-guard.js
 * ------------------------------------------------------------------
 * 小程序预览编译器与上传链路会扫描工程目录并拒绝单个 >2MB 的文件。
 * 素材流水线历史上曾把 13MB 总览 PNG、11MB 打印 PDF 写进 assets/out/，
 * 导致预览编译失败且改动被 .gitignore 掩盖（git status 完全干净）。
 *
 * 现在可再生素材统一放在工程外的 ../splendor-assets/ 与
 * ../splendor-assets-preview/；本守卫作为回归第一步兜底，防止再次复发。
 *
 * 校验：工程内单文件 >2MB 即失败；工程内出现 assets/ 目录即失败。
 * 排除 .git / .workbuddy。
 *
 * ⚠️ 不排除 node_modules：平台预览编译器直接扫目录树，不读 .gitignore，
 * 也不读 packOptions.ignore。云 SDK 已装进工程，必须让守卫用与预览编译器
 * 相同的口径扫描，才能提前拦住「被忽略的大文件导致预览失败」这类问题。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LIMIT = 2 * 1024 * 1024;
const SKIP_DIRS = ['.git', '.workbuddy', '.agents'];

const oversized = [];
let total = 0;

function walk(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (entry) {
    if (SKIP_DIRS.indexOf(entry.name) >= 0) return;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs);
    } else if (entry.isFile()) {
      const size = fs.statSync(abs).size;
      total += size;
      if (size > LIMIT) oversized.push({ rel: path.relative(ROOT, abs), size: size });
    }
  });
}
walk(ROOT);

const problems = [];
oversized.forEach(function (f) {
  problems.push('  - ' + f.rel + '  ' + (f.size / 1024 / 1024).toFixed(1) + 'MB（超过 2MB 上限）');
});
if (fs.existsSync(path.join(ROOT, 'assets'))) {
  problems.push('  - 工程内出现 assets/ 目录，应移到工程外 ../splendor-assets/');
}

if (problems.length) {
  console.error('FAIL  工程体积守卫：');
  console.error(problems.join('\n'));
  process.exit(1);
}

console.log('单文件均 < 2MB，工程合计 ' + (total / 1024 / 1024).toFixed(1) + 'MB，素材目录在工程外');
