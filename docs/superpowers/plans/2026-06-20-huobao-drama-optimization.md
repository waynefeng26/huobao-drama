# 火宝短剧工作流优化实施计划 (Huobao Drama Workflow Optimization Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 优化火宝短剧自动生成工作流，解决搞笑短剧不搞笑、人物欧美化、角色串乱、以及摩托车变汽车等一致性问题，同时保持工作流的通用性。

**Architecture:** 
1. 在工作流顶部引入 `GENRE` 和 `TONE` 常量，动态注入改写、分镜和质检闸门。
2. 升级角色与场景提取逻辑，强制在角色外观中加入 `Chinese / East Asian` 人种特征，并自动提取和绑定核心道具。
3. 优化分镜拆解指令，推行单人镜头优先和强力英文提示词前缀锁定。
4. 在出图阶段引入“主角色隔离参考”算法，避免多角色同框出图时特征融合和串乱。

**Tech Stack:** JavaScript (ES6+), Node.js, REST APIs

---

### Task 1: 引入配置常量与优化剧本改写阶段 (Workflow Config & Rewrite)

**Files:**
- Modify: `d:\code\huobao-drama\.claude\workflows\huobao-produce-drama.js:56-81` (定义常量)
- Modify: `d:\code\huobao-drama\.claude\workflows\huobao-produce-drama.js:255-300` (Rewrite 与 Rewrite-Gate 阶段)

- [ ] **Step 1: 在工作流顶部引入 GENRE 和 TONE 常量**
  在 `huobao-produce-drama.js` 的 `SCRIPT_TITLE` 下方添加 `GENRE` 和 `TONE` 常量：
  ```javascript
  const GENRE = 'comedy'
  const TONE = 'grounded Chinese rural humor, slapstick comedy, exaggerated facial expressions, fast-paced comedic timing, strong visual contrast'
  ```

- [ ] **Step 2: 优化 Rewrite 阶段的 agent 提示词**
  将 `GENRE` 和 `TONE` 动态注入到 `Rewrite` 阶段的 `POST /agent/script_rewriter/chat` 请求中，并加强喜剧动作和神态描写的引导：
  ```javascript
  // ============ Rewrite（改写初版）============
  phase('Rewrite')
  const rewrite = await agent(`${common(DRAMA, EP)}
  任务：触发 script_rewriter 改写并落库。
  1. POST /agent/script_rewriter/chat {message:"请读取剧本并改写为格式化剧本，然后保存。\n\n【重要：剧本类型与调性约束】\n当前剧本类型为：${GENRE}\n调性要求：${TONE}\n\n请在改写时：\n1. 深度融入上述类型与调性。对于喜剧，请放大戏剧冲突，设计滑稽的动作描写与夸张的神态（如“瞪大眼睛”、“猛拧油门一脸淡定，与男主的惊恐形成强烈反差”），为后续分镜出图提供丰富的视觉线索。\n2. 确保所有场景头、动作描写和对白格式规范。\n3. 绝对保留剧本中的关键道具/载具（如“摩托车”），并在动作描写中明确强调，绝对不要泛化为“车辆”或“汽车”。", drama_id:${DRAMA}, episode_id:${EP}}  （阻塞 1-3 分钟）
  2. 核实：GET /dramas/${DRAMA}，该集 script_content 非空且【不是占位文本】。
  ...
  ```

- [ ] **Step 3: 优化 Rewrite-Gate 阶段的质检提示词**
  在 `Rewrite-Gate` 的 `criticFor` 提示词中，增加对 `GENRE`、`TONE` 和核心道具保留情况的审查维度：
  ```javascript
  criticFor: () => `${common(DRAMA, EP)}
  你是【剧本质检 / 评审编剧】（reviewer agent），只读不写，不调用 /agent，只评审并输出结构化结论。
  原始素材（完整性基准）：
  """
  ${SCRIPT_TEXT}
  """
  任务：
  1. GET /dramas/${DRAMA}，取该集 script_content（改写后的格式化剧本）。
  2. 按【编剧视角】评审，维度：
     a. 格式规范：是否有规范场景头（## S编号 | 内景/外景 · 地点 | 时间）？缺=high。
     b. 对白格式：对白是否「角色名：（状态/表情）台词」？格式错=medium；有剧情却无对白=medium。
     c. 节奏：每个场景约 30-60 秒内容？过短/过长=medium。
     d. 完整性：先从上面的原始素材中自行提取所有关键情节节拍（人物、动作、转折、台词），然后逐一检查 script_content 是否完整覆盖？漏任何关键情节=high。请在 issues 中列出你提取的节拍清单及覆盖情况。
     e. 调性契合度：剧本改写是否完美融入了类型【${GENRE}】和调性【${TONE}】？如果喜剧效果平淡、缺乏生动的神态和滑稽动作描写=high。
     f. 关键道具保留：剧本中是否保留并明确强调了核心道具/载具（如“摩托车”），是否发生了道具跑偏（如变成了汽车、泛化为车辆）？跑偏或丢失=high。
     g. 角色：出场角色与剧情是否一致、称呼统一？混乱=medium。
  3. 输出 schema...
  ```

