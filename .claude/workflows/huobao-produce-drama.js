// ============================================================
// 火宝短剧：原始剧本 → 一集成片 全自动工作流（v5：v4 基础 + 角色三视图设定图 + 结构化 appearance）
// 复用方法：只改下面 SCRIPT_TITLE / STYLE / SCRIPT_TEXT 三个常量即可跑别的剧本。可选配置：CHARACTER_REFERENCES（角色参考图）、VOICE_MAP（角色音色映射）。
// ⚠️ 不要用 args 传剧本（本环境里 args 会变 undefined，v1 就是这么坏的）。
// 依赖：火宝后端在 http://localhost:5679 运行，4 类 AI 服务已在「设置」配好。
// 音频修复在后端 ffmpeg-compose.ts（无对白镜保留视频原生音轨），本工作流自动受益。
//
// v4 新增（对标 gstack review gate / ArcReel 阶段间确认）：
//   1) 三道质量闸门 —— 剧本改写(Rewrite-Gate)、分镜(Storyboard-Gate)、出图前(Images-Gate)
//      各插入一个【独立 reviewer agent，只读不写】，按维度评审；不通过则把意见回灌给生成方返工。
//      生成≠评审，正是软件工程「开发 ≠ 代码评审」的分工。
//   2) 分数回退回滚保护 —— 返工前快照当前版；若返工后复审分数 < 返工前，则用快照回滚后端到上一版并停止
//      （避免 LLM 非确定性导致「越改越差」）。三道闸门共用 qualityGate() 控制流。
//   3) 默认首尾帧 —— 每镜生成 first_frame + last_frame 两张图，视频走 Seedance first_last 模式在两帧间
//      插值，运动起止明确、对叙事镜头（飞跃/摔落/转头）更可控。代价：每镜多 1 张图（成本/时间约翻倍）。
//   返工安全性：script_rewriter 的 saveScript、storyboard_breaker 的 saveStoryboards 都是覆盖式保存，
//   重跑不会重复累积；Images 闸门放在【烧图之前】只审 prompt/reference（文本 critic 看不了图），
//   所以三道闸门的回滚都不需要改后端。
//
// v5 新增（角色一致性·三视图）：Extract 把每角色 appearance 改写为【三视图友好】结构化固定特征
//   （整体/头部/服装/配色/标记），场景 prompt 精准化（地点/时间/光线/氛围/元素/色调）；Images 用
//   POST /images 为每角色生成【三视图 character sheet】（正/侧/背三视角，自动写入 character.image_url），
//   镜头首尾帧参考三视图保持人物跨镜一致（单镜只画单一视角）。不改后端——sheet 走 image_url；
//   若要更精准的「正/侧/背分三张存 referenceImages」，需扩 PUT /characters 白名单 + 生成逻辑，留作后续。
//
// v6 修正（通用性 + 健壮性）：
//   1) 消除闸门 prompt 中硬编码的剧本情节——critic 自行从 SCRIPT_TEXT 提取节拍评审完整性，换剧本不需改闸门。
//   2) Extract 角色描述从硬编码改为格式模板+动态推导。
//   3) 安全闸门增加质量分数最低门槛（MIN_QUALITY_SCORE），评分过低不进入视频阶段。
//   4) 新增 VOICE_MAP 常量支持自定义角色音色映射。
//   5) 修复 workbench URL 硬编码 episode/1 → episode/${EP}。
//   6) gateSummary 保留 summary 字段；Images-Gate 命名修正。
// ============================================================
export const meta = {
  name: 'huobao-produce-drama',
  description: '端到端驱动火宝后端，把一个原始剧本自动做成一集成片（改写→提取→音色→分镜→图→配音→视频→合成→导出），含三道质检闸门 + 回滚保护 + 首尾帧 + v6 通用化',
  phases: [
    { title: 'Setup', detail: '建剧建集 + 写入原始内容' },
    { title: 'Rewrite', detail: 'script_rewriter 改写初版' },
    { title: 'Rewrite-Gate', detail: '剧本质检闸门：critic→返工→分数回退则回滚' },
    { title: 'Extract', detail: '提取角色与场景 + 结构化 appearance（三视图友好）+ 场景 prompt 精准化' },
    { title: 'Voice', detail: '直接分配 shimmer/fable + 试听验证' },
    { title: 'Storyboard', detail: 'storyboard_breaker 拆分镜（初版）' },
    { title: 'Storyboard-Gate', detail: '分镜质检闸门：critic→返工→分数回退则回滚' },
    { title: 'Images', detail: '角色三视图设定图（character sheet）+ 场景图' },
    { title: 'Images-Gate', detail: '帧图前质检：分镜 image_prompt + reference 绑定审查（在生成首尾帧之前）' },
    { title: 'Images-LastFrame-Prompt', detail: '为每镜推导尾帧 prompt（镜头结束画面）' },
    { title: 'Images-Frames', detail: '每镜生成首帧 + 尾帧（默认 first_last）' },
    { title: 'TTS', detail: '逐镜配音' },
    { title: 'Video', detail: '逐镜 first_last 图生视频（首尾帧插值）' },
    { title: 'Compose', detail: '逐镜合成' },
    { title: 'Merge', detail: '整集导出' },
  ],
}

// ===== 改这三个常量即可换剧本 =====
const SCRIPT_TITLE = '飞跃深坑'
// ⚠️ style 必须是前端下拉里的合法关键词之一（会被原样拼进宫格图 prompt）：
//   realistic | anime | ghibli | cinematic | comic | watercolor
//   写实+电影感打光 → cinematic；纯写实 → realistic。不要填中文自由文本。
const STYLE = 'cinematic'

// ===== 剧本类型与调性配置 =====
const GENRE = 'comedy'
const TONE = 'grounded Chinese rural humor, slapstick comedy, exaggerated facial expressions, fast-paced comedic timing, strong visual contrast'

