'use strict';

/**
 * 文艺复兴商会大厅的自包含 SVG 美术。无文件 / 网络依赖，无随机数。
 * sceneSVG 接受可选的 JPEG / PNG / WebP base64 data URI；不接受远程 URL。
 * 前景卡牌、筹码与所有文字 / 控件由调用方的 DOM 绘制。
 * 输出直接用于 data:image/svg+xml;charset=utf-8, + encodeURIComponent(svg)。
 */

function svg(width, height, contents, stretch) {
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="' + (stretch ? 'none' : 'xMidYMid slice') + '">' + contents + '</svg>';
}

function linear(id, stops, direction) {
  return '<linearGradient id="' + id + '" ' + (direction || 'x1="0" y1="0" x2="1" y2="0"') + '>' + stops.map(function (s) {
    return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] === undefined ? '' : ' stop-opacity="' + s[2] + '"') + '/>';
  }).join('') + '</linearGradient>';
}

function radial(id, stops, attrs) {
  return '<radialGradient id="' + id + '" ' + (attrs || 'cx="35%" cy="25%" r="80%"') + '>' + stops.map(function (s) {
    return '<stop offset="' + s[0] + '" stop-color="' + s[1] + '"' + (s[2] === undefined ? '' : ' stop-opacity="' + s[2] + '"') + '/>';
  }).join('') + '</radialGradient>';
}

function cartouche(x, y, w, h, r) {
  const right = x + w;
  const bottom = y + h;
  return 'M' + (x + r) + ' ' + y + 'H' + (right - r) + 'Q' + (right - r) + ' ' + (y + r) + ' ' + right + ' ' + (y + r) +
    'V' + (bottom - r) + 'Q' + (right - r) + ' ' + (bottom - r) + ' ' + (right - r) + ' ' + bottom +
    'H' + (x + r) + 'Q' + (x + r) + ' ' + (bottom - r) + ' ' + x + ' ' + (bottom - r) +
    'V' + (y + r) + 'Q' + (x + r) + ' ' + (y + r) + ' ' + (x + r) + ' ' + y + 'Z';
}

