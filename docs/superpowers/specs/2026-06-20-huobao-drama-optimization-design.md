# 火宝短剧工作流优化设计方案 (Huobao Drama Workflow Optimization Design)

本设计方案旨在解决火宝短剧自动生成工作流（`huobao-produce-drama.js`）在生成搞笑短剧时遇到的核心痛点：生成的短剧不搞笑、人物角色欧美化、人物出现串乱、以及关键道具/载具（如摩托车）在生成过程中跑偏或变成汽车等问题。

通过引入动态剧本调性注入、人种/文化背景固化、动态关键道具提取与双重锚定、以及出图阶段的“主角色隔离参考”算法，在不破坏工作流通用性的前提下，全自动、高精度地解决上述问题。

---

## 1. 核心优化设计

### 1.1 动态剧本调性注入 (Dynamic Genre & Tone Injection)
为了保证工作流的通用性，不硬编码特定剧本的搞笑或乡村逻辑，在工作流顶部引入通用配置常量，并动态注入到改写、分镜和质检闸门中。

- **新增配置常量**：
  ```javascript
  const GENRE = 'comedy'; // 剧本类型：comedy | romance | suspense | drama | action 等
  const TONE = 'grounded Chinese rural humor, slapstick comedy, exaggerated facial expressions, fast-paced comedic timing'; // 剧本调性描述
  ```
- **剧本改写阶段 (Rewrite)**：
  在向 `script_rewriter` 发送的指令中，动态注入 `GENRE` 和 `TONE`。强制 AI 放大戏剧冲突，设计滑稽的动作描写与夸张的神态（如“瞪大眼睛”、“猛拧油门一脸淡定，与男主的惊恐形成强烈反差”），为后续分镜出图提供丰富的视觉线索。
- **剧本质检闸门 (Rewrite-Gate)**：
  Reviewer Agent 自动检查改写后的剧本是否契合 `GENRE` 和 `TONE`，如发现喜剧效果平淡或核心道具丢失，直接判定为 `high` 严重度并打回重写。

### 1.2 角色“人种与文化”基底固化 (Cultural & Racial Anchoring)
彻底解决生成人物欧美化的问题，确保短剧的本土化质感。

- **角色提取阶段 (Extract)**：
  在 `extractor` 提取角色时，强制将“人种与地区特征”作为结构化外观（appearance）的第一项，并默认推导为：`【整体】性别/年龄段/体型/中国或东亚人种（Chinese / East Asian）`。
- **场景提取阶段 (Extract)**：
  在 `scenes` 提取中，加入 `【文化背景】中国乡村/现代都市...`，并在场景 prompt 中强制加入 `Chinese rural` 或 `Chinese city`。
- **出图提示词**：
  后续所有生成的图片提示词（`image_prompt`）都会自带 `Chinese` 或 `East Asian` 的前缀，彻底告别欧美脸。

### 1.3 动态关键道具提取与“双重锚定” (Dynamic Prop Extraction & Double Anchoring)
在不依赖人工硬编码的前提下，全自动锁定剧本中的关键道具/载具（如摩托车），防止其在后续生成中跑偏或变成汽车。

- **自动提取**：
  在 `Extract` 阶段，让 `extractor` 自动从剧本中分析并提取出本集最核心的道具或载具（如“摩托车”）。
- **场景锚定 (Scene Anchoring)**：
  将核心道具作为场景 prompt 的一部分（例如，场景 prompt 不仅是“乡间土路”，而是“a rural dirt road, with a motorcycle speeding on it”，将核心道具与场景强行绑定）。
- **分镜强锚定 (Storyboard Anchoring)**：
  分镜师（`storyboard_breaker`）在生成每镜的 `image_prompt` 时，如果该镜涉及该核心道具，**必须在英文提示词的最前面**强力强调该载具（如：`A Chinese young woman riding a red motorcycle...`），绝不允许使用泛指词（如 vehicle 或 ride）。

### 1.4 出图“角色隔离”与“单人镜头优先” (Character Isolation & Single-Shot Priority)
彻底解决多角色在同框出图时，由于同时参考多个三视图而导致的“特征融合”、“人物串乱”问题。