// ===== 角色参考图（可选）：想让某角色长得像指定图，把参考图放进 data/static/refs/，按「角色名 → [参考图路径]」配置 =====
// 后端 Gemini adapter 会把参考图作为 inline_data 传给 Gemini 做图生图（gemini-image.ts），让角色贴合参考图。
// 路径写 static/ 开头（后端自动读取压缩成 data URL）；也可写 http(s):// URL 或 data:image/... 内联；每角色最多 6 张。
// 角色名要与 Extract 提取的 name 一致（如「女骑手」「男骑手」）；未配置的角色按结构化 appearance 自由生成。
// 默认空对象 = 全部角色自由生成，不加参考图。
const CHARACTER_REFERENCES = {
  // '女骑手': ['static/refs/rider_face.jpg', 'static/refs/rider_outfit.jpg'],
  // '男骑手': ['static/refs/guy_ref.jpg'],
}

// ===== 角色音色映射（可选）：按「角色名 → 音色名」自定义，未配置的角色按性别默认分配 =====
// 可用音色（经 chatfire→minimax 验证）：alloy, echo, fable, onyx, nova, shimmer
// 默认：女性=shimmer, 男性=fable。多个同性别角色时建议手动区分。
const VOICE_MAP = {
  // '女骑手': 'shimmer',
  // '男骑手': 'fable',
}
const SCRIPT_TEXT = '中国短发美女驾驶摩托车，载着一个憨厚的中国年轻小伙，在乡间比值平坦的土路上疾驰，风姿煞爽。突然年轻小伙发现前面不远处的路中间被挖了个深坑，惊讶的大喊，沟 沟 沟。女骑手误听成的Go Go Go，随后短发女骑手加速喊道“收到， Go Go”，随后猛拧油门，摩托车高速冲向深沟，女骑手一脸淡定，年轻小伙一脸惊讶，最后连人带车摔入沟底，激起大量沙尘。沙尘逐渐散去，两人坐在沟底满身尘土。女骑手率先开口询问："你刚说啥？"，男骑手气喘吁吁地回答："我说有沟啊！"'

const POLL = `
轮询技巧（单次 Bash 不要超过 ~560 秒；需要就多调几次）：
  curl -s http://localhost:5679/api/v1/videos/$ID | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j.data?.status, j.data?.video_url||j.data?.local_path||'')}catch(e){console.log('ERR',s.slice(0,200))}})"
轮询循环示例：for i in $(seq 1 25); do <check>; <all done> && break; sleep 20; done
后端在后台轮询厂商（图片 5s/最多10min，视频 10s/最多50min），完成后自动写回 character.image_url / scene.image_url / storyboard.first_frame_image / storyboard.last_frame_image / storyboard.video_url。你只需触发 + 轮询状态 + 核实，不要自己调厂商 API。`

const STATUS = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    phase: { type: 'string' },
    episodeId: { type: 'number' },
    dramaId: { type: 'number' },
    details: { type: 'string', description: '做了什么、关键计数/ID、产出' },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'phase', 'details'],
}

// ===== 质检闸门共用 schema =====
const CRITIC = {
  type: 'object',
  description: '质检结论（独立 reviewer agent 输出，只读不写）',
  properties: {
    pass: { type: 'boolean', description: 'true 当且仅当无 high 严重度问题' },
    score: { type: 'number', description: '0-100 综合质量分' },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          storyboard_id: { type: 'number', description: '相关条目 id（镜头/剧本无对应概念时填 0）' },
          issue: { type: 'string' },
        },
        required: ['severity', 'issue'],
      },
    },
    fix_instructions: { type: 'string', description: '写给生成方的逐条修正指令；因重新保存多为覆盖式，须给出完整修正后的产出要求，而非只说改动' },
  },
  required: ['pass', 'score', 'issues', 'fix_instructions'],
}

// 返工前快照（分数回退时用它回滚）
const SNAPSHOT = {
  type: 'object',
  description: '返工前的数据快照（用于分数回退时回滚到上一版）',
  properties: {
    ok: { type: 'boolean' },
    data: { type: 'string', description: '完整的当前数据快照：GET 原始结果的 JSON 字符串，务必包含所有条目与字段，不要省略任何一项' },
  },
  required: ['ok', 'data'],
}

// 尾帧 prompt 推导结果（每镜一条）
const LASTFRAME_MAP = {
  type: 'object',
  description: '每镜的尾帧 image prompt（镜头结束画面）',
  properties: {
    ok: { type: 'boolean' },
    frames: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          storyboard_id: { type: 'number' },
          last_prompt: { type: 'string', description: '英文尾帧 prompt，呈现该镜结束瞬间的画面' },
        },
        required: ['storyboard_id', 'last_prompt'],
      },
    },
  },
  required: ['ok', 'frames'],
}

// 返工上限：critic 最多评审 MAX_REWORK+1 次，rework 最多 MAX_REWORK 次。
const MAX_REWORK = 2
// 质量分数最低门槛：闸门评分低于此值则中止流水线，不进入视频阶段。
// 根据实际效果调整：40 是宽松值，60 是严格值。（const MIN_QUALITY_SCORE 声明在安全闸门处）