function sceneSVG(paintingUri) {
  const vertical = 'x1="0" y1="0" x2="0" y2="1"';
  const sky = linear('sc-sky', [[0, '#d0d9df'], [.46, '#eee1c9'], [1, '#e3ccaa']], vertical);
  const gold = linear('sc-gold', [[0, '#fff4c7'], [.18, '#e7bf70'], [.43, '#8c5720'], [.62, '#edca80'], [1, '#6d3e16']]);
  const marble = linear('sc-marble', [[0, '#775d43'], [.13, '#b79b73'], [.31, '#f7e7c4'], [.52, '#e7cba2'], [.76, '#ba9770'], [1, '#75543a']]);
  const stone = linear('sc-stone', [[0, '#f4dfba'], [.26, '#dcc09a'], [.7, '#b28c64'], [1, '#77583c']], vertical);
  const wine = linear('sc-fold', [[0, '#17060c'], [.15, '#481020'], [.37, '#831d35'], [.51, '#9a3046'], [.65, '#5d1028'], [.89, '#250712'], [1, '#12050b']]);
  const defs = '<defs>' + sky + gold + marble + stone + wine +
    linear('sc-water', [[0, '#b9d0c5'], [.32, '#80aaa8'], [.72, '#6a9295'], [1, '#c0b79c']], vertical) +
    linear('sc-palace', [[0, '#ebd3b0'], [.45, '#d2ab86'], [1, '#ac7a5b']], vertical) +
    linear('sc-plaster', [[0, '#faf0d8'], [.6, '#d8c3a2'], [1, '#b59d7b']], vertical) +
    linear('sc-arch-edge', [[0, '#4a3429'], [.35, '#967653'], [.7, '#e7d2aa'], [1, '#bda17e']]) +
    linear('sc-velvet', [[0, '#672037'], [.38, '#7e263e'], [.7, '#511429'], [1, '#2c0b19']], vertical) +
    linear('sc-rim', [[0, '#54321c'], [.18, '#f5d99c'], [.33, '#a97b3e'], [.48, '#f6dfae'], [.65, '#875525'], [1, '#28170e']], vertical) +
    linear('sc-wood', [[0, '#5c3320'], [.36, '#422016'], [.7, '#25120f'], [1, '#140a09']], vertical) +
    linear('sc-brass', [[0, '#f7d69b'], [.27, '#a76e2f'], [.48, '#ffe9b5'], [.74, '#b0823f'], [1, '#5a371b']]) +
    radial('sc-sun', [[0, '#fff9df', .98], [.25, '#ffe9b8', .52], [1, '#fff0c7', 0]], 'cx="12%" cy="16%" r="85%"') +
    radial('sc-table-glow', [[0, '#c66a7b', .28], [.55, '#a14159', .06], [1, '#4a0f24', 0]], 'cx="35%" cy="35%" r="75%"') +
    radial('sc-glass', [[0, '#fff7df', .95], [.24, '#f5e5bd', .38], [.5, '#a99774', .3], [.82, '#464136', .6], [1, '#171b1a', .9]], 'cx="30%" cy="24%" r="78%"') +
    radial('sc-vignette', [[0, '#170a0b', 0], [.6, '#170a0b', 0], [1, '#13070a', .66]], 'cx="43%" cy="40%" r="78%"') +
    '<pattern id="sc-veins" width="136" height="101" patternUnits="userSpaceOnUse"><path d="M-6 19C16 27 18 10 41 17S56 40 76 32 99 43 142 24M11 63C31 50 48 67 64 59S95 66 113 51M41 17l6 16 14 8m15-9 13-14m-25 41-8 20 13 25" fill="none" stroke="#765339" stroke-opacity=".13" stroke-width=".8"/><path d="M-7 21C16 29 18 12 41 19S56 42 76 34 99 45 142 26M12 65C31 52 48 69 64 61S95 68 113 53" fill="none" stroke="#fff4d8" stroke-opacity=".2" stroke-width=".8"/><ellipse cx="101" cy="83" rx="8" ry="2" fill="#6f4b2c" opacity=".045"/></pattern>' +
    '<pattern id="sc-silk" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0 0L7 7M-3 4l6 6M4-3l6 6" stroke="#ffc6bc" stroke-opacity=".07" stroke-width=".6"/><path d="M0 5l5-5m-2 7 4-4" stroke="#10040c" stroke-opacity=".19" stroke-width=".75"/></pattern>' +
    '<pattern id="sc-waves" width="92" height="19" patternUnits="userSpaceOnUse"><path d="M0 4h31m16 2h29M12 13h49m18 2h13" stroke="#f9ead0" stroke-width="1" stroke-opacity=".38"/><path d="M3 8h18m40 4h21" stroke="#406b74" stroke-width=".8" stroke-opacity=".2"/></pattern>' +
    '<clipPath id="sc-outdoor"><rect x="0" y="0" width="674" height="364"/></clipPath>' +
    '<clipPath id="sc-table"><path d="M-90 346C105 284 511 291 742 360C889 405 859 485 650 530C400 579 70 561-90 534Z"/></clipPath>' +
    '<clipPath id="sc-globe"><circle cx="624" cy="219" r="36"/></clipPath>' +
    '</defs>';
  const out = [defs, '<rect width="1080" height="560" fill="#2a1b18"/>'];

  // 窗外风景：可嵌入小型 CC0 风景图；默认以层叠的威尼斯天际线 / 运河兜底。
  out.push('<g clip-path="url(#sc-outdoor)"><rect width="674" height="364" fill="url(#sc-sky)"/>');
  const hasPainting = typeof paintingUri === 'string' && /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\r\n]+$/i.test(paintingUri);
  if (hasPainting) {
    out.push('<image x="-10" y="-9" width="694" height="386" preserveAspectRatio="xMidYMid slice" xlink:href="' + paintingUri.replace(/[\r\n]/g, '') + '"/><rect width="674" height="364" fill="#f9e2bc" opacity=".12"/>');
  } else {
    out.push('<path d="M0 206C85 190 131 201 211 191S400 191 483 184 621 189 674 180V278H0Z" fill="#b6b7ae" opacity=".45"/><rect y="238" width="674" height="126" fill="url(#sc-water)"/>');
    const blocks = [
      [0, 160, 55, 89, '#d4a88c'], [48, 181, 49, 66, '#edcfac'], [92, 149, 45, 100, '#e1bea0'],
      [132, 173, 57, 78, '#c99475'], [183, 158, 58, 92, '#f0d9b7'], [378, 167, 62, 87, '#d4ad87'],
      [432, 144, 46, 112, '#f0d3a6'], [470, 165, 60, 91, '#d3a884'], [525, 187, 62, 73, '#dec7a6'], [581, 155, 79, 107, '#bb9475']
    ];
    blocks.forEach(function (b, i) {
      const x = b[0], y = b[1], w = b[2], h = b[3];
      out.push('<g><path d="M' + x + ' ' + y + 'l' + w / 2 + '-7 ' + w / 2 + ' 7v' + h + 'H' + x + 'Z" fill="' + b[4] + '"/><path d="M' + x + ' ' + (y + 5) + 'h' + w + 'm-' + w + ' ' + (h - 12) + 'h' + w + '" stroke="#fff2d5" stroke-width="2" opacity=".65"/><path d="M' + (x + w - 5) + ' ' + (y + 5) + 'v' + h + '" stroke="#8b6852" stroke-width="3" opacity=".24"/>');
      const rows = Math.max(2, Math.floor(h / 25));
      const cols = Math.max(2, Math.floor(w / 16));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const wx = x + 7 + c * (w - 13) / cols;
          const wy = y + 14 + r * 23;
          out.push('<path d="M' + wx.toFixed(1) + ' ' + (wy + 11) + 'v-8a3 3 0 0 1 6 0v8z" fill="#665c53" opacity="' + (i % 3 === 0 ? '.72' : '.5') + '"/><path d="M' + (wx - 1).toFixed(1) + ' ' + (wy + 12) + 'h8" stroke="#fff0d5" stroke-width="1.4" opacity=".62"/>');
        }
      }
      out.push('</g>');
    });
    out.push('<g fill="url(#sc-plaster)" stroke="#ac9276" stroke-width="1"><path d="M259 244V179h103v65Z"/><path d="M266 179C270 144 277 122 310 113C342 124 350 146 355 179Z"/><path d="M280 174Q286 128 310 117Q333 130 341 174M296 175Q299 126 310 117Q322 128 326 175" fill="none" stroke="#9f9d90" stroke-width="2"/><path d="M277 176h66v8h-66Z"/><path d="M304 117v-15h13v15M302 101q8-14 17 0Z"/><path d="M309 90v-10h3v10"/><path d="M249 245v-48h-18v48m136 0v-48h18v48"/><path d="M228 197l12-18 12 18m112 0 12-18 12 18"/></g><g fill="#827a69" opacity=".65"><path d="M276 239v-31a8 8 0 0 1 16 0v31m11 0v-32a8 8 0 0 1 16 0v32m11 0v-31a8 8 0 0 1 16 0v31"/></g>');
    out.push('<path d="M0 251Q140 255 261 248T486 253 674 249" fill="none" stroke="#f4e4c7" stroke-width="3" opacity=".65"/><path d="M179 257q40-42 82-2" fill="none" stroke="#d9c3a4" stroke-width="13"/><path d="M179 254q40-42 82-2" fill="none" stroke="#f3e0c0" stroke-width="3"/><path d="M223 285q33 10 70-2-8 12-50 10-17-1-20-8Z" fill="#303b39" opacity=".85"/><path d="M264 283v-12m0 0 7 5m-8 0-15 18" fill="none" stroke="#4c4940" stroke-width="1.7"/><rect y="250" width="674" height="114" fill="url(#sc-waves)"/>');
  }
  out.push('<rect width="674" height="364" fill="url(#sc-sun)"/><path d="M47-20 208 370H123L8-20Z" fill="#fff5d2" opacity=".12"/><path d="M145-20 338 370H290L114-20Z" fill="#fff3cd" opacity=".08"/></g>');

  // 粗厚拱券：外墙、内凹石圈、细石缝与带凹槽的科林斯式石柱分层绘制。
  const arches = [[42, 190, 120, 104], [254, 410, 120, 108], [476, 628, 120, 105]];
  let openings = '';
  arches.forEach(function (a) { openings += 'M' + a[0] + ' 354V' + a[2] + 'A' + (a[1] - a[0]) / 2 + ' ' + a[3] + ' 0 0 1 ' + a[1] + ' ' + a[2] + 'V354Z'; });
  out.push('<path d="M-28-30H690V356H-28Z' + openings + '" fill="url(#sc-stone)" fill-rule="evenodd"/><path d="M-28-30H690V356H-28Z' + openings + '" fill="url(#sc-veins)" fill-rule="evenodd"/>');
  arches.forEach(function (a) {
    const cx = (a[0] + a[1]) / 2;
    const rx = (a[1] - a[0]) / 2;
    const p = 'M' + a[0] + ' 350V' + a[2] + 'A' + rx + ' ' + a[3] + ' 0 0 1 ' + a[1] + ' ' + a[2] + 'V350';
    out.push('<path d="' + p + '" fill="none" stroke="#493529" stroke-opacity=".32" stroke-width="15" transform="translate(4 1)"/><path d="' + p + '" fill="none" stroke="url(#sc-arch-edge)" stroke-width="11"/><path d="' + p + '" fill="none" stroke="#fff0cd" stroke-opacity=".65" stroke-width="1.5"/>');
    for (let i = 1; i < 10; i++) {
      const a1 = Math.PI + i * Math.PI / 10;
      const x1 = cx + Math.cos(a1) * (rx + 7);
      const y1 = a[2] + Math.sin(a1) * (a[3] + 8);
      const x2 = cx + Math.cos(a1) * (rx + 24);
      const y2 = a[2] + Math.sin(a1) * (a[3] + 25);
      out.push('<path d="M' + x1.toFixed(1) + ' ' + y1.toFixed(1) + 'L' + x2.toFixed(1) + ' ' + y2.toFixed(1) + '" stroke="#70543c" stroke-width=".9" stroke-opacity=".3"/>');
    }
  });
  [12, 222, 444, 652].forEach(function (cx, index) {
    const shaft = 'M' + (cx - 15) + ' 136Q' + (cx - 19) + ' 230 ' + (cx - 22) + ' 332H' + (cx + 22) + 'Q' + (cx + 19) + ' 230 ' + (cx + 15) + ' 136Z';
    out.push('<defs><clipPath id="sc-col-' + index + '"><path d="' + shaft + '"/></clipPath></defs><path d="M' + (cx + 16) + ' 136V339h18V136Z" fill="#3d291e" opacity=".23"/><path d="' + shaft + '" fill="url(#sc-marble)" stroke="#b89a74" stroke-width=".8"/><path d="' + shaft + '" fill="url(#sc-veins)"/>');
    for (let f = -2; f <= 2; f++) {
      const x = cx + f * 6;
      out.push('<path d="M' + x + ' 143Q' + (x + f) + ' 235 ' + (x + f * 2) + ' 329" fill="none" stroke="#7a5e41" stroke-opacity=".25" stroke-width="1.7"/><path d="M' + (x + 1.5) + ' 143Q' + (x + 1.5 + f) + ' 235 ' + (x + 1.5 + f * 2) + ' 329" fill="none" stroke="#fff3d0" stroke-opacity=".34" stroke-width="1"/>');
    }
    out.push('<g fill="url(#sc-stone)" stroke="#94744e" stroke-opacity=".6" stroke-width=".6"><path d="M' + (cx - 23) + ' 328h46v6h-46Z"/><path d="M' + (cx - 28) + ' 334h56v7h-56Z"/><path d="M' + (cx - 33) + ' 341h66v9h-66Z"/><path d="M' + (cx - 22) + ' 131h44v9h-44Z"/><path d="M' + (cx - 30) + ' 105h60l-4 9h-52Z"/><path d="M' + (cx - 33) + ' 100h66v6h-66Z"/></g>');
    for (let l = -2; l <= 2; l++) {
      const x = cx + l * 9;
      out.push('<path d="M' + x + ' 133C' + (x - 10) + ' 126 ' + (x - 9) + ' 112 ' + (x - 4) + ' 113Q' + x + ' 125 ' + (x + 4) + ' 113C' + (x + 10) + ' 113 ' + (x + 9) + ' 127 ' + x + ' 133Z" fill="url(#sc-marble)" stroke="#a2835e" stroke-width=".65"/><path d="M' + x + ' 132v-12" stroke="#fff0cd" stroke-width=".9" opacity=".7"/>');
    }
    out.push('<path d="M' + (cx - 20) + ' 126c-13 0-15-17-5-17 8 0 9 11 2 11m43 6c13 0 15-17 5-17-8 0-9 11-2 11" fill="none" stroke="#f1d9af" stroke-width="2.6"/><path d="M' + (cx - 30) + ' 102h60M' + (cx - 28) + ' 335h56M' + (cx - 32) + ' 342h64" stroke="#fff0d0" stroke-width="1.2" opacity=".65"/>');
  });
  out.push('<path d="M-20 0H687v13H-20Z" fill="url(#sc-marble)"/><path d="M-20 13H687v7H-20Z" fill="#9f7a52"/><path d="M-20 20H687v4H-20Z" fill="#f2d8ad"/>');
  for (let d = 0; d < 35; d++) out.push('<path d="M' + (d * 20 - 12) + ' 24h10v9h-10Z" fill="#d5b386" stroke="#9b754d" stroke-width=".65"/>');
  out.push('<path d="M-10 349H665v12H-10Z" fill="url(#sc-marble)"/><path d="M-10 349H665" stroke="#fff1cc" stroke-width="2"/><path d="M-10 363H665v17H-10Z" fill="#887052"/>');

  // 右侧墙面与帷幕。折叠采用渐变实体褶面，不使用随机噪点或外部贴图。
  out.push('<rect x="675" width="405" height="560" fill="#30221e"/><path d="M763 0h54v421h-54Zm257 0h39v455h-39Z" fill="url(#sc-marble)" opacity=".38"/><path d="M777 0h7v422m14-422h4v422m228-422h4v454" stroke="#eed6af" stroke-width="2" opacity=".16"/><path d="M738 0h95v34h-95Zm257 0h85v27h-85Z" fill="url(#sc-stone)" opacity=".5"/>');
  out.push('<path d="M437-20H1080V492C923 452 797 422 677 409 598 321 508 201 437-20Z" fill="#260811"/>');
  const folds = [[452, 118, 66], [512, 91, 45], [566, 110, 21], [625, 104, -15], [686, 107, -33], [748, 110, -46], [812, 105, -26], [872, 113, 10], [937, 106, 15], [1000, 117, -8]];
  folds.forEach(function (f, i) {
    const x = f[0], w = f[1], bend = f[2];
    out.push('<path d="M' + x + '-20h' + w + 'C' + (x + w - 9) + ' 98 ' + (x + w + bend) + ' 270 ' + (x + w + bend + 30) + ' 434L' + (x + bend + 22) + ' 429C' + (x + bend - 3) + ' 291 ' + (x + 8) + ' 86 ' + x + '-20Z" fill="url(#sc-fold)" opacity="' + (i > 5 ? '.69' : '.94') + '"/>');
  });
  out.push('<path d="M443-10C472 109 492 175 549 221Q587 239 625 206C570 165 543 83 539-10Z" fill="url(#sc-fold)"/><path d="M443-10C472 109 492 175 549 221Q587 239 625 206C570 165 543 83 539-10Z" fill="url(#sc-silk)"/><path d="M473 0C490 97 515 166 556 213M498 0C509 99 536 166 575 219M523 0C532 99 551 161 600 211" fill="none" stroke="#f18993" stroke-opacity=".12" stroke-width="2.5"/><path d="M548 223C566 279 609 322 642 382L678 409C624 303 617 263 612 220Z" fill="url(#sc-fold)"/><path d="M544 218Q578 245 618 218" fill="none" stroke="#45220f" stroke-width="10"/><path d="M544 216Q578 243 618 216" fill="none" stroke="url(#sc-gold)" stroke-width="6"/><path d="M544 214Q578 241 618 214" fill="none" stroke="#ffe7af" stroke-width=".9"/><path d="M611 218q19 12 10 42" fill="none" stroke="url(#sc-gold)" stroke-width="3"/><ellipse cx="619" cy="252" rx="6" ry="8" fill="url(#sc-gold)"/><path d="M615 256l-8 23q9 7 20 0l-5-23Z" fill="url(#sc-gold)"/><path d="M612 274l12 1m-9-14-3 15m6-14-1 17m5-17 2 15" stroke="#6f451b" stroke-width=".7"/>');
  out.push('<path d="M1065-10H1085V560H1007C1012 412 1029 315 1044 222S1062 76 1065-10Z" fill="url(#sc-fold)"/><path d="M1076 0C1061 159 1039 353 1035 551" fill="none" stroke="#a44650" stroke-width="5" opacity=".26"/>');

  // 书册与黄铜浑天仪放在控制板左侧后景，不占其 x=680..1050 的操作面。
  out.push('<g transform="rotate(-5 628 310)"><path d="M578 302h101v22H578Z" fill="#231d22" stroke="#b58d4c" stroke-width="1"/><path d="M586 306h89v12h-89Z" fill="#c8af80"/><path d="M586 309h89m-89 4h89" stroke="#6e573d" stroke-width=".7" opacity=".55"/><path d="M578 301h105v4H578Zm0 19h105v5H578Z" fill="#573047" stroke="#b28a42" stroke-width=".8"/></g><g transform="rotate(4 624 292)"><path d="M586 281h99v21h-99Z" fill="#5b2631" stroke="#b28a42" stroke-width="1"/><path d="M593 285h89v12h-89Z" fill="#dac6a0"/><path d="M593 289h89m-89 4h89" stroke="#886f4f" stroke-width=".7" opacity=".5"/><path d="M586 279h102v5H586Zm0 19h102v5H586Z" fill="#702a37" stroke="#c6a063" stroke-width=".8"/></g>');
  out.push('<ellipse cx="625" cy="287" rx="44" ry="8" fill="#110d0e" opacity=".6"/><path d="M619 256v14l-25 13v4h61v-4l-24-13v-14Z" fill="url(#sc-brass)" stroke="#4a311a" stroke-width="1"/><path d="M608 282q16-13 33 0M624 263v16" fill="none" stroke="#ffdf9c" stroke-width="1.3"/><circle cx="624" cy="219" r="36" fill="url(#sc-glass)" stroke="#b59659" stroke-width="1.4"/><g clip-path="url(#sc-globe)" fill="none" stroke="#dbc596" stroke-width=".85" opacity=".4"><ellipse cx="624" cy="219" rx="17" ry="36"/><ellipse cx="624" cy="219" rx="29" ry="36"/><ellipse cx="624" cy="219" rx="36" ry="13"/><path d="M590 206q35-18 68 0m-68 25q35 18 68 0m-34-50v77M600 199l12 5 2 12 13 1 8 14-7 13m12-43-9 9 8 10 13-1"/></g><ellipse cx="624" cy="219" rx="43" ry="48" fill="none" stroke="#5d3f20" stroke-width="7" transform="rotate(20 624 219)"/><ellipse cx="624" cy="219" rx="43" ry="48" fill="none" stroke="url(#sc-brass)" stroke-width="4" transform="rotate(20 624 219)"/><ellipse cx="624" cy="219" rx="50" ry="13" fill="none" stroke="url(#sc-brass)" stroke-width="4" transform="rotate(-18 624 219)"/><path d="M607 185q14-9 28-1" fill="none" stroke="#fff7dc" stroke-width="2.5" opacity=".7"/><path d="M627 169v-8m-4 2h8" stroke="#d2b371" stroke-width="2.5"/>');

  // 前景圆弧桌体：阴影、实木、金属卷边、丝绒台面分别构成可见厚度。
  out.push('<path d="M-95 365C110 300 518 305 750 374C914 424 861 509 662 553C401 607 61 583-95 553Z" fill="#0c080a" opacity=".65"/><path d="M-90 356C105 294 511 301 742 370C889 415 859 501 650 546C400 595 70 577-90 550V534H-90Z" fill="url(#sc-wood)"/><path d="M-90 346C105 284 511 291 742 360C889 405 859 485 650 530C400 579 70 561-90 534Z" fill="url(#sc-velvet)" stroke="url(#sc-rim)" stroke-width="14"/><path d="M-90 346C105 284 511 291 742 360C889 405 859 485 650 530C400 579 70 561-90 534Z" fill="url(#sc-silk)"/><g clip-path="url(#sc-table)"><rect x="-10" y="290" width="910" height="270" fill="url(#sc-table-glow)"/><path d="M-40 414Q182 401 365 447T780 421M-40 462Q181 445 354 492T729 468M-30 363Q172 343 326 374T775 405" fill="none" stroke="#e4a1a8" stroke-opacity=".04" stroke-width="9"/><path d="M-50 416Q152 408 342 459T775 435M-20 464Q181 453 354 501T729 478" fill="none" stroke="#240714" stroke-opacity=".1" stroke-width="5"/></g><path d="M-85 341C105 279 511 286 744 355C895 401 864 487 651 532" fill="none" stroke="#ffe6b1" stroke-width="1.9" opacity=".85"/><path d="M-83 540C118 566 400 575 654 535C771 514 833 481 842 453" fill="none" stroke="#f7d89a" stroke-width="2" opacity=".75"/><path d="M-83 551C118 577 400 586 654 546C771 525 833 492 848 462" fill="none" stroke="#b38a4a" stroke-width="1" opacity=".7"/>');

  // 画面外切入的珠宝匣提供近景比例与深度；不绘制任何卡牌 / 筹码。
  out.push('<g transform="rotate(-5 30 376)"><ellipse cx="27" cy="413" rx="85" ry="14" fill="#190a12" opacity=".55"/><path d="M-42 302 69 297 94 315 93 401-40 411Z" fill="#193f3b" stroke="#d6aa5d" stroke-width="3"/><path d="M69 297 94 315 93 401 70 390Z" fill="#122824" stroke="#8e6735" stroke-width="2"/><path d="M-42 302 69 297 94 315-40 322Z" fill="#3e6454" stroke="#e6c179" stroke-width="2"/><path d="M-40 321 94 315M-40 328 92 323M-40 398 91 389" fill="none" stroke="url(#sc-gold)" stroke-width="5"/><path d="M-31 335 58 331V384L-31 391Z" fill="none" stroke="url(#sc-gold)" stroke-width="2"/><path d="M-24 342q15 6 24-5m-24 44q15-10 24-5m50-36q-14 5-18-5m18 40q-14-10-18-5M13 337v42m-13-22h27" fill="none" stroke="#dfba73" stroke-width="1.2"/><path d="M13 344q-16-9-16 4 0 9 16 9-16 2-12 12 4 9 12-1 7 10 12 1 5-10-12-12 16 0 16-9 0-13-16-4Z" fill="none" stroke="url(#sc-gold)" stroke-width="2"/><path d="M66 332h14v18H66Z" fill="url(#sc-gold)" stroke="#4c331c" stroke-width="1"/><circle cx="73" cy="342" r="2" fill="#35291b"/></g>');
  out.push('<rect width="1080" height="560" fill="url(#sc-vignette)"/><path d="M0 1H1080" stroke="#fff0cb" stroke-opacity=".13"/><path d="M0 559H1080" stroke="#0d0508" stroke-opacity=".7"/>');
  return svg(1080, 560, out.join(''));
}

