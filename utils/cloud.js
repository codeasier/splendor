'use strict';

/**
 * 小程序端唯一的云服务客户端 —— 只在 app.js 里 require 一次。
 *
 * 为什么内置 SDK 而不 require npm 包：
 *  小程序运行时不认识 node_modules，必须先「构建 npm」生成 miniprogram_npm。
 *  体验版发布链路里这一步不一定被执行，一旦缺失，require 直接抛错，
 *  云端会静默降级成本机房间 —— 表现就是「好友点了分享卡也进不来」。
 *  因此这里直接引用由 miniprogram_dist 复制而来的自包含产物（166KB，CJS 无外部依赖），
 *  不依赖任何构建步骤。升级 SDK 时重新复制该文件并更新下面的版本注释即可。
 *
 * source: @tencent-ai/workbuddy-cloud-sdk@0.1.4-dev.ca27990.202610161713
 *         node_modules/@tencent-ai/workbuddy-cloud-sdk/miniprogram_dist/miniprogram.js
 *
 * 边界：
 *  - H5 预览（preview/build.js）不执行 app.js，本文件不会被内联，
 *    utils/room.js 未收到 attachCloud 注入，自动保持本机房间模式。
 *  - publicConfig 是应用级公开配置，可随前端下发；不允许凭空改写 endpoint，
 *    也不允许把任何服务端密钥写进这里。
 */

const room = require('./room.js');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics.js');

const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_dMWuI8yncN03Dvu2hHuqAT_lhbqSu9Ko3bBptFKcj6cyOk7KHkCffId'
};

// Node / 浏览器里没有全局 wx，此时不初始化，避免 require 阶段直接抛错。
const wxApi = typeof wx !== 'undefined' ? wx : null;
let cloud = null;

if (wxApi) {
  // 任何一步失败都要把原因登记到 room.js：
  // 否则界面只能看到「没有云客户端」，并把它误报成「设备离线」。
  try {
    const sdk = require('./vendor/workbuddy-cloud-sdk.js');
    if (typeof sdk.createMiniProgramWorkBuddyCloud !== 'function') {
      throw new Error('云 SDK 缺少 createMiniProgramWorkBuddyCloud');
    }
    cloud = sdk.createMiniProgramWorkBuddyCloud({
      endpoint: publicConfig.endpoint,
      publishableKey: publicConfig.publishableKey,
      wx: createDiagnosticWx(wxApi)
    });
    if (!cloud || !cloud.database) throw new Error('云客户端未返回 database');
  } catch (err) {
    cloud = null;
    const reason = (err && err.message) || '云服务初始化失败';
    room.attachCloudFailure(reason);
    console.warn('[splendor] 云服务未就绪：' + reason);
  }
  // 注入到 RoomAdapter，房间层不需要（也不应该）自己 require SDK。
  if (cloud) room.attachCloud(cloud);
}

module.exports = {
  cloud: cloud,
  publicConfig: publicConfig
};