function common(dramaId, epId) {
  return `
你在驱动一个【正在运行】的火宝后端：http://localhost:5679 （已确认在线）。
响应是 {code,data,message} 信封，code==200 表示成功。用 Bash curl 调用，用 node 解析 JSON：
  curl -s URL | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(JSON.stringify(j.data))})"
本集：drama_id=${dramaId} , episode_id=${epId} （直接用这两个数字，不要再查）。
端点速查：
- GET /dramas/${dramaId}  → 含 episodes[]（每个 episode 有 content 原始 / script_content 改写）。注意：没有 GET /episodes/:id，读内容用 /dramas/:id。
- GET /episodes/${epId}/characters  /scenes  /storyboards  /pipeline-status
- PUT /episodes/${epId}  body {content} 或 {script_content}
- POST /agent/:type/chat  body {message, drama_id:${dramaId}, episode_id:${epId}}  (:type ∈ script_rewriter|extractor|voice_assigner|storyboard_breaker)  返回 {text,toolResults}；agent 经工具自动落库
- PUT /characters/:id  body {voice_style, appearance, ...} ；POST /characters/:id/generate-voice-sample {episode_id:${epId}} ；POST /characters/batch-generate-images {character_ids:[..], episode_id:${epId}}
- POST /scenes/:id/generate-image {episode_id:${epId}}
- POST /images {storyboard_id, drama_id:${dramaId}, prompt, size, frame_type:first_frame|last_frame, reference_images:[..]} ；GET /images/:id  （frame_type 决定写回 storyboard.first_frame_image 还是 last_frame_image）
- POST /storyboards/:id/generate-tts  (同步) ；PUT /storyboards/:id  body {image_prompt, video_prompt, dialogue, duration, scene_id, ...} ；DELETE /storyboards/:id
- POST /videos {storyboard_id, drama_id:${dramaId}, prompt, reference_mode:single|first_last|multiple, image_url, first_frame_url, last_frame_url, duration, aspect_ratio} ；GET /videos/:id  （reference_mode:first_last 用 first_frame_url+last_frame_url 让 Seedance 在两帧间插值）
- POST /compose/episodes/${epId}/compose-all ；GET /compose/episodes/${epId}/compose-status
- POST /merge/episodes/${epId}/merge ；GET /merge/episodes/${epId}/merge
注意：本系统 image/video/audio 全部走 api.chatfire.site 中转（已验证可用）；音色库同步不可用（chatfire 不代理 /get_voice），所以音色用直接分配（见 Voice 阶段）。
⚠️ 编码（重要）：Windows 上 curl -d '...' 直接放中文会变乱码（curl 按 ANSI/GBK 重编码，与 bash locale 无关）。凡是请求 body 含中文（建剧 title/style、写 content、改 character.appearance、改 dialogue/image_prompt 等），一律用【Write 工具写一个 .mjs 用 node 的 fetch 发请求】或【Write 一个 body.json 再 curl -d @body.json】，绝不要把中文直接写进 curl -d。读数据用 curl|node 没问题（响应是 UTF-8 JSON）。
${POLL}
原则：每步【触发→核实】，失败就重试或如实上报 ok:false，不要跳过核实。`
}

// ===== 通用质量闸门 helper：critic 评审 → 不过则返工 → 若返工使分数回退则回滚上一版并停止 =====
// 三个阶段（剧本/分镜/出图前）共用此控制流，各自通过 4 个 prompt 生成函数注入差异：
//   criticFor(attempt)      → reviewer 评审当前版的 prompt（输出 CRITIC）
//   reworkFor(critique,n)   → 生成方按评审意见返工的 prompt（输出 STATUS）
//   snapshotFor()           → 返工前快照当前版的 prompt（输出 SNAPSHOT，data 存完整 JSON）
//   rollbackFor(snapData)   → 用快照把后端恢复到上一版的 prompt（输出 STATUS）
// 控制流（贪心 + 回退保护）：
//   critic 评审当前版 → 通过则结束；否则循环最多 MAX_REWORK 轮：
//     返工前快照 → 返工 → 复审 → 若复审分 < 返工前分（回退）→ 回滚后端 + 停止；
//     否则接受新版，通过则结束，否则下一轮。
async function qualityGate({ tag, criticFor, reworkFor, snapshotFor, rollbackFor }) {
  const P = `${tag}-Gate`
  let critique = await agent(criticFor(0), { phase: P, label: `${tag}-critic-1`, agentType: 'general-purpose', schema: CRITIC, effort: 'high' })
  log(`${tag} 闸门 · 初版评审：${critique.pass ? '✅ 通过' : '❌ 不通过'} · ${critique.score}/100 · 问题 ${(critique.issues || []).length} 个`)
  if (critique.pass) return { critique, reworkRounds: 0, rolledBack: false }

  for (let attempt = 0; attempt < MAX_REWORK; attempt++) {
    const prevScore = critique.score
    // 返工前快照（分数回退时用它回滚）
    const snap = await agent(snapshotFor(), { phase: P, label: `${tag}-snap-${attempt + 1}`, agentType: 'general-purpose', schema: SNAPSHOT, effort: 'low' })
    // 执行返工
    await agent(reworkFor(critique, attempt), { phase: P, label: `${tag}-rework-${attempt + 1}`, agentType: 'general-purpose', schema: STATUS, effort: 'medium' })
    // 复审
    const after = await agent(criticFor(attempt + 1), { phase: P, label: `${tag}-critic-${attempt + 2}`, agentType: 'general-purpose', schema: CRITIC, effort: 'high' })
    log(`${tag} 闸门 · 第 ${attempt + 1} 轮返工后复审：${after.pass ? '✅ 通过' : '❌ 不通过'} · ${after.score}/100（上版 ${prevScore}）`)
    if (after.score < prevScore) {
      log(`${tag} 闸门 · ⚠️ 返工使分数回退（${prevScore} → ${after.score}），回滚到上一版并停止返工`)
      await agent(rollbackFor(snap.data), { phase: P, label: `${tag}-rollback-${attempt + 1}`, agentType: 'general-purpose', schema: STATUS, effort: 'medium' })
      // critique 维持为「上一版」（回滚后后端 = 上一版），如实反映
      return { critique, reworkRounds: attempt, rolledBack: true }
    }
    critique = after
    if (critique.pass) return { critique, reworkRounds: attempt + 1, rolledBack: false }
  }
  log(`${tag} 闸门 · 达返工上限 ${MAX_REWORK} 轮仍不通过；如实记录质量，继续后续阶段（不卡死流水线）`)
  return { critique, reworkRounds: MAX_REWORK, rolledBack: false }
}