function cornerLeaf() {
  return '<path d="M0 39Q2 10 39 0M6 32Q5 16 24 9M15 19q1-12 12-15M10 25q14 2 22-9M21 12q11 2 15-6" fill="none" stroke="url(#pn-gold)" stroke-width="1.4" stroke-linecap="round"/><path d="M4 29Q-1 17 6 11q7 10-2 18ZM11 19Q7 7 17 3q3 12-6 16ZM14 22Q29 25 34 15q-12-3-20 7ZM26 9Q37 14 41 4q-11-3-15 5Z" fill="url(#pn-gold)"/><path d="M4 29 6 17m5 2 4-9m-1 12 14-4m-2-9 10-3" stroke="#5d3c19" stroke-width=".6" opacity=".55"/>';
}

function panelSVG() {
  const outer = cartouche(5, 5, 390, 390, 29);
  const inner = cartouche(13, 13, 374, 374, 24);
  const inset = cartouche(20, 20, 360, 360, 20);
  const defs = '<defs>' +
    linear('pn-gold', [[0, '#fff2bd'], [.2, '#d8ac58'], [.44, '#9a6825'], [.63, '#fbe0a0'], [.83, '#b98739'], [1, '#765019']]) +
    linear('pn-edge', [[0, '#fff3c6'], [.32, '#9c6b2f'], [.6, '#f1cd81'], [1, '#5d401b']], 'x1="0" y1="0" x2="0" y2="1"') +
    radial('pn-leather', [[0, '#1b5854'], [.43, '#104743'], [.82, '#0c3437'], [1, '#071e26']], 'cx="28%" cy="15%" r="105%"') +
    '<pattern id="pn-grain" width="16" height="12" patternUnits="userSpaceOnUse"><path d="M-2 3q4-5 8 0t8 0 8 0M-2 9q4-5 8 0t8 0 8 0" fill="none" stroke="#020e15" stroke-width=".8" opacity=".3"/><path d="M-2 4q4-5 8 0t8 0 8 0M-2 10q4-5 8 0t8 0 8 0" fill="none" stroke="#9bc0a5" stroke-width=".65" opacity=".12"/><path d="M2 0v2m8 4v2m-7 2v2m12-12v2" stroke="#c4d2ae" stroke-width=".6" opacity=".07"/></pattern>' +
    '<clipPath id="pn-clip"><path d="' + inner + '"/></clipPath></defs>';
  let out = defs + '<path d="' + outer + '" fill="#041016" stroke="#03090d" stroke-width="5" transform="translate(0 2)"/><path d="' + outer + '" fill="url(#pn-leather)" stroke="url(#pn-edge)" stroke-width="5"/><path d="' + inner + '" fill="none" stroke="url(#pn-gold)" stroke-width="1.7"/><path d="' + inset + '" fill="none" stroke="#debc78" stroke-opacity=".4" stroke-width=".7"/><g clip-path="url(#pn-clip)"><rect x="12" y="12" width="376" height="376" fill="url(#pn-grain)"/><path d="M25 24H375" stroke="#d0debb" stroke-opacity=".09" stroke-width="2"/></g>';
  out += '<g transform="translate(21 21)">' + cornerLeaf() + '</g><g transform="translate(379 21) scale(-1 1)">' + cornerLeaf() + '</g><g transform="translate(21 379) scale(1 -1)">' + cornerLeaf() + '</g><g transform="translate(379 379) scale(-1 -1)">' + cornerLeaf() + '</g>';
  [88, 338].forEach(function (y) {
    out += '<path d="M47 ' + y + 'H180m40 0h133" fill="none" stroke="url(#pn-gold)" stroke-width="1"/><path d="M200 ' + (y - 4) + 'l4 4-4 4-4-4Z" fill="url(#pn-gold)"/><path d="M189 ' + (y - 2) + 'l2 2-2 2-2-2Zm22 0 2 2-2 2-2-2Z" fill="#e9cc8b"/>';
  });
  return svg(400, 400, out, true);
}

