'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function fail(msg) { console.error('FAIL: ' + msg); process.exitCode = 1; }
function ok(msg) { console.log('OK  ' + msg); }

// 1. 严格 JSON
const jsonFiles = ['app.json', 'project.config.json', 'sitemap.json', 'pages/index/index.json', '.workbuddy/miniprogram-scaffold.json'];
jsonFiles.forEach(function (f) {
  try { JSON.parse(read(f)); ok('JSON ' + f); }
  catch (e) { fail('JSON ' + f + ' -> ' + e.message); }
});
const appJson = JSON.parse(read('app.json'));
if (!appJson.pages || !appJson.pages.length) fail('app.json pages 为空');
if (appJson.lazyCodeLoading !== 'requiredComponents') fail('缺少 lazyCodeLoading');
appJson.pages.forEach(function (p) {
  ['js', 'wxml'].forEach(function (ext) {
    if (!fs.existsSync(path.join(ROOT, p + '.' + ext))) fail('缺少页面文件 ' + p + '.' + ext);
  });
});
ok('app.json pages / lazyCodeLoading / 页面文件齐全');

// 2. JS 语法
const jsFiles = ['app.js', 'pages/index/index.js', 'utils/game-data.js', 'utils/game-engine.js', 'utils/ai.js'];
jsFiles.forEach(function (f) {
  const src = read(f);
  try { new Function(src); ok('JS 语法 ' + f); }
  catch (e) { fail('JS 语法 ' + f + ' -> ' + e.message); }
});

// 3. WXML 标签平衡
const wxml = read('pages/index/index.wxml');
const tagRe = /<\/?([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
const stack = [];
let m;
const VOID = [];
while ((m = tagRe.exec(wxml)) !== null) {
  const full = m[0];
  const name = m[1];
  const selfClose = m[3] === '/' || /\/\s*$/.test(full);
  if (full.startsWith('</')) {
    if (stack.length === 0 || stack[stack.length - 1] !== name) {
      fail('WXML 标签闭合不匹配，遇到 </' + name + '>，栈顶=' + (stack[stack.length - 1] || '空'));
      break;
    }
    stack.pop();
  } else if (!selfClose) {
    stack.push(name);
  }
}
if (stack.length) fail('WXML 存在未闭合标签: ' + stack.join(','));
else ok('WXML 标签闭合平衡');

// 4. 事件绑定必须存在对应 JS 方法
const pageJs = read('pages/index/index.js');
const handlers = new Set();
let hm;
const bindRe = /\b(?:bind|catch)(?:tap|touch|longpress|input|change)="([A-Za-z_$][\w$]*)"/g;
while ((hm = bindRe.exec(wxml)) !== null) handlers.add(hm[1]);
handlers.forEach(function (name) {
  const re = new RegExp('(^|\\n)\\s*' + name + '\\s*\\(', 'm');
  if (!re.test(pageJs)) fail('WXML 绑定了不存在的处理函数: ' + name);
});
ok('WXML 事件处理函数全部存在 (' + handlers.size + ' 个)');

// 5. WXML 顶层数据字段必须在 buildViewModel 返回值 / data 中
const vm = read('pages/index/index.js');
const vmSection = vm.slice(vm.indexOf('function buildViewModel'));
const returnSection = vmSection.slice(vmSection.indexOf('return {'));
const declaredFields = new Set(['item', 'index', 'card', 'cost', 'row', 'req', 'cell', 'ri', 'ci', 'true', 'false']);
let dm;
const fieldRe = /^\s{4}([A-Za-z_$][\w$]*)\s*:/gm;
while ((dm = fieldRe.exec(returnSection)) !== null) declaredFields.add(dm[1]);
// 页面初始 data
['stageScale'].forEach(function (f) { declaredFields.add(f); });

const roots = new Set();
let rm;
const mustacheRe = /\{\{([\s\S]*?)\}\}/g;
while ((rm = mustacheRe.exec(wxml)) !== null) {
  // 去掉字符串字面量和属性访问，只保留根变量
  const expr = rm[1].replace(/'[^']*'|"[^"]*"/g, ' ').replace(/\.\s*[A-Za-z_$][\w$]*/g, ' ');
  const idRe = /[A-Za-z_$][\w$]*/g;
  let im;
  while ((im = idRe.exec(expr)) !== null) roots.add(im[0]);
}
const missing = [];
roots.forEach(function (r) { if (!declaredFields.has(r)) missing.push(r); });
if (missing.length) fail('WXML 引用了未在视图模型中声明的根变量: ' + missing.join(', '));
else ok('WXML 根变量均有对应视图模型声明 (' + roots.size + ' 个)');

// 6. WXSS 括号平衡
const wxss = read('pages/index/index.wxss');
let depth = 0;
for (let i = 0; i < wxss.length; i++) {
  if (wxss[i] === '{') depth += 1;
  if (wxss[i] === '}') depth -= 1;
  if (depth < 0) { fail('WXSS 多余的 }'); break; }
}
if (depth !== 0) fail('WXSS 大括号不平衡，剩余 ' + depth);
else ok('WXSS 大括号平衡');

// 7. 本地引用检查（require 路径）
const reqRe = /require\(['"]([^'"]+)['"]\)/g;
let qm;
while ((qm = reqRe.exec(pageJs)) !== null) {
  const target = path.join(ROOT, 'pages/index', qm[1]);
  if (!fs.existsSync(target)) fail('页面 require 路径不存在: ' + qm[1]);
}
ok('页面 require 路径有效');

if (!process.exitCode) console.log('ALL STATIC CHECKS PASSED');