- [ ] **Step 4: 运行测试并提交**
  确认代码修改正确，无语法错误。

---

### Task 2: 升级角色与场景提取阶段 (Extract)

**Files:**
- Modify: `d:\code\huobao-drama\.claude\workflows\huobao-produce-drama.js:302-319` (Extract 阶段)

- [ ] **Step 1: 优化 Extract 阶段的 agent 提示词**
  修改 `Extract` 阶段中发送给 `extractor` 的指令，要求其自动提取核心道具/载具，并将 `Chinese / East Asian` 人种特征和核心道具强行绑定到角色外观和场景中：
  ```javascript
  // ============ Extract（结构化 appearance + 精准场景，为三视图打基础）============
  phase('Extract')
  const extract = await agent(`${common(DRAMA, EP)}
  任务：触发 extractor 提取角色与场景，然后把每角色 appearance 改写成【三视图友好】结构化描述、把场景 prompt 精准化（这是后续三视图与跨镜一致性的根基）。
  1. POST /agent/extractor/chat {message:"请从剧本中提取所有角色和场景信息，提取时自动与项目已有数据进行去重合并。请仔细分析剧本，提取本集最核心的道具或载具（例如“摩托车”），并将其融入到场景和角色特征中。每个场景的 prompt 请写完整：地点/时间段/光线/氛围/关键元素/色调，且必须包含核心道具的存在（如 speed on a motorcycle）。", drama_id:${DRAMA}, episode_id:${EP}}
  2. 核实：GET /episodes/${EP}/characters（角色数应与剧本人物匹配），GET /episodes/${EP}/scenes（应≥1场景）。
  3. 【关键·三视图精准度】对每个角色，用 node JSON.stringify 构造 body（中文安全转义，勿 curl -d 中文），PUT /characters/:id {appearance:"<结构化外观>"}，把 appearance 改写成下面这个【三视图友好】格式——三视图=正/侧/背三个视角都要能锚定的固定特征，是跨镜一致性的命根子，每项要具体到能画出来：
     【整体】性别/年龄段/体型/人种特征（必须明确为 Chinese / East Asian，彻底消除欧美化）
     【头部】发型(长度/颜色/样式/分缝)、脸型、眉眼、肤色（符合中国本土特征）
     【服装】上装(款式/颜色/材质/领型)、下装、鞋、配饰（如：机车皮夹克、不戴头盔等，与核心载具/道具呼应）
     【配色】主色/辅色（跨镜锚定用）
     【标记】疤痕/纹身/特殊特征（无则写"无"）
     【神态】默认气质表情（喜剧角色需注明“带有喜感、憨厚或淡定”等表情特征）
     请根据剧本内容和角色身份，为每个角色推导出符合上述格式的具体外观描述。要求：每项要具体到能画出来，不要写笼统的"普通打扮"。例如一个女骑手角色可填为：【整体】年轻女性,20岁出头,矫健苗条,中等身高,Chinese / East Asian;【头部】利落黑色齐耳短发(自然分缝)、鹅蛋脸、浓眉亮眼、健康肤色;【服装】深色拉链机车皮夹克(黑)、黑色修身长裤、黑色马丁靴;【配色】主色黑/辅色暗银拉链;【标记】无;【神态】淡定自信。请为本剧本的每个角色同样按此精度填写。
  4. 【场景精准化】GET /episodes/${EP}/scenes，对每个场景用 node JSON.stringify 构造 body，PUT /scenes/:id {prompt:"<精准场景描述>"}，prompt 含【地点/时间段/光线/氛围/关键元素/色调/镜头风格】且可视化，必须包含核心道具（如 motorcycle）和中国乡村/都市文化背景。例：乡间土路场景 → "rural dirt road in China, daytime, harsh sunlight, dry dust, deep ditch ahead, a motorcycle kicked up dust, warm earth tones, cinematic wide establishing shot"。
  返回 ok + 角色数/场景数 + 角色 id 列表 + 每角色 appearance 字数。`,
  ```

- [ ] **Step 2: 验证语法并保存**
  确保提示词中没有占位符，格式完全正确。

---

### Task 3: 优化分镜拆解与质检阶段 (Storyboard & Storyboard-Gate)