function buttonSVG(kind) {
  const wine = kind === 'wine';
  const outer = cartouche(7, 8, 386, 83, 20);
  const inner = cartouche(16, 16, 368, 67, 14);
  const line = cartouche(22, 22, 356, 55, 10);
  const defs = '<defs>' +
    linear('bt-rim', [[0, '#fff7d3'], [.19, '#e3bc69'], [.38, '#9c6221'], [.59, '#ffdf99'], [.8, '#bb883c'], [1, '#6a4119']], 'x1="0" y1="0" x2="0" y2="1"') +
    linear('bt-face', wine ? [[0, '#8b3344'], [.21, '#742239'], [.54, '#571426'], [1, '#300b19']] : [[0, '#fff1b0'], [.17, '#f7d77c'], [.52, '#e7b54e'], [.77, '#dfa239'], [1, '#b47b27']], 'x1="0" y1="0" x2="0" y2="1"') +
    radial('bt-light', [[0, wine ? '#e29891' : '#fff3c3', wine ? .12 : .52], [1, wine ? '#dd928d' : '#fff0b7', 0]], 'cx="32%" cy="0%" r="95%"') +
    '<pattern id="bt-grain" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M0 2 9 7M-3 5 4 9M6 0 9 2" stroke="' + (wine ? '#e8b6ac' : '#fff6d1') + '" stroke-opacity=".1" stroke-width=".6"/><path d="M1 0 9 5M-1 6l4 3" stroke="' + (wine ? '#180811' : '#946020') + '" stroke-opacity=".12" stroke-width=".65"/></pattern>' +
    '<clipPath id="bt-clip"><path d="' + inner + '"/></clipPath></defs>';
  let out = defs + '<path d="' + outer + '" fill="#170c0b" stroke="#150b0a" stroke-width="5" transform="translate(0 3)"/><path d="' + outer + '" fill="url(#bt-rim)" stroke="#715024" stroke-width="1"/><path d="' + inner + '" fill="url(#bt-face)" stroke="' + (wine ? '#f8dc9f' : '#8d5921') + '" stroke-width="1.4"/><g clip-path="url(#bt-clip)"><rect x="12" y="12" width="376" height="78" fill="url(#bt-light)"/><rect x="12" y="12" width="376" height="78" fill="url(#bt-grain)"/></g><path d="' + line + '" fill="none" stroke="' + (wine ? '#d2a665' : '#fff0b4') + '" stroke-width=".8" stroke-opacity=".7"/><path d="M28 13H372M28 87H372" stroke="#ffebbc" stroke-width=".9" opacity=".7"/>';
  [24, 376].forEach(function (x) {
    out += '<path d="M' + x + ' 38l7 12-7 12-7-12Z" fill="url(#bt-rim)" stroke="#795025" stroke-width=".8"/><path d="M' + x + ' 42l4 8-4 8-4-8Z" fill="none" stroke="#fff0bd" stroke-width=".7"/>';
  });
  return svg(400, 100, out, true);
}

