# AI 大模型拟人形象调研

调研日期：2026-11-12。范围以中文 B 站「AI 娘」二创圈为主，覆盖现有九个模型。关联：[主题分析与实现记录](theme-style-analysis.md)。

## 结论

初版 `preview/thumbs/themes/ai.jpg` 是按模型品牌色和职业想象生成的九个实验室人物，与近期社区传播的角色识别符明显脱节。用户确认继续后，2026-11-12 已按下述九角色参考重绘并接入游戏，见「重绘落地」。

本次先用 `websearch` 查找线索，再读取社区角色档案、作品详情与 B 站原始来源，实际查看九角色参考图。搜索摘要中出现的「Gemini 绿发」「Grok 紫黑极客」不能直接当作该圈的通行设定。

## 证据边界

- 这些是民间二创形象，不是厂商官方人设，也没有全网唯一版本。
- 「蓝色大肥鱼」档案可追踪画师、作品、原始链接与收录时间；九图对照采用 ZipZipPipe 的同系列，便于避免拼接不同版本。站内也有 @798145343h、@linguanus 等其他作者的变体。
- 访问时该档案收录 DeepSeek 1368、Claude 231、GPT 215、Gemini 119、Grok 67、GLM 37、Qwen 31、豆包 20、Llama 2 件作品。这只是单站收录快照，不能解释为全网热度排行；尤其不能把 Llama 的单一立绘称为共识。
- 档案标注的是收录日期，不一定是创作日期。例如 Claude 参考页于 10 月 3 日收录，而其链接的 B 站动态发表于 8 月 24 日。

## 九角色对照

下列特征指向所链接的具体社区版本；「强 / 中 / 弱」表示本次样本的交叉支持程度，不是模型能力评分。

| 模型 | 社区样本中的识别元素 | 初版图的问题 | 样本支持 |
| --- | --- | --- | --- |
| GPT / ChatGPT | 白色长发、龙角、龙翼、鳞片龙尾、白色礼裙，即「白龙娘」 | 绿发男性策略师，没有龙系轮廓 | 中：多张不同作者白龙立绘与社区档案互证 |
| Claude | 橙色长发，橘白黑礼服、书籍、向日葵纹饰；社区另有「小 C / 圣女」叙事 | 橙发与书保留了部分方向，但现代职业装缺少礼服与头饰 | 强：多作者变体、B 站原作与近期评论文章互证 |
| Gemini | 紫蓝渐变长发、猫耳猫尾、四角星、异色瞳，即双子猫娘路线 | 蓝发男性宇航员，仅有太空环境，缺少角色轮廓 | 中：同系列原案与其他作者猫耳 / 双星变体互证 |
| DeepSeek | 蓝发、鲸鳍耳饰、鲸尾、蓝白女仆装；「大肥鱼 / 鲸鱼娘」 | 蓝发男性研究员和旁边的鲸鱼投影不能替代鲸鱼娘自身的特征 | 强：大量收录与近期文章互证；同时存在男性「D 老师」路线，不应混为一套 |
| Qwen / 通义千问 | 所选系列是蓝紫长发、蓝白国风长裙、折扇、云纹；另有绿发国风和紫发校服版 | 紫色商务套装只能识别品牌色，未对应具体原案 | 弱：多路线并存，需明确选择国风版本 |
| Grok | 所选系列是金色双马尾、尖耳、黑金哥特长裙、暗红衬里、X 纹双刃斧 | 黑发眼镜工程师没有这些标识 | 中：同系列与舞台变体支持该路线；不等同于所有 Grok 形象 |
| Llama | 所选系列是奶白卷发、羊驼 / 兽耳元素、宽松居家服、Meta 无限符号与羊驼拖鞋 | 银发男性发明家没有羊驼特征 | 弱：该站仅 2 件作品，视为明确作者版本，而非广泛共识 |
| GLM / 智谱 | 黑色长发、阔耳狐耳与狐尾、黑白裙装、蓝色缎带、Z 标书册 | 绿色晶核学者既无黑白狐轮廓，也无书册标识 | 中：多张黑白狐耳版本互证 |
| 豆包 / Seed | 所选系列是紫蓝马尾、白紫科技服、SEED 工牌，抱着黑发豆包玩偶；另有黑短发日常 / 女仆版 | 棕发男性耳机创作者没有选定版本的标识 | 弱：几种设计并存，不能把紫蓝马尾宣称为唯一设定 |

## 可直接查看的参考图

以下为社区档案的在线缩略图，仅作为调研参考，未加入游戏运行资源。