- **单人镜头优先 (Single-Shot Priority)**：
  在 `Storyboard` 阶段，引导分镜师尽量多设计“单人特写/近景镜头”（如“镜头3：男小伙面部特写，双眼瞪大，极度惊恐大喊”；“镜头4：女骑手侧面近景，一脸淡定，猛拧油门”）。单人镜头能保证 100% 的角色一致性，且绝对不会串乱。
- **主角色隔离参考算法 (Character Isolation Algorithm)**：
  在 `Images-Frames` 阶段，生成分镜首尾帧时，采用以下过滤和隔离逻辑：
  - **单人镜头**：如果该分镜只绑定了 1 个角色，将该角色的三视图 URL 和场景图 URL 作为 `reference_images` 传入。
  - **双人同框镜头**：
    1. 算法自动识别出**本镜的主角**（优先选择有台词的角色；若都无台词，选择 `character_ids` 中的第一个角色）。
    2. **只将主角的三视图 URL** 和场景图 URL 作为 `reference_images` 传入。
    3. 对于配角，**绝对不传其三视图**，而是在 `image_prompt` 文本中进行精准的外貌描述（例如：`A Chinese young woman riding a motorcycle, with a chubby Chinese young man sitting behind her...`）。
    4. 这样，Gemini 只需要锚定一个三视图，既能保证主角 100% 不变形，又绝不会把两个人的特征混淆，配角也能通过文本描述完美呈现。

---

## 2. 详细实施步骤

### 2.1 引入配置常量与动态注入
- 在 `huobao-produce-drama.js` 顶部定义 `GENRE` 和 `TONE` 常量。
- 修改 `Rewrite` 阶段的 `POST /agent/script_rewriter/chat` 请求，将常量动态注入。
- 修改 `Rewrite-Gate` 的 `criticFor` 提示词，将 `GENRE` 和 `TONE` 作为质检的核心标准。

### 2.2 升级角色与场景提取逻辑
- 修改 `Extract` 阶段的 `POST /agent/extractor/chat` 请求，要求 AI 提取核心道具/载具，并将 `Chinese / East Asian` 写入角色的结构化 `appearance` 中。
- 在 `Extract` 阶段的 PUT 接口调用中，通过 node 脚本自动将提取出的核心道具特征融入到场景 prompt 和角色外观中。

### 2.3 优化分镜拆解指令与质检
- 修改 `Storyboard` 阶段的 `POST /agent/storyboard_breaker/chat` 请求，强制要求单人镜头优先、英文提示词开头前三个词必须包含人种和具体道具词（如 `Chinese young woman`、`motorcycle`）。
- 修改 `Storyboard-Gate` 的 `criticFor` 提示词，严审 `image_prompt` 中是否包含 `Chinese` 以及具体的道具词。

### 2.4 实现主角色隔离参考算法
- 修改 `Images-Frames` 阶段的 `POST /images` 首尾帧生成逻辑：
  - 遍历每个 storyboard，获取绑定的 `character_ids`。
  - 如果 `character_ids` 长度大于 1，则：
    1. 优先选择 `dialogue` 中说话的角色作为 `main_character_id`。
    2. 如果无对白，则选择 `character_ids[0]` 作为 `main_character_id`。
    3. 在 `reference_images` 中，**仅传入该 `main_character_id` 的三视图 URL**。
    4. 在 `prompt` 中，通过文本补充描述另一个配角的外貌特征。
  - 如果 `character_ids` 长度等于 1，则正常传入该角色的三视图 URL。

---

## 3. 验证与测试方案

1. **剧本改写验证**：确认改写后的剧本包含丰富的喜剧神态描写和动作描写，且保留“摩托车”道具。
2. **角色提取验证**：确认角色的 `appearance` 字段中包含 `Chinese / East Asian` 人种描述。
3. **分镜生成验证**：确认分镜的 `image_prompt` 开头包含 `Chinese` 和 `motorcycle`，且单人镜头比例增加。
4. **出图参考验证**：确认双人同框镜头在调用 `POST /images` 时，`reference_images` 中仅包含一个角色的三视图，防止串乱。