function iconSVG(key) {
  const icons = {
    table: '<ellipse cx="16" cy="9" rx="12" ry="4.5" fill="url(#ic-gold)" fill-opacity=".16"/><path d="M4 9v3c0 2.5 5.4 4.5 12 4.5s12-2 12-4.5V9M7 15 5 27m20-12 2 12M11 17l-1 7m11-7 1 7M4 27h3m18 0h3"/><path d="M6 8q10-5 20 0" stroke-opacity=".7"/>',
    door: '<path d="M17 5h10v23H16M5 7l13-4v26L5 25Z" fill="url(#ic-gold)" fill-opacity=".15"/><path d="M5 7v18l13 4V3ZM21 27h7M20 5h7v22M1 29h28"/><path d="M8 17h1.5" stroke-width="2.5"/>',
    book: '<path d="M16 7Q9 2 3 5v22q7-3 13 1 6-4 13-1V5q-7-3-13 2Z" fill="url(#ic-gold)" fill-opacity=".1"/><path d="M16 7v21M6 9q4-1 7 1m-7 4q4-1 7 1m-7 4q4-1 7 1m6-10q3-2 7-1m-7 6q3-2 7-1m-7 6q3-2 7-1M1 7v22q8-3 15 1 7-4 15-1V7"/>',
    records: '<path d="M7 3h14l5 5v21H7Z" fill="url(#ic-gold)" fill-opacity=".1"/><path d="M21 3v6h5M11 10h5m-5 5h10m-10 5h10m-10 5h5M4 7v23h19"/><path d="m18 24 2 2 4-4"/>',
    settings: ''
  };
  let name = Object.prototype.hasOwnProperty.call(icons, key) ? key : 'settings';
  if (name === 'settings') {
    const points = [];
    for (let i = 0; i < 8; i++) {
      [-19, -10, 10, 19].forEach(function (off, j) {
        const angle = (i * 45 + off) * Math.PI / 180;
        const r = j === 1 || j === 2 ? 13.6 : 10.3;
        points.push((16 + Math.cos(angle) * r).toFixed(2) + ' ' + (16 + Math.sin(angle) * r).toFixed(2));
      });
    }
    icons.settings = '<path d="M' + points.join('L') + 'Z" fill="url(#ic-gold)" fill-opacity=".1"/><circle cx="16" cy="16" r="4.6"/><circle cx="16" cy="16" r="2.2" stroke-width=".8" stroke-opacity=".45"/>';
  }
  const defs = '<defs>' + linear('ic-gold', [[0, '#fff3c3'], [.4, '#eac876'], [.73, '#bf8d3d'], [1, '#f3d791']], 'x1="0" y1="0" x2=".8" y2="1"') + '</defs>';
  return svg(32, 32, defs + '<g stroke="url(#ic-gold)" fill="none" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">' + icons[name] + '</g>');
}

module.exports = { sceneSVG, panelSVG, buttonSVG, iconSVG };
