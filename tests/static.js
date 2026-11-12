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

// 3.1 舞台必须包住全部屏幕层与弹层。
// 顶层只有 [viewport] 一个节点、其次是 [stage]。任何一个 </view> 写多了，
// 后面的 room-screen / 所有 overlay 就会掉出 .stage —— 它们不再被
// transform:scale() 缩放，按 1080px 逻辑坐标 1:1 渲染，手机屏宽 844px，
// 弹窗右边直接出屏（2026-11-10 好友弹窗事故）。标签仍然「平衡」，上面的
// 检查抓不到，必须单独断言结构。
(function () {
  const tagRe2 = /<\/?view\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  const stack2 = [];
  let m2;
  let rootCount = 0;
  let stageDepth = -1;
  const stray = [];
  while ((m2 = tagRe2.exec(wxml)) !== null) {
    const attrs = m2[1];
    const full = m2[0];
    if (full.startsWith('</')) {
      if (!stack2.length) break;
      stack2.pop();
      continue;
    }
    if (!stack2.length) {
      rootCount += 1;
      if (!/class="viewport(?:\s[^"]*)?"/.test(attrs)) stray.push('根节点不是 .viewport');
    } else if (stack2.length === 1 && /\bclass="stage\b/.test(attrs)) {
      stageDepth = 2;
    }
    stack2.push(attrs);
  }
  if (rootCount !== 1) stray.push('根节点数量=' + rootCount + '，应为 1');
  if (stageDepth < 0) stray.push('.stage 不是 .viewport 的第二层');
  // 每个屏幕层 / 弹层都必须在 .stage 内，即深度 ≥ 3
  const deepRe = /<view\b((?:[^>"']|"[^"]*"|'[^']*')*?class="(?:screen-layer|overlay)[^"]*"(?:[^>"']|"[^"]*"|'[^']*')*?)>/g;
  let dm2;
  const depths = [];
  while ((dm2 = deepRe.exec(wxml)) !== null) {
    // 统计该位置之前未闭合的 view 数
    let d = 0;
    const before = wxml.slice(0, dm2.index);
    const re3 = /<\/?view\b(?:[^>"']|"[^"]*"|'[^']*')*?>/g;
    let m3;
    while ((m3 = re3.exec(before)) !== null) {
      if (m3[0].startsWith('</')) d -= 1; else if (!/\/>$/.test(m3[0])) d += 1;
    }
    depths.push({ cls: (dm2[1].match(/class="([^"]*)"/) || [])[1], depth: d });
  }
  const out = depths.filter(function (x) { return x.depth < 2; });
  if (stray.length) fail('WXML 舞台结构异常: ' + stray.join('; '));
  else if (out.length) fail('有屏幕层/弹层掉出 .stage（不再随舞台缩放，会 1:1 出屏）: ' + out.map(function (x) { return x.cls; }).join(', '));
  else ok('WXML 舞台完整包住屏幕层与弹层 (' + depths.length + ' 个)');
})();

// 3.2 新增 utils 模块必须同时注册进 H5 预览编译器：只改页面 require 而漏了
// moduleFiles，预览里拿到的会是空对象，真机正常、H5 白屏，极难排查。
(function () {
  const buildJs = read('preview/build.js');
  ['chat', 'leaderboard'].forEach(function (name) {
    const decl = "['" + name + "', 'utils/" + name + ".js']";
    if (buildJs.indexOf(decl) < 0) fail('preview/build.js 未注册模块: ' + name);
  });
  ok('H5 预览模块注册表覆盖新增 utils');
})();

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

// 7. 天梯榜布局守卫：这几条约束是反复调试后才稳定的，改坏会导致
//    表格压住公式文字、说明文字被裁、或提示条与半截行重叠。
{
  const rules = [
    // 提示条必须在 body 里作为独立行，不能在 wrap 内绝对定位覆盖
    [/\.leaderboard-scroll-hint\s*\{[^}]*position:\s*static/, '提示条应为独立行（position: static），不能覆盖表格'],
    // wrap 必须与表格同高写死，否则塌陷后提示条上提到表格内部
    [/\.leaderboard-table-wrap\s*\{[^}]*height:\s*\d+px/, 'wrap 必须写死高度，否则塌陷导致提示条错位'],
    // body 必须允许滚动，写 hidden 会静默裁掉说明文字
    // body 的滚动约束由下方「overflow: hidden」独立检查负责（正则跨行匹配不稳）
    // 表格高度上限要留出三行文字的空间
    [/\.leaderboard-table\s*\{[^}]*max-height:\s*\d+px/, '表格需有 max-height 上限'],
  ];
  let bad = [];
  rules.forEach(function (pair) {
    if (!pair[0].test(wxss)) bad.push(pair[1]);
  });
  if (bad.length) fail('天梯榜布局守卫: ' + bad.join('；'));
  else ok('天梯榜布局守卫（提示条独立行 / wrap 定高 / body 可滚 / 表格限高）');

  // 同一条规则里不能同时出现 overflow: hidden 与 overflow-y: auto（后者会被覆盖）
  const bodyRule = /\.leaderboard-body\s*\{([^}]*)\}/.exec(wxss);
  if (bodyRule && /overflow:\s*hidden/.test(bodyRule[1])) {
    fail('leaderboard-body 内不得写 overflow: hidden（会覆盖 overflow-y: auto 并裁掉文字）');
  }
}

// 8. 本地引用检查（require 路径）
const reqRe = /require\(['"]([^'"]+)['"]\)/g;
let qm;
while ((qm = reqRe.exec(pageJs)) !== null) {
  const target = path.join(ROOT, 'pages/index', qm[1]);
  if (!fs.existsSync(target)) fail('页面 require 路径不存在: ' + qm[1]);
}
ok('页面 require 路径有效');

if (!process.exitCode) console.log('ALL STATIC CHECKS PASSED');