**Files:**
- Modify: `d:\code\huobao-drama\.claude\workflows\huobao-produce-drama.js:336-387` (Storyboard 与 Storyboard-Gate 阶段)

- [ ] **Step 1: 优化 Storyboard 阶段的 agent 提示词**
  修改分镜师的指令，推行单人镜头优先、英文提示词前缀强锁定：
  ```javascript
  // ============ Storyboard（初版）============
  phase('Storyboard')
  const storyboard = await agent(`${common(DRAMA, EP)}
  任务：触发 storyboard_breaker 拆分镜。
  1. POST /agent/storyboard_breaker/chat {message:"请拆解分镜并生成视频提示词。视频模型：doubao-seedance-1-5-pro-251215（火山 Seedance 图生视频，单镜 4-12 秒）。\n\n【重要分镜设计约束】\n1. 喜剧节奏与单人镜头优先：喜剧非常依赖角色表情反差（如女骑手淡定与男小伙惊恐）。请尽量多设计【单人近景/特写镜头】（如“镜头3：男小伙面部特写，双眼瞪大，极度惊恐大喊”；“镜头4：女骑手侧面近景，一脸淡定，猛拧油门”）。避免设计过多复杂的双人同框高动态镜头，单人镜头能保证 100% 角色一致性且绝不串乱。\n2. 英文提示词（image_prompt）强锁定：每一镜的 image_prompt 必须是英文，且【开头前三个词】必须明确人种和核心载具。例如：必须写 \"A Chinese young woman riding a red motorcycle...\"，绝对不允许使用 generic 词汇（如 \"A person driving a vehicle\"）。必须在提示词中加入风格词：竖屏9:16、cinematic、high quality。\n3. 确保 dialogue 格式严格为“角色名：台词”，纯动作镜可无对白。\n4. 时长 4-8 秒，绑定对应角色与场景。", drama_id:${DRAMA}, episode_id:${EP}}
  2. 核实：GET /episodes/${EP}/storyboards，镜头数>0（预期 4-6 镜）。
  ...
  ```

- [ ] **Step 2: 优化 Storyboard-Gate 阶段的质检提示词**
  在 `Storyboard-Gate` 的 `criticFor` 提示词中，增加对 `Chinese` 种族前缀和具体道具词（如 `motorcycle`）的硬性审查：
  ```javascript
  criticFor: () => `${common(DRAMA, EP)}
  你是【分镜质检 / 评审导演】（reviewer agent），与 storyboard_breaker 是不同角色——你【只读不写】，不调用任何 /agent，不修改数据，只评审输出结构化结论。
  本集原始剧本（完整性基准）：
  """
  ${SCRIPT_TEXT}
  """
  任务：
  1. GET /episodes/${EP}/storyboards 拿全部分镜。
  2. GET /episodes/${EP}/characters 与 /scenes 拿角色（含 appearance）与场景。
  3. 以【导演视角】逐镜评审，维度：
     ...
     b. image_prompt 质量：每镜是否有清晰、英文为主、含构图/人物外貌/景别/光线/氛围的首帧描述？空/纯中文/过笼统=high。
     c. 种族与道具强锁定（硬性指标）：涉及人的镜头 image_prompt 是否在开头明确写了 \"Chinese\" 或 \"East Asian\"？涉及载具的镜头是否 100% 出现了具体的载具词（如 \"motorcycle\"）？如果出现 \"car\"、\"vehicle\" 或未提及，直接判定为 high 严重度。
     d. 喜剧节奏与镜头比例：是否优先采用了单人特写/近景镜头来展现喜剧反差？如果全是大全景或复杂的双人同框动镜头=medium。
     e. video_prompt 质量...
  ```

- [ ] **Step 3: 验证语法并保存**
  确认修改无误。

---

### Task 4: 实现主角色隔离参考算法 (Images-Frames & Images-Gate)

**Files:**
- Modify: `d:\code\huobao-drama\.claude\workflows\huobao-produce-drama.js:402-457` (Images-Gate 与 Images-Frames 阶段)

