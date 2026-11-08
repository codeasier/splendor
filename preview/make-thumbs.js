'use strict';

/**
 * 从 CC0 原画生成工程内可入库的缩略图（一次性工具，跨平台可选）
 * ------------------------------------------------------------------
 * 运行：node preview/make-thumbs.js [--force]
 *
 * 输入：工程外的 ../splendor-assets/cc0/{white,blue,green,red,black,noble}/*.jpg
 *       可用环境变量 SPL_CC0 覆盖。原画与高清素材包统一放在小程序工程之外：
 *       总览 PNG ≈13MB、打印 PDF ≈11MB，写回工程会触发预览编译器的单文件 2MB 上限。
 * 输出（入库）：preview/thumbs/cards/*.jpg、preview/thumbs/nobles/*.jpg、portrait.jpg
 *
 * 卡牌在舞台上显示约 82×76 CSS px，@2x 需要约 164×152 物理像素；
 * 这里输出 200×138 / 130×176 的小图并压到 q≈50，90+10 张合计 < 600 KB，
 * 由 preview/art.js 内联成 base64 CSS，避免小程序 WXSS 无法引用本地图片的问题。
 * 只做等比缩放，裁切交给运行时的 background-size:cover。
 *
 * 优先用 macOS 自带 sips；其它平台若有 ImageMagick 则用 magick/convert。
 * 缩略图已经随仓库提交，日常构建（tests/run-all.js）不需要本脚本、也不需要原图。
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = process.env.SPL_CC0 || path.resolve(ROOT, '..', 'splendor-assets', 'cc0');
const OUT = path.join(__dirname, 'thumbs');
const FORCE = process.argv.indexOf('--force') >= 0;

const CARD_FAMILIES = ['white', 'blue', 'green', 'red', 'black'];
// 只做等比缩放，不做像素裁切：sips 的 --cropOffset 在部分原图上会把窗口推出画布并填黑。
// 裁切统一交给运行时的 background-size:cover + background-position，既能避开黑边，
// 也不会因为原图尺寸差异生成黑图。
// 尺寸比例贴近 CC0 原画（发展卡横向、肖像竖向），避免 sips 强制缩放造成变形
const CARD_SIZE = { w: 200, h: 138 };
const NOBLE_SIZE = { w: 130, h: 176 };

function backend() {
  const tryRun = (bin, args) => {
    try { execFileSync(bin, args, { stdio: 'ignore' }); return true; }
    catch (e) { return false; }
  };
  if (tryRun('sips', ['--help'])) return 'sips';
  if (tryRun('magick', ['-version'])) return 'magick';
  if (tryRun('convert', ['-version'])) return 'convert';
  return null;
}

function make(tool, src, dst, crop, size, quality) {
  if (tool === 'sips') {
    // sips -z 保持原图比例，输出不超过 H×W；裁切由前端 cover 完成
    execFileSync('sips', [
      '-z', String(size.h), String(size.w),
      '-s', 'format', 'jpeg',
      '-s', 'formatOptions', String(quality),
      src, '--out', dst
    ], { stdio: 'ignore' });
  } else {
    const bin = tool === 'magick' ? 'magick' : 'convert';
    execFileSync(bin, [
      src,
      '-resize', size.w + 'x' + size.h,
      '-quality', String(quality),
      dst
    ], { stdio: 'ignore' });
  }
}

function imageSize(file) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file], { encoding: 'utf8' });
  const w = /pixelWidth:\s*(\d+)/.exec(out);
  const h = /pixelHeight:\s*(\d+)/.exec(out);
  return { w: w ? Number(w[1]) : 0, h: h ? Number(h[1]) : 0 };
}

function centerCrop(dim, ratioW, ratioH) {
  // 按目标比例居中裁出尽可能大的区域
  const target = ratioW / ratioH;
  let w = dim.w;
  let h = Math.round(w / target);
  if (h > dim.h) { h = dim.h; w = Math.round(h * target); }
  return { w: w, h: h, left: Math.floor((dim.w - w) / 2), top: Math.floor((dim.h - h) / 2) };
}

if (!fs.existsSync(SRC)) {
  console.log('SKIP  未找到工程外 splendor-assets/cc0 原画（可设 SPL_CC0），保留已有的 preview/thumbs');
  process.exit(0);
}

const tool = backend();
if (!tool) {
  console.log('SKIP  未找到 sips / ImageMagick，保留仓库中已有的 preview/thumbs');
  process.exit(0);
}

fs.mkdirSync(path.join(OUT, 'cards'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'nobles'), { recursive: true });

let made = 0;
let kept = 0;
const madeFiles = [];

// 发展卡插画：每种红利宝石 18 张，索引 = 色序 × 18 + 序号
CARD_FAMILIES.forEach(function (family, ci) {
  const dir = path.join(SRC, family);
  const files = fs.readdirSync(dir).filter((f) => /\.jpe?g$/i.test(f)).sort();
  files.forEach(function (file, i) {
    if (i >= 18) return;
    const dst = path.join(OUT, 'cards', 'c' + ci + '_' + String(i).padStart(2, '0') + '.jpg');
    if (fs.existsSync(dst) && !FORCE) { kept += 1; return; }
    const dim = imageSize(path.join(dir, file));
    if (!dim.w || !dim.h) return;
    const crop = centerCrop(dim, CARD_SIZE.w, CARD_SIZE.h);
    make(tool, path.join(dir, file), dst, crop, CARD_SIZE, 48);
    made += 1;
    madeFiles.push(dst);
  });
});

// 贵族肖像：10 张，供贵族牌与玩家头像共用同一套写实素材
const nobleDir = path.join(SRC, 'noble');
if (fs.existsSync(nobleDir)) {
  const files = fs.readdirSync(nobleDir).filter((f) => /\.jpe?g$/i.test(f)).sort();
  files.forEach(function (file, i) {
    if (i >= 10) return;
    const dst = path.join(OUT, 'nobles', 'n' + i + '.jpg');
    if (fs.existsSync(dst) && !FORCE) { kept += 1; return; }
    const dim = imageSize(path.join(nobleDir, file));
    if (!dim.w || !dim.h) return;
    const crop = centerCrop(dim, NOBLE_SIZE.w, NOBLE_SIZE.h);
    make(tool, path.join(nobleDir, file), dst, crop, NOBLE_SIZE, 50);
    made += 1;
    madeFiles.push(dst);
  });

  const portrait = path.join(OUT, 'portrait.jpg');
  if (!fs.existsSync(portrait) || FORCE) {
    const first = path.join(nobleDir, files[0]);
    const dim = imageSize(first);
    const crop = centerCrop(dim, 108, 126);
    make(tool, first, portrait, crop, { w: 100, h: 136 }, 55);
    made += 1;
    madeFiles.push(portrait);
  } else kept += 1;
}

// CC0 原作普遍偏暗，缩到卡面尺寸会糊成一团黑。用 CoreImage 逐张抬起暗部，
// 只影响生成产物；没有 Swift 的环境保留原图，由 CSS filter 兜底。
if (madeFiles.length && tool === 'sips') {
  try {
    const swiftScript = path.join(__dirname, 'brighten.swift');
    for (let i = 0; i < madeFiles.length; i += 40) {
      execFileSync('swift', [swiftScript].concat(madeFiles.slice(i, i + 40)), { stdio: 'ignore' });
    }
    console.log('提亮：CoreImage 处理 ' + madeFiles.length + ' 张');
  } catch (e) {
    console.log('WARN CoreImage 提亮不可用，将由 CSS filter 兜底');
  }
}

const total = fs.readdirSync(path.join(OUT, 'cards')).reduce(function (n, f) {
  return n + fs.statSync(path.join(OUT, 'cards', f)).size;
}, 0);
console.log('缩略图：新建 ' + made + ' 张，复用 ' + kept + ' 张；cards 合计 ' +
  (total / 1024).toFixed(0) + ' KB（工具 ' + tool + '）');