// ============ Setup ============
phase('Setup')
const setup = await agent(`${common('?', '?')}
注：上面 drama_id/episode_id 显示 ? 是因为本阶段还没创建，下面步骤会创建并返回真实值。

剧本标题：${SCRIPT_TITLE}
视觉风格：${STYLE}
原始剧本全文：
"""
${SCRIPT_TEXT}
"""

任务（按顺序 curl）：
1. 建剧（body 含中文，按上面编码要求用 node fetch，别用 curl -d '中文'）：
   用你的 Write 工具创建临时文件 _create_drama.mjs（Write 保证 UTF-8），内容：
     const r=await fetch('http://localhost:5679/api/v1/dramas',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'${SCRIPT_TITLE}',style:'${STYLE}',total_episodes:1})});const j=await r.json();console.log(JSON.stringify(j.data));
   然后 \`node _create_drama.mjs\`，从输出取 id=dramaId、episodes[0].id=episodeId，用完删掉该文件。
   （该集无锁定配置，系统回退到各类型最高优先级 active 配置：image=gemini, video=volcengine Seedance, audio=minimax, text=chatfire，全部经 chatfire，已验证可用。）
2. 写原始内容（务必用 node 做 JSON 安全转义，避免中文/引号破坏 payload）：
   SCRIPT='上述剧本全文'; curl -s -X PUT http://localhost:5679/api/v1/episodes/<EPID> -H 'Content-Type: application/json' -d "$(node -e 'process.stdout.write(JSON.stringify({content:process.argv[1]}))' "$SCRIPT")"
   把 <EPID> 换成真实 episodeId。
3. 核实：GET /dramas/<dramaId>，确认该集 content 与上面剧本【完全一致】（不是 "undefined"、不是空）。这是整个流水线的前提，必须对。

返回 schema：ok=true, phase='setup', episodeId=<真实数字>, dramaId=<真实数字>, details 简述。episodeId 和 dramaId 务必返回准确的数字。`,
  { phase: 'Setup', label: 'setup', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

const EP = Number(setup.episodeId)
const DRAMA = Number(setup.dramaId)
if (!EP || !DRAMA) throw new Error('Setup 未返回有效 episodeId/dramaId: ' + JSON.stringify(setup))

// ============ Rewrite（改写初版）============
phase('Rewrite')
const rewrite = await agent(`${common(DRAMA, EP)}
任务：触发 script_rewriter 改写并落库。
1. POST /agent/script_rewriter/chat {message:"请读取剧本并改写为格式化剧本，然后保存。\n\n【重要：剧本类型与调性约束】\n当前剧本类型为：${GENRE}\n调性要求：${TONE}\n\n请在改写时：\n1. 深度融入上述类型与调性。对于喜剧，请放大戏剧冲突，设计滑稽的动作描写与夸张的神态（如“瞪大眼睛”、“猛拧油门一脸淡定，与男主的惊恐形成强烈反差”），为后续分镜出图提供丰富的视觉线索。\n2. 确保所有场景头、动作描写和对白格式规范。\n3. 绝对保留剧本中的关键道具/载具（如“摩托车”），并在动作描写中明确强调，绝对不要泛化为“车辆”或“汽车”。", drama_id:${DRAMA}, episode_id:${EP}}  （阻塞 1-3 分钟）
2. 核实：GET /dramas/${DRAMA}，该集 script_content 非空且【不是占位文本】。
3. 若仍空：把 agent 返回 text 里干净的剧本文本，用 node JSON.stringify 构造 body，PUT /episodes/${EP} {script_content:<文本>} 手动写回，再核实。
返回 ok + 剧本字数。`,
  { phase: 'Rewrite', label: 'rewrite', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Rewrite-Gate：剧本质检闸门 ============
phase('Rewrite-Gate')
const rewriteGate = await qualityGate({
  tag: 'Rewrite',
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
3. 输出 schema：pass（无 high 即 true）/ score(0-100) / issues[{severity,storyboard_id填0,issue}] / fix_instructions（写给 script_rewriter 的完整修正要求；因 saveScript 是覆盖式，须给完整修正后的剧本要求而非只说改动）。
只评审，绝不修改数据。`,
  reworkFor: (critique, attempt) => `${common(DRAMA, EP)}
任务：按【剧本评审意见】让 script_rewriter 重新改写。返工第 ${attempt + 1} 轮（覆盖式保存，输出完整剧本）。
1. POST /agent/script_rewriter/chat {message:"请根据以下评审意见重新改写为格式化剧本并保存（覆盖式保存，请输出完整剧本）。\n\n评审评分：${critique.score}/100\n评审问题：\n${(critique.issues || []).map((it, i) => `${i + 1}.[${it.severity}] ${it.issue}`).join('\n')}\n\n修正要求：\n${critique.fix_instructions}", drama_id:${DRAMA}, episode_id:${EP}}  （body 含中文，用 node fetch 或 body.json，勿 curl -d 中文）
2. 核实：GET /dramas/${DRAMA}，script_content 非空且已变化。
返回 ok + 字数。`,
  snapshotFor: () => `${common(DRAMA, EP)}
任务：快照当前剧本（供回滚用）。GET /dramas/${DRAMA}，取该集 script_content 全文，把 JSON.stringify({script_content: <全文>}) 的结果字符串放进 data 字段。务必完整、不要截断。`,
  rollbackFor: (snapData) => `${common(DRAMA, EP)}
任务：回滚剧本到快照版本（返工使质量回退，恢复上一版）。
快照数据（JSON 字符串）：${snapData}
1. 解析其中的 script_content 全文。
2. 用 node JSON.stringify 构造 body（中文安全转义，勿 curl -d 中文），PUT /episodes/${EP} {script_content: <快照全文>}。
3. 核实 GET /dramas/${DRAMA} 的 script_content 已恢复为快照内容。
返回 ok。`,
})

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
   //   【标记】特殊特征/随身道具（如：戴着防风眼镜，或无）
   //   【神态】默认气质表情（喜剧角色需注明“带有喜感、憨厚或淡定”等表情特征）
   请根据剧本内容和角色身份，为每个角色推导出符合上述格式的具体外观描述。要求：每项要具体到能画出来，不要写笼统的"普通打扮"。例如一个女骑手角色可填为：【整体】年轻女性,20岁出头,矫健苗条,中等身高,Chinese / East Asian;【头部】利落黑色齐耳短发(自然分缝)、鹅蛋脸、浓眉亮眼、健康肤色;【服装】深色拉链机车皮夹克(黑)、黑色修身长裤、黑色马丁靴;【配色】主色黑/辅色暗银拉链;【标记】无;【神态】淡定自信。请为本剧本的每个角色同样按此精度填写。
4. 【场景精准化】GET /episodes/${EP}/scenes，对每个场景用 node JSON.stringify 构造 body，PUT /scenes/:id {prompt:"<精准场景描述>"}，prompt 含【地点/时间段/光线/氛围/关键元素/色调/镜头风格】且可视化，必须包含核心道具（如 motorcycle）和中国乡村/都市文化背景。例：乡间土路场景 → "rural dirt road in China, daytime, harsh sunlight, dry dust, deep ditch ahead, a motorcycle kicked up dust, warm earth tones, cinematic wide establishing shot"。
返回 ok + 角色数/场景数 + 角色 id 列表 + 每角色 appearance 字数。`,
  { phase: 'Extract', label: 'extract', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Voice ============
phase('Voice')
const voice = await agent(`${common(DRAMA, EP)}
任务：为角色分配【已验证可用】的音色，并用试听确认 TTS 链路通。
背景：音色库 sync 在 chatfire 下不可用，但 OpenAI 风格音色名 {alloy,echo,fable,onyx,nova,shimmer} 经 chatfire→minimax 能正常合成（既有成片已验证：女=shimmer, 男=fable）。
1. GET /episodes/${EP}/characters 拿角色列表。
2. 分配音色（PUT /characters/:id {voice_style}）：
   【角色音色映射】：${JSON.stringify(VOICE_MAP)}
   若映射中有该角色名（或近似匹配），使用映射指定的音色；否则按性别默认分配：女性→"shimmer"，男性→"fable"。
   可用音色：alloy, echo, fable, onyx, nova, shimmer。
   （也可先跑 POST /agent/voice_assigner/chat {message:"请为所有角色分配合适的音色"}，但务必校正到映射/默认音色。）
3. 【TTS 可用性闸门】对一个角色 POST /characters/:id/generate-voice-sample {episode_id:${EP}}。
   成功（返回 voice_sample_url）= TTS 链路通；失败（404/voice 无效/key 问题）= ok:false 并把完整错误写进 details/warnings。本闸门失败会阻止后续烧钱的视频阶段，必须如实。
全部角色已分配有效音色 + 试听成功才算 ok=true。`,
  { phase: 'Voice', label: 'voice', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Storyboard（初版）============
phase('Storyboard')
const storyboard = await agent(`${common(DRAMA, EP)}
任务：触发 storyboard_breaker 拆分镜。
1. POST /agent/storyboard_breaker/chat {message:"请拆解分镜并生成视频提示词。视频模型：doubao-seedance-1-5-pro-251215（火山 Seedance 图生视频，单镜 4-12 秒）。\n\n【重要分镜设计约束】\n1. 喜剧节奏与单人镜头优先：喜剧非常依赖角色表情反差（如女骑手淡定与男小伙惊恐）。请尽量多设计【单人近景/特写镜头】（如“镜头3：男小伙面部特写，双眼瞪大，极度惊恐大喊”；“镜头4：女骑手侧面近景，一脸淡定，猛拧油门”）。避免设计过多复杂的双人同框高动态镜头，单人镜头能保证 100% 角色一致性且绝不串乱。\n2. 英文提示词（image_prompt）强锁定：每一镜的 image_prompt 必须是英文，且【开头前三个词】必须明确人种和核心载具。例如：必须写 \"A Chinese young woman riding a red motorcycle...\"，绝对不允许使用 generic 词汇（如 \"A person driving a vehicle\"）。必须在提示词中加入风格词：竖屏9:16、cinematic、high quality。\n3. 确保 dialogue 格式严格为“角色名：台词”，纯动作镜可无对白。\n4. 时长 4-8 秒，绑定对应角色与场景。", drama_id:${DRAMA}, episode_id:${EP}}
2. 核实：GET /episodes/${EP}/storyboards，镜头数>0（预期 4-6 镜）。
3. 每镜都应有 image_prompt 与 video_prompt；空字段用 PUT /storyboards/:id 补。
4. 确保 dialogue 格式为 "角色名：台词"（如 "女骑手：你刚说啥？"），便于 TTS 按角色取音色。纯动作镜（摔车）可无对白。
返回 ok + 镜头数。`,
  { phase: 'Storyboard', label: 'storyboard', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Storyboard-Gate：分镜质检闸门（critic → 返工 → 分数回退则回滚）============
phase('Storyboard-Gate')
const storyboardGate = await qualityGate({
  tag: 'Storyboard',
  criticFor: () => `${common(DRAMA, EP)}
你是【分镜质检 / 评审导演】（reviewer agent），与 storyboard_breaker 是不同角色——你【只读不写】，不调用任何 /agent，不修改数据，只评审输出结构化结论。
本集原始剧本（完整性基准）：
"""
${SCRIPT_TEXT}
"""
任务：
1. GET /episodes/${EP}/storyboards 拿全部分镜（每镜 id / image_prompt / video_prompt / dialogue / description / duration / shot_type / scene_id / character_ids）。
2. GET /episodes/${EP}/characters 与 /scenes 拿角色（含 appearance）与场景，判断绑定正确性与跨镜一致性。
3. 以【导演视角】逐镜评审，维度：
   a. 完整性：先从上面原始剧本中自行提取所有关键转折节拍（动作、情绪转折、台词），然后逐一检查分镜是否覆盖？漏任一关键节拍=high。请在 issues 中列出节拍清单及覆盖情况。
   b. image_prompt 质量：每镜是否有清晰、英文为主、含构图/人物外貌/景别/光线/氛围的首帧描述（出图质量命根子）？空/纯中文/过笼统=high。
   c. 种族与道具强锁定（硬性指标）：涉及人的镜头 image_prompt 是否在开头明确写了 \"Chinese\" 或 \"East Asian\"？涉及载具的镜头是否 100% 出现了具体的载具词（如 \"motorcycle\"）？如果出现 \"car\"、\"vehicle\" 或未提及，直接判定为 high 严重度。
   d. 喜剧节奏与镜头比例：是否优先采用了单人特写/近景镜头来展现喜剧反差？如果全是大全景或复杂的双人同框动镜头=medium。
   e. video_prompt 质量：每镜是否有适配图生视频（Seedance，单镜4-12s）的动作描述？只静态无运动=medium；空=high。
   f. 对白格式：dialogue 是否「角色名：台词」？格式错或漏角色名=medium（纯动作镜可无对白）。
   g. 时长：每镜 duration 4-8 秒且合理？普遍>10s 或<3s=medium。
   h. 绑定：每镜是否绑定正确角色（character_ids）与场景（scene_id）？有对白却没绑说话角色=high。
   i. 一致性：同一角色跨镜 image_prompt 是否与其 appearance 字段一致？冲突=medium。
   j. 数量与节奏：镜头数是否合理（短剧每集一般 4-8 镜）？过碎或过冗=medium。
4. 输出 schema：pass（无 high 即 true）/ score(0-100) / issues[{severity,storyboard_id,issue}] / fix_instructions（逐镜可执行修正指令；因 saveStoryboards 覆盖式，须描述完整修正后的全部分镜而非只说改动）。
只评审，绝不修改数据。`,
  reworkFor: (critique, attempt) => `${common(DRAMA, EP)}
任务：按【分镜评审意见】让 storyboard_breaker 重新拆解并修正（返工第 ${attempt + 1} 轮；saveStoryboards 覆盖式，输出完整修正后的全部分镜）。
1. POST /agent/storyboard_breaker/chat {message:"请根据以下导演评审意见重新拆解分镜。重新保存会覆盖现有全部分镜，请直接输出完整修正后的全部分镜，不要只说改动。\n\n评审评分：${critique.score}/100\n评审问题：\n${(critique.issues || []).map((it, i) => `${i + 1}.[${it.severity}]${it.storyboard_id ? ' 镜头#' + it.storyboard_id : ''} ${it.issue}`).join('\n')}\n\n逐镜修正指令：\n${critique.fix_instructions}\n\n原始约束：视频模型 doubao-seedance-1-5-pro-251215（Seedance 图生视频，单镜4-12秒）；每镜英文 image_prompt 与 video_prompt；dialogue 用「角色名：台词」；绑定角色与场景；时长4-8秒。", drama_id:${DRAMA}, episode_id:${EP}}
2. 核实：GET /episodes/${EP}/storyboards 镜头数>0，high 问题已修正。
返回 ok + 镜头数。`,
  snapshotFor: () => `${common(DRAMA, EP)}
任务：快照全部分镜（供回滚用）。GET /episodes/${EP}/storyboards，把完整结果数组（含每镜所有字段：id/storyboard_number/image_prompt/video_prompt/dialogue/description/duration/shot_type/scene_id/character_ids 等）作为 JSON 字符串放进 data 字段。不要省略任何镜头或字段。`,
  rollbackFor: (snapData) => `${common(DRAMA, EP)}
任务：回滚分镜到快照版本（返工使质量回退，恢复上一版）。
快照数据（每镜完整字段 JSON）：${snapData}
1. 解析快照，得上一版镜头列表（按 storyboard_number 排序）。
2. GET /episodes/${EP}/storyboards 拿当前镜头列表。
3. 对快照里每个镜头 s：在当前列表找同 storyboard_number 的镜头 c；若找到，用 node JSON.stringify 构造 body，PUT /storyboards/:c.id 覆盖 image_prompt/video_prompt/dialogue/description/duration/shot_type/scene_id 为 s 的值；若当前缺这镜，记 warning（无法通过 REST 新建）。
4. 当前列表里 storyboard_number 不在快照中的多余镜头：DELETE /storyboards/:id 删除。
5. 核实 GET /episodes/${EP}/storyboards 镜头数与快照一致、核心字段已恢复。
返回 ok + 恢复的镜头数（warn 写进 warnings）。`,
})

// ============ Images：A+B 角色三视图设定图 + 场景图 ============
phase('Images')
const imagesAssets = await agent(`${common(DRAMA, EP)}
任务：生成【角色三视图设定图】与场景图（镜头首尾帧在闸门通过后单独生成）。
A. 角色三视图（character sheet，跨镜一致性的命根子）：GET /episodes/${EP}/characters 拿 ids 与结构化 appearance。⚠️ 不要用 batch-generate-images（那个只出单张正面）。改用【POST /images】为每角色生成一张含三视角的设定图：
   POST /images {character_id:<id>, drama_id:${DRAMA}, size:"1080x1920", reference_images:<该角色参考图数组，见下一行；无则 []>, prompt:"character design sheet, three views of the same person (front view, side profile view, back view), full body turnaround, <把该角色结构化 appearance 翻译成英文关键特征: 性别/年龄/体型/发型颜色与样式/脸型/服装款式与颜色/鞋/配饰/特殊标记>, consistent character design across all three views, clean white background, professional concept art, cinematic lighting, high quality"}
   【参考图映射（角色名 → [static 路径...]）】：${JSON.stringify(CHARACTER_REFERENCES)}。生成某角色时，若其 name（GET /characters 返回的）在映射里有参考图，把这些路径放进 reference_images（后端自动读取压缩成 data URL 传给 Gemini 做图生图，让角色长得像参考图）；映射为空 {} 或该角色未配置则 reference_images 传 []，按 appearance 自由生成。名字不完全一致时按最接近的匹配，并在 details 注明匹配了哪个。
   body 含中文用 node fetch 或 body.json（勿 curl -d 中文）。后端生成完自动写 character.image_url（一张含正/侧/背三视角的设定图）。分批触发降低限流。
   轮询 GET /episodes/${EP}/characters 直到每个角色 image_url 有值。
B. 场景图：GET /episodes/${EP}/scenes；对每个 POST /scenes/:id/generate-image {episode_id:${EP}}（后端用 scene.prompt 生成，Extract 已精准化）；轮询直到 scene.image_url 有值。
失败逐个重试1次；仍失败记 warning 继续。返回 ok + 角色三视图/场景图成功计数。`,
  { phase: 'Images', label: 'images-assets', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Images-Gate：帧图前质检（critic 审分镜 image_prompt + reference 绑定，在首尾帧生成之前）============
phase('Images-Gate')
const imagesGate = await qualityGate({
  tag: 'Images',
  criticFor: () => `${common(DRAMA, EP)}
你是【帧图前质检 / 评审美术】（reviewer agent），只读不写。角色三视图与场景图已生成，本闸门在生成【分镜首尾帧】之前审查每镜的 image_prompt 与 reference 绑定是否完备——避免帧图质量差导致后续视频浪费。
任务：
1. GET /episodes/${EP}/storyboards 拿每镜 image_prompt / character_ids / scene_id / description。
2. GET /episodes/${EP}/characters 与 /scenes，确认角色图 image_url 与场景图 image_url 都已生成（非空）。
3. 逐镜评审，维度：
   a. image_prompt 完备与强锁定（硬性指标）：每镜 image_prompt 是否英文为主、含构图/人物外貌（与角色 appearance 一致）/景别/光线/9:16竖屏/cinematic 风格词？涉及人的镜头是否在开头明确写了 \"Chinese\" 或 \"East Asian\"？涉及载具的镜头是否 100% 出现了具体的载具词（如 \"motorcycle\"）？如果出现 \"car\"、\"vehicle\" 或未提及，直接判定为 high 严重度。
   b. reference 绑定：每镜是否绑定出场角色（character_ids）与场景（scene_id）？有角色出现却没绑=high；没绑场景=medium。
   c. 角色/场景图就绪：绑定的角色、场景是否都已有 image_url（否则生成时无参考）？缺=high。
   d. 一致性：image_prompt 对角色外貌描述是否与该角色的 appearance 字段一致？冲突=medium。
4. 输出 schema：pass（无 high 即 true）/ score(0-100) / issues[{severity,storyboard_id,issue}] / fix_instructions（逐镜指令：哪些镜要 PUT 改 image_prompt、要补绑哪些 character_ids/scene_id；image_prompt 是单字段覆盖，指令须给完整新 image_prompt 文本）。
只评审，绝不生成图、不修改数据。`,
  reworkFor: (critique, attempt) => `${common(DRAMA, EP)}
任务：按【出图评审意见】修正镜头 image_prompt 与绑定（返工第 ${attempt + 1} 轮）。⚠️ 只改 prompt 文本与绑定字段，【不要】生成图片（图片在闸门通过后才统一生成）。
评审问题：
${(critique.issues || []).map((it, i) => `${i + 1}.[${it.severity}]${it.storyboard_id ? ' 镜头#' + it.storyboard_id : ''} ${it.issue}`).join('\n')}
修正指令：
${critique.fix_instructions}
执行：对每条指令，用 node JSON.stringify 构造 body（中文安全转义，勿 curl -d 中文），PUT /storyboards/:id 按指令覆盖 {image_prompt, scene_id} 等字段。核实 GET。返回 ok + 修正的镜头数。`,
  snapshotFor: () => `${common(DRAMA, EP)}
任务：快照每镜 image_prompt（供回滚用）。GET /episodes/${EP}/storyboards，把 [{id, storyboard_number, image_prompt, scene_id}] 的 JSON 字符串放进 data。完整不要省略。`,
  rollbackFor: (snapData) => `${common(DRAMA, EP)}
任务：回滚镜头 image_prompt 到快照版本（返工使质量回退）。
快照（每镜 id + image_prompt + scene_id JSON）：${snapData}
对快照里每镜，用 node JSON.stringify 构造 body，PUT /storyboards/:id {image_prompt: <快照值>, scene_id: <快照值>} 恢复。核实 GET。返回 ok。`,
})

// ============ Images-LastFrame-Prompt：为每镜推导尾帧 prompt（镜头结束画面）============
phase('Images-LastFrame-Prompt')
const lastFramePrompts = await agent(`${common(DRAMA, EP)}
任务：为每个镜头推导【尾帧 prompt】（镜头结束画面），用于生成视频的最后一帧。首帧=镜头开始（image_prompt），尾帧=镜头结束；Seedance 会在首尾两帧间插值出运动，所以尾帧要描述"这一镜结束时画面是什么样"。
1. GET /episodes/${EP}/storyboards，拿每镜 id / image_prompt / video_prompt / description / action / result。
2. 对每镜：基于 image_prompt（开始画面）+ video_prompt/action/result（运动与结果），推导【镜头结束瞬间】画面，写成英文 image prompt（含构图/人物状态/景别/光线/9:16竖屏/cinematic），与首帧风格一致但呈现结束状态。
   例：首帧"女骑手加速冲向深沟" → 尾帧"摩托车腾空飞跃在深沟上方，两人悬空，沙尘初起"；首帧"两人坐沟底" → 尾帧"两人坐沟底满身尘土，女骑手转头询问的神态"。
3. 返回 frames: [{storyboard_id, last_prompt}]，每镜一条。纯静态/无明显运动的镜头，尾帧描述该场景的稳定结束状态即可。
只推导 prompt 文本，不生成图片。`,
  { phase: 'Images-LastFrame-Prompt', label: 'lastframe-prompt', agentType: 'general-purpose', schema: LASTFRAME_MAP, effort: 'medium' })

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
   reference_images 用 GET 结果里的 image_url（形如 static/images/xxx.png）。⚠️ 角色的 image_url 是【三视图设定图】（含正/侧/背三视角）——参考它保持人物外观跨镜一致，但每个镜头画面里【只呈现该镜头需要的单一视角】，不要把三个视角都画进同一镜头。场景的 image_url 是环境图，正常参考。后端生成完自动写 storyboard.first_frame_image / last_frame_image。body 含中文用 node fetch 或 body.json。
4. 轮询 GET /episodes/${EP}/storyboards 直到每镜 first_frame_image 与 last_frame_image 都有值。
失败逐个重试1次；尾帧实在失败的可记 warning 跳过（视频阶段会降级为仅首帧）。返回 ok + 首帧/尾帧成功计数。`,
  { phase: 'Images-Frames', label: 'images-frames', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ TTS ============
phase('TTS')
const tts = await agent(`${common(DRAMA, EP)}
任务：为每个有对白的镜头生成配音。
1. GET /episodes/${EP}/storyboards。
2. 对 dialogue 非空的镜头：POST /storyboards/:id/generate-tts（同步，按 "角色名：台词" 取该角色 voice_style）。无对白镜（摔车）跳过。
3. 核实：有对白的镜头都有 tts_audio_url。若返回 400 "没有可生成的对白" 但确有台词，检查 dialogue 是否 "角色名：台词" 格式，PUT /storyboards/:id {dialogue} 修正后重试。
返回 ok + 成功/跳过计数。`,
  { phase: 'TTS', label: 'tts', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ===== 安全闸门：前置若失败 / 质量过低，绝不动视频（最贵）=====
const MIN_QUALITY_SCORE = 40
const gateOk = rewrite.ok && extract.ok && voice.ok && storyboard.ok && imagesAssets.ok && framesGen.ok && tts.ok
const qualityScores = {
  rewrite: rewriteGate?.critique?.score ?? 100,
  storyboard: storyboardGate?.critique?.score ?? 100,
  images: imagesGate?.critique?.score ?? 100,
}
const lowQuality = Object.entries(qualityScores).filter(([, s]) => s < MIN_QUALITY_SCORE)
if (!gateOk || lowQuality.length > 0) {
  return {
    aborted: true,
    reason: !gateOk
      ? '前置阶段有失败（见各 phase.ok），为避免在视频阶段白花 API 费用，已中止。'
      : `质量闸门评分过低（${lowQuality.map(([k, s]) => `${k}:${s}`).join(', ')} < ${MIN_QUALITY_SCORE}），为避免低质量视频浪费费用，已中止。`,
    episodeId: EP, dramaId: DRAMA,
    qualityScores,
    phases: { rewrite, rewriteGate, extract, voice, storyboard, storyboardGate, imagesAssets, imagesGate, lastFramePrompts, framesGen, tts },
  }
}

// ============ Video（first_last 首尾帧插值；无尾帧降级 single）============
phase('Video')
const video = await agent(`${common(DRAMA, EP)}
任务：每镜图生视频（火山 Seedance，最贵最慢）。首尾帧图已就绪，优先用 first_last 模式。
1. GET /episodes/${EP}/storyboards，拿每镜 video_prompt/description/duration/first_frame_image/last_frame_image。
2. 对每个镜头：
   - 同时有 first_frame_image 与 last_frame_image：POST /videos {storyboard_id, drama_id:${DRAMA}, prompt:"<video_prompt或description>", reference_mode:"first_last", first_frame_url:"<first_frame_image>", last_frame_url:"<last_frame_image>", duration:<4-8>, aspect_ratio:"9:16"}  ← 默认首选，两帧间插值运动更可控。
   - 仅 first_frame_image（无尾帧）：降级 POST /videos {... reference_mode:"single", image_url:"<first_frame_image>"}。
   分批触发（每批2-3个）降低限流；记录每个 video generation id。
3. 轮询所有 video id GET /videos/:id 直到 status=completed 且有 video_url/local_path，或 failed。总上限~40分钟。
4. failed 的重试1次。
返回 ok + 成功/失败计数 + 用了 first_last 模式的镜头数。全部失败（key/余额）则 ok:false 并说明。`,
  { phase: 'Video', label: 'video', agentType: 'general-purpose', schema: STATUS, effort: 'high' })

// ============ Compose ============
phase('Compose')
const compose = await agent(`${common(DRAMA, EP)}
任务：逐镜合成（视频+配音+字幕→单镜，FFmpeg）。
1. POST /compose/episodes/${EP}/compose-all（异步批量）。
2. 轮询 GET /compose/episodes/${EP}/compose-status 直到 completed==total 或 failed>0。
3. failed 的对该镜 POST /compose/storyboards/:id/compose 重试1次。
返回 ok + completed/failed 计数。`,
  { phase: 'Compose', label: 'compose', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Merge ============
phase('Merge')
const merge = await agent(`${common(DRAMA, EP)}
任务：拼接整集成片。
1. POST /merge/episodes/${EP}/merge（返回 merge_id, processing）。
2. 轮询 GET /merge/episodes/${EP}/merge 直到最新一条 status=completed 且有 merged_url。
3. 成片完整 URL = http://localhost:5679/ + merged_url（去掉开头多余/）。
返回 ok + 最终成片 URL（放 details）。`,
  { phase: 'Merge', label: 'merge', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

function gateSummary(g) {
  return g && g.critique
    ? { pass: g.critique.pass, score: g.critique.score, summary: g.critique.summary, reworkRounds: g.reworkRounds, rolledBack: g.rolledBack, issues: g.critique.issues }
    : null
}

return {
  episodeId: EP, dramaId: DRAMA, dramaTitle: SCRIPT_TITLE,
  // 三道质量闸门的最终结果：是否通过、评分、返工几轮、是否触发过回滚、遗留问题。
  qualityGates: {
    rewrite: gateSummary(rewriteGate),
    storyboard: gateSummary(storyboardGate),
    images: gateSummary(imagesGate),
  },
  phases: { rewrite, rewriteGate, extract, voice, storyboard, storyboardGate, imagesAssets, imagesGate, lastFramePrompts, framesGen, tts, video, compose, merge },
  workbench: `http://localhost:3013/drama/${DRAMA}/episode/${EP}`,
}
