'use strict';

// 云服务客户端只在此初始化一次。未执行「构建 npm」或 SDK 不可用时，
// 捕获异常降级为本地房间，避免整个小程序白屏。
try {
  require('./utils/cloud.js');
} catch (err) {
  console.warn('[splendor] 云端能力未就绪，使用本机房间');
}

App({
  globalData: {
    appName: '璀璨宝石',
  },
});