| GPT | Claude | Gemini |
| --- | --- | --- |
| ![GPT 白龙娘](https://xn--pssy23gqgbz2d718b.com/character-portraits/gpt-bc474c23ab3e5436.webp) | ![Claude 橘白礼服](https://xn--pssy23gqgbz2d718b.com/character-portraits/claude-58a440fa7cfce28b.webp) | ![Gemini 双子猫娘](https://xn--pssy23gqgbz2d718b.com/character-portraits/gemini-8ef873ac32a6e74c.webp) |

| DeepSeek | Qwen | Grok |
| --- | --- | --- |
| ![DeepSeek 鲸鱼娘](https://xn--pssy23gqgbz2d718b.com/character-portraits/deepseek-35015284f47eb01b.webp) | ![Qwen 国风折扇](https://xn--pssy23gqgbz2d718b.com/character-portraits/qwen-21895325d9001844.webp) | ![Grok 金发哥特](https://xn--pssy23gqgbz2d718b.com/character-portraits/grok-d6dcdd75f1c68cb7.webp) |

| Llama | GLM | 豆包 |
| --- | --- | --- |
| ![Llama 羊驼居家服](https://xn--pssy23gqgbz2d718b.com/character-portraits/llama-8a301deb37e472d8.webp) | ![GLM 黑白阔耳狐](https://xn--pssy23gqgbz2d718b.com/character-portraits/glm-2407ee7b72653b36.webp) | ![豆包 Seed 科技少女](https://xn--pssy23gqgbz2d718b.com/character-portraits/doubao-ed3bb7ead96ce2b5.webp) |

## 建议的下一版美术约束

1. 先以这一套 AI 娘社区版本为九角色设计基准，保留角色头部、耳 / 角、尾部、服装主轮廓与标志物，再统一成适合桌游卡牌的画风。
2. 单格以清楚的半身 / 四分之三身为主。Gemini 的星形猫耳、GPT 的龙角与翼根、DeepSeek 的鲸鳍和鲸尾应能在小卡面认出；避免用满屏实验室代替角色特征。
3. 图集顺序固定为 GPT、Claude、Gemini、DeepSeek、Qwen、Grok、Llama、GLM、豆包，对应现有命名和槽位。每幅画面只出现一个主角色。
4. Qwen、豆包、Llama 应注明选定版本；如果后续要按热度替换角色，需要另外决定九人名单，不能通过调换图片破坏名字对应。
5. 参考图详情多标注「授权状态不明」，DeepSeek 页另说明鲸鱼娘基于「上善无形」角色及非商业协议。重绘前应按选定原案核对来源与可用范围，不能把档案缩略图当成已获授权的游戏素材。

## 重绘落地（2026-11-12）

用户确认按此方向继续后，通过 9Router `ag/gemini-3.1-flash-image` 重新生成九格插画。完整提示词保存在 [ai-prompt.txt](../preview/thumbs/themes/ai-prompt.txt)，压缩处理和来源说明见 [素材 README](../preview/thumbs/themes/README.md)。

![已接入游戏的新版 AI 九格图集](../preview/thumbs/themes/ai.jpg)

- 排列仍为 GPT、Claude、Gemini、DeepSeek、Qwen、Grok、Llama、GLM、豆包，与卡牌命名及样式槽位一致。
- 新版明确保留龙角 / 龙翼、向日葵、四角星猫耳、鲸尾、折扇、X 纹战斧、羊驼、黑白狐与豆包玩偶等识别元素。
- 生成大图为 1024×1024，游戏成品为 480×480 JPEG、52082 字节；继续每主题仅内嵌一次。
- 浏览器逐一检查九角色卡名与背景位置，查看 1440×810 桌面、844×390 手机横屏及 GPT 详情；市场卡名无越界。
- 完整回归 12/12 通过。原生运行文件约 2017.8 KB，H5 与原生体积守卫均通过。

社区原案参考与本项目生成插画分别记录；这里不把社区版本宣称为模型厂商官方形象。

## 来源索引

| 角色 | 社区档案 / 作品说明 | 档案所列原作链接 |
| --- | --- | --- |
| GPT | [白龙娘立绘](https://xn--pssy23gqgbz2d718b.com/works/gpt202610170006.html) | [B 站原始动态](https://www.bilibili.com/opus/1238613841710940181) |
| Claude | [橘白礼服版](https://xn--pssy23gqgbz2d718b.com/works/claude202610030001.html) | [B 站原始动态，已打开核对](https://www.bilibili.com/opus/1239937623660691478) |
| Gemini | [紫蓝渐变与四角星猫耳](https://xn--pssy23gqgbz2d718b.com/works/gemini202610170002.html) | 档案未提供具体原帖；署名 [ZipZipPipe](https://space.bilibili.com/4168597) |
| DeepSeek | [蓝白女仆与鲸尾](https://xn--pssy23gqgbz2d718b.com/works/deepseek202610170005.html) | [B 站原始动态](https://www.bilibili.com/opus/1207046545083465747) |
| Qwen | [国风长裙与折扇](https://xn--pssy23gqgbz2d718b.com/works/qwen202610170001.html) | [B 站原始动态](https://www.bilibili.com/opus/1239583108485873687) |
| Grok | [黑金裙与 X 纹战斧](https://xn--pssy23gqgbz2d718b.com/works/grok202610170001.html) | [B 站原始动态](https://www.bilibili.com/opus/1242345863367360520) |
| GLM | [阔耳狐与 Z 标黑书](https://xn--pssy23gqgbz2d718b.com/works/glm202610170001.html) | [B 站原始动态](https://www.bilibili.com/opus/1239259160558698497) |
| 豆包 | [Seed 科技风与豆包玩偶](https://xn--pssy23gqgbz2d718b.com/works/doubao202610170001.html) | [B 站原始动态](https://www.bilibili.com/opus/1240293504667615233) |
| Llama | [羊驼拖鞋与居家卫衣](https://xn--pssy23gqgbz2d718b.com/works/llama202610170001.html) | 档案未提供具体原帖；署名 ZipZipPipe |

交叉来源：[2026-10-22 社区评论，DeepSeek 鲸鱼娘与 Claude 圣女对照](https://zhuanlan.zhihu.com/p/2096410686440083536)。其他作者变体见各角色档案的立绘与设定区。