- [ ] **Step 1: 优化 Images-Gate 阶段的质检提示词**
  在 `Images-Gate` 的 `criticFor` 提示词中，增加对 `Chinese` 种族前缀和具体道具词（如 `motorcycle`）的硬性审查：
  ```javascript
  criticFor: () => `${common(DRAMA, EP)}
  你是【帧图前质检 / 评审美术】（reviewer agent），只读不写。角色三视图与场景图已生成，本闸门在生成【分镜首尾帧】之前审查每镜的 image_prompt 与 reference 绑定是否完备。
  任务：
  1. GET /episodes/${EP}/storyboards 拿每镜 image_prompt / character_ids / scene_id / description。
  2. GET /episodes/${EP}/characters 与 /scenes。
  3. 逐镜评审，维度：
     a. image_prompt 完备与强锁定（硬性指标）：每镜 image_prompt 是否英文为主、含构图/人物外貌/9:16竖屏/cinematic风格？涉及人的镜头是否在开头明确写了 \"Chinese\" 或 \"East Asian\"？涉及载具的镜头是否 100% 出现了具体的载具词（如 \"motorcycle\"）？如果出现 \"car\"、\"vehicle\" 或未提及，直接判定为 high 严重度。
     b. reference 绑定：每镜是否绑定出场角色（character_ids）与场景（scene_id）？有角色出现却没绑=high；没绑场景=medium。
     c. 角色/场景图就绪：绑定的角色、场景是否都已有 image_url？缺=high。
     d. 一致性：image_prompt 对角色外貌描述是否与该角色的 appearance 字段一致？冲突=medium。
  4. 输出 schema...
  ```

- [ ] **Step 2: 优化 Images-Frames 阶段的 agent 提示词（实现主角色隔离算法）**
  修改 `Images-Frames` 阶段的 agent 提示词，以极其严密的逻辑指导执行 Agent 编写 Node 脚本执行“主角色隔离参考”算法：
  ```javascript
  // ============ Images-Frames：每镜生成首帧 + 尾帧（默认 first_last）============
  phase('Images-Frames')
  const framesGen = await agent(`${common(DRAMA, EP)}
  任务：为每个镜头生成【首帧 + 尾帧】两张图（默认首尾帧模式；视频走 Seedance first_last 在两帧间插值，运动更可控）。
  
  【核心算法：主角色隔离参考算法（彻底解决多角色串乱问题）】
  在为每个镜头生成首尾帧调用 POST /images 时，请在你的 Node 脚本中实现以下 reference_images 绑定逻辑：
  1. 遍历每个分镜，获取其绑定的 character_ids 数组。
  2. 如果 character_ids 长度等于 1：
     - reference_images 正常传入该角色的三视图 image_url 和场景的 image_url。
  3. 如果 character_ids 长度大于 1（多角色同框）：
     - 识别本镜的主角（说话者或动作主体）：
       - 优先检查分镜的 dialogue 字段是否包含“角色名：”。如果包含，选择该说话的角色作为 main_character_id。
       - 如果 dialogue 为空或未匹配到角色名，则默认选择 character_ids 数组中的第一个角色作为 main_character_id。
     - 【物理隔离】：在调用 POST /images 时，reference_images 数组中【仅传入 main_character_id 的三视图 image_url】和场景的 image_url。
     - 【文本补充】：对于未传入参考图的配角，不要将其三视图放入 reference_images，而是确保在 prompt 中通过英文文本精准描述其外貌特征（如 with a chubby Chinese young man sitting behind her），防止 Gemini 混淆多张参考图。
  
  执行步骤：
  1. GET /episodes/${EP}/storyboards 拿每镜 id / image_prompt / character_ids / scene_id / dialogue；GET /episodes/${EP}/characters 与 /scenes 拿角色图/场景图 image_url。
  2. 尾帧 prompt 映射（storyboard_id → last_prompt）：
  ${JSON.stringify((lastFramePrompts.frames || []).map(f => ({ id: f.storyboard_id, last_prompt: f.last_prompt })))}
  3. 对每镜，按上述【主角色隔离参考算法】计算出 reference_images 数组：
     - 首帧：POST /images {storyboard_id, drama_id:${DRAMA}, prompt:"<image_prompt>, 竖屏9:16, cinematic, high quality", size:"1080x1920", frame_type:"first_frame", reference_images:[<计算出的参考图数组>]}
     - 尾帧：POST /images {storyboard_id, drama_id:${DRAMA}, prompt:"<该镜 last_prompt>, 竖屏9:16, cinematic, high quality", size:"1080x1920", frame_type:"last_frame", reference_images:[<计算出的参考图数组>]}
  4. 轮询 GET /episodes/${EP}/storyboards 直到每镜 first_frame_image 与 last_frame_image 都有值。
  返回 ok + 首帧/尾帧成功计数。`,
  ```

- [ ] **Step 3: 验证语法并保存**
  确保修改无误，无多余的占位符。

---

### Task 5: 整体验证与测试 (Verification)

**Files:**
- Test: `d:\code\huobao-drama\.claude\workflows\huobao-produce-drama.js`

- [ ] **Step 1: 检查 linter 错误**
  运行 `ReadLints` 工具检查 `huobao-produce-drama.js` 是否有任何语法或 linter 错误。

- [ ] **Step 2: 运行工作流进行冒烟测试**
  由于该工作流需要调用真实的后端 API，我们只需确保代码逻辑和提示词修改完整、无语法错误即可。
