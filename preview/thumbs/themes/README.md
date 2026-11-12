# 多主题插画

2026-11-11 通过 9Router 的 `ag/gemini-3.1-flash-image` 生成三套 3×3 插画图集，
再由 `preview/prepare-theme-art.py` 去除分格细线并压缩为 480×480 JPEG。
原始大图保存在工程外；常规构建只依赖这里的三个轻量成品。

- `pokemon.jpg`：皮卡丘、妙蛙种子、杰尼龟、小火龙、伊布、可达鸭、卡比兽、快龙、耿鬼的冒险插画。
- `cyberpunk.jpg`：霓虹街区、义体信使、高架列车、服务器、黑客、无人机、骑手、温室与机械乌鸦。
- `ai.jpg`：2026-11-12 按社区拟人调研重绘，顺序固定为 GPT 白龙、Claude 橙发向日葵、Gemini 星形猫耳、DeepSeek 鲸鱼、Qwen 国风折扇、Grok 金发哥特、Llama 羊驼、GLM 黑白狐、豆包 Seed。

图片不包含卡牌数值和操作文字。卡牌身份、成本、声望与资源颜色均由游戏数据层提供。
拟人角色为本项目的主题演绎，不作为模型供应商的官方角色形象。

`preview/theme-art.js` 将图集一次性内嵌到各主题的独立样式文件，
再使用背景位置映射到卡牌、贵族、头像与主题预览，避免每张卡重复内嵌图片。

## AI 图集第二版

- 生成模型：9Router `ag/gemini-3.1-flash-image`，2026-11-12。
- 角色参考与原作链接：[AI 拟人调研](../../../docs/ai-persona-research.md)。按角色识别元素重新生成插画，未把参考站的缩略图放入游戏资源。
- 完整生成提示词：[ai-prompt.txt](ai-prompt.txt)。原始图为 1024×1024，保存在工程外。
- 成品为 480×480 JPEG，共 52082 字节，九格各 160×160；压缩参数为 quality 60、optimize true、非渐进 JPEG。
- 格子顺序与 `utils/theme.js` 中的模型名称顺序对应，不可单独交换图片或名称。

仅更新 AI 图集时，把原始图命名为 `splendor-ai-atlas.png` 并执行：

```sh
uv run --with pillow python preview/prepare-theme-art.py SOURCE_DIRECTORY ai
```

省略最后的主题参数时仍处理全部三套图集。常规构建继续执行 `node preview/art.js` 和 `node preview/build.js`。
