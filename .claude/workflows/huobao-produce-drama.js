// ============================================================
// 火宝短剧：原始剧本 → 一集成片 全自动工作流（v2 修正可复用版）
// 复用方法：只改下面 SCRIPT_TITLE / STYLE / SCRIPT_TEXT 三个常量即可跑别的剧本。
// ⚠️ 不要用 args 传剧本（本环境里 args 会变 undefined，v1 就是这么坏的）。
// 依赖：火宝后端在 http://localhost:5679 运行，4 类 AI 服务已在「设置」配好。
// 音频修复在后端 ffmpeg-compose.ts（无对白镜保留视频原生音轨），本工作流自动受益。
// ============================================================
export const meta = {
  name: 'huobao-produce-drama',
  description: '端到端驱动火宝后端，把一个原始剧本自动做成一集成片（改写→提取→音色→分镜→图→配音→视频→合成→导出）',
  phases: [
    { title: 'Setup', detail: '建剧建集 + 写入原始内容' },
    { title: 'Rewrite', detail: 'script_rewriter 改写' },
    { title: 'Extract', detail: 'extractor 提取角色与场景' },
    { title: 'Voice', detail: '直接分配 shimmer/fable + 试听验证' },
    { title: 'Storyboard', detail: 'storyboard_breaker 拆分镜' },
    { title: 'Images', detail: '角色图+场景图+每镜首帧' },
    { title: 'TTS', detail: '逐镜配音' },
    { title: 'Video', detail: '逐镜图生视频（瓶颈，长轮询）' },
    { title: 'Compose', detail: '逐镜合成' },
    { title: 'Merge', detail: '整集导出' },
  ],
}

// ===== 改这三个常量即可换剧本 =====
const SCRIPT_TITLE = '摩托车飞跃深沟'
// ⚠️ style 必须是前端下拉里的合法关键词之一（会被原样拼进宫格图 prompt）：
//   realistic | anime | ghibli | cinematic | comic | watercolor
//   写实+电影感打光 → cinematic；纯写实 → realistic。不要填中文自由文本。
const STYLE = 'cinematic'
const SCRIPT_TEXT = '短发女骑手驾驶摩托车，载着一个憨厚的青年大叔（两人都没带头盔），在乡间土路上疾驰，突然青年大叔发现前面有个深沟，惊讶的大喊，沟 沟 沟。随后短发女骑手加速喊道“收到， Go Go”。随后摩托车高速冲向深沟，女骑手一脸淡定，青年大叔一脸惊讶，最后连人带车摔入沟底，激起大量沙尘。沙尘逐渐散去，两人坐在沟底满身尘土。女骑手率先开口询问：“你刚说啥？”，男骑手气喘吁吁地回答：“我说有沟啊！”'

const POLL = `
轮询技巧（单次 Bash 不要超过 ~560 秒；需要就多调几次）：
  curl -s http://localhost:5679/api/v1/videos/$ID | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);console.log(j.data?.status, j.data?.video_url||j.data?.local_path||'')}catch(e){console.log('ERR',s.slice(0,200))}})"
轮询循环示例：for i in $(seq 1 25); do <check>; <all done> && break; sleep 20; done
后端在后台轮询厂商（图片 5s/最多10min，视频 10s/最多50min），完成后自动写回 character.image_url / scene.image_url / storyboard.first_frame_image / storyboard.video_url。你只需触发 + 轮询状态 + 核实，不要自己调厂商 API。`

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
- POST /images {storyboard_id, drama_id:${dramaId}, prompt, size, frame_type, reference_images:[..]} ；GET /images/:id
- POST /storyboards/:id/generate-tts  (同步)
- POST /videos {storyboard_id, drama_id:${dramaId}, prompt, reference_mode, image_url, duration, aspect_ratio} ；GET /videos/:id
- POST /compose/episodes/${epId}/compose-all ；GET /compose/episodes/${epId}/compose-status
- POST /merge/episodes/${epId}/merge ；GET /merge/episodes/${epId}/merge
注意：本系统 image/video/audio 全部走 api.chatfire.site 中转（已验证可用）；音色库同步不可用（chatfire 不代理 /get_voice），所以音色用直接分配（见 Voice 阶段）。
⚠️ 编码（重要）：Windows 上 curl -d '...' 直接放中文会变乱码（curl 按 ANSI/GBK 重编码，与 bash locale 无关）。凡是请求 body 含中文（建剧 title/style、写 content、改 character.appearance、改 dialogue 等），一律用【Write 工具写一个 .mjs 用 node 的 fetch 发请求】或【Write 一个 body.json 再 curl -d @body.json】，绝不要把中文直接写进 curl -d。读数据用 curl|node 没问题（响应是 UTF-8 JSON）。
${POLL}
原则：每步【触发→核实】，失败就重试或如实上报 ok:false，不要跳过核实。`
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
   然后 `node _create_drama.mjs`，从输出取 id=dramaId、episodes[0].id=episodeId，用完删掉该文件。
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

// ============ Rewrite ============
phase('Rewrite')
const rewrite = await agent(`${common(DRAMA, EP)}
任务：触发 script_rewriter 改写并落库。
1. POST /agent/script_rewriter/chat {message:"请读取剧本并改写为格式化剧本，然后保存", drama_id:${DRAMA}, episode_id:${EP}}  （阻塞 1-3 分钟）
2. 核实：GET /dramas/${DRAMA}，该集 script_content 非空且【不是占位文本】。
3. 若仍空：把 agent 返回 text 里干净的剧本文本，用 node JSON.stringify 构造 body，PUT /episodes/${EP} {script_content:<文本>} 手动写回，再核实。
返回 ok + 剧本字数。`,
  { phase: 'Rewrite', label: 'rewrite', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Extract ============
phase('Extract')
const extract = await agent(`${common(DRAMA, EP)}
任务：触发 extractor 提取角色与场景。
1. POST /agent/extractor/chat {message:"请从剧本中提取所有角色和场景信息，提取时自动与项目已有数据进行去重合并", drama_id:${DRAMA}, episode_id:${EP}}
2. 核实：GET /episodes/${EP}/characters（应有2角色：女骑手、男骑手/青年大叔），GET /episodes/${EP}/scenes（应≥1场景）。
3. 【重要】检查每角色 appearance 是否详尽（性别/年龄/发型/着装/神态，≥30字）。不足则 PUT /characters/:id {appearance:"<中文外观>"} 补全：
   女骑手：年轻女性，利落黑色短发，深色机车皮夹克与长裤，神情淡定自信，身材矫健。
   男骑手（青年大叔）：憨厚中年男性，微胖圆脸，寸头，旧夹克/格子衫，表情丰富易惊讶。
返回 ok + 角色数/场景数 + 角色 id 列表。`,
  { phase: 'Extract', label: 'extract', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Voice ============
phase('Voice')
const voice = await agent(`${common(DRAMA, EP)}
任务：为角色分配【已验证可用】的音色，并用试听确认 TTS 链路通。
背景：音色库 sync 在 chatfire 下不可用，但 OpenAI 风格音色名 {alloy,echo,fable,onyx,nova,shimmer} 经 chatfire→minimax 能正常合成（既有成片已验证：女=shimmer, 男=fable）。
1. GET /episodes/${EP}/characters 拿角色列表。
2. 直接分配（PUT /characters/:id {voice_style})：
   - 女性角色 → voice_style:"shimmer"
   - 男性角色 → voice_style:"fable"
   （也可先跑 POST /agent/voice_assigner/chat {message:"请为所有角色分配合适的音色"}，但务必校正到 shimmer/fable。）
3. 【TTS 可用性闸门】对一个角色 POST /characters/:id/generate-voice-sample {episode_id:${EP}}。
   成功（返回 voice_sample_url）= TTS 链路通；失败（404/voice 无效/key 问题）= ok:false 并把完整错误写进 details/warnings。本闸门失败会阻止后续烧钱的视频阶段，必须如实。
全部角色已分配有效音色 + 试听成功才算 ok=true。`,
  { phase: 'Voice', label: 'voice', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Storyboard ============
phase('Storyboard')
const storyboard = await agent(`${common(DRAMA, EP)}
任务：触发 storyboard_breaker 拆分镜。
1. POST /agent/storyboard_breaker/chat {message:"请拆解分镜并生成视频提示词。视频模型：doubao-seedance-1-5-pro-251215（火山 Seedance 图生视频，单镜 4-12 秒）。请据此生成合适的 video_prompt，并为每个镜头生成静态首帧用的 image_prompt（英文为主，描述构图、人物、景别），每个镜头绑定对应角色与场景，时长 4-8 秒。", drama_id:${DRAMA}, episode_id:${EP}}
2. 核实：GET /episodes/${EP}/storyboards，镜头数>0（预期 4-6 镜）。
3. 每镜都应有 image_prompt 与 video_prompt；空字段用 PUT /storyboards/:id 补。
4. 确保 dialogue 格式为 "角色名：台词"（如 "女骑手：你刚说啥？"），便于 TTS 按角色取音色。纯动作镜（摔车）可无对白。
返回 ok + 镜头数。`,
  { phase: 'Storyboard', label: 'storyboard', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ Images ============
phase('Images')
const images = await agent(`${common(DRAMA, EP)}
任务：生成角色形象图、场景图、每个镜头首帧。
A. 角色图：GET /episodes/${EP}/characters 拿 ids；POST /characters/batch-generate-images {character_ids:[..], episode_id:${EP}}；轮询 GET /episodes/${EP}/characters 直到每个角色 image_url 有值。
B. 场景图：GET /episodes/${EP}/scenes；对每个 POST /scenes/:id/generate-image {episode_id:${EP}}；轮询直到 scene.image_url 有值。
C. 每镜首帧（单帧方式，不用宫格，更稳）：GET /episodes/${EP}/storyboards 拿各镜 image_prompt/character_ids/scene_id。对每镜 POST /images {storyboard_id, drama_id:${DRAMA}, prompt:"<image_prompt或description>, 竖屏9:16, cinematic, high quality", size:"1080x1920", frame_type:"first_frame", reference_images:["<角色image_url>","<场景image_url>"]}。reference_images 用 GET 结果里的 image_url（形如 static/images/xxx.png）。后端生成完自动写 storyboard.first_frame_image。轮询 GET /episodes/${EP}/storyboards 直到每镜 first_frame_image 有值。
失败逐个重试1次；仍失败记 warning 继续。返回 ok + 角色图/场景图/首帧 的成功计数。`,
  { phase: 'Images', label: 'images', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ============ TTS ============
phase('TTS')
const tts = await agent(`${common(DRAMA, EP)}
任务：为每个有对白的镜头生成配音。
1. GET /episodes/${EP}/storyboards。
2. 对 dialogue 非空的镜头：POST /storyboards/:id/generate-tts（同步，按 "角色名：台词" 取该角色 voice_style）。无对白镜（摔车）跳过。
3. 核实：有对白的镜头都有 tts_audio_url。若返回 400 "没有可生成的对白" 但确有台词，检查 dialogue 是否 "角色名：台词" 格式，PUT /storyboards/:id {dialogue} 修正后重试。
返回 ok + 成功/跳过计数。`,
  { phase: 'TTS', label: 'tts', agentType: 'general-purpose', schema: STATUS, effort: 'medium' })

// ===== 安全闸门：前置若失败，绝不动视频（最贵）=====
const gateOk = rewrite.ok && extract.ok && voice.ok && storyboard.ok && images.ok && tts.ok
if (!gateOk) {
  return {
    aborted: true,
    reason: '前置阶段有失败（见各 phase.ok），为避免在视频阶段白花 API 费用，已中止。',
    episodeId: EP, dramaId: DRAMA,
    phases: { rewrite, extract, voice, storyboard, images, tts },
  }
}

// ============ Video ============
phase('Video')
const video = await agent(`${common(DRAMA, EP)}
任务：每镜图生视频（火山 Seedance，最贵最慢）。TTS/图片已就绪，可放心跑。
1. GET /episodes/${EP}/storyboards，拿每镜 video_prompt/description/duration/first_frame_image。
2. 对每个【有 first_frame_image】的镜：POST /videos {storyboard_id, drama_id:${DRAMA}, prompt:"<video_prompt或description>", reference_mode:"single", image_url:"<first_frame_image, static/..>", duration:<4-8>, aspect_ratio:"9:16"}。分批触发（每批2-3个）降低限流；记录每个 video generation id。
3. 轮询所有 video id GET /videos/:id 直到 status=completed 且有 video_url/local_path，或 failed。单次 Bash sleep20/最多~25次（约8分钟），需要多次。总上限~40分钟。
4. failed 的重试1次。
返回 ok + 成功/失败计数。全部失败（key/余额）则 ok:false 并说明。`,
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

return {
  episodeId: EP, dramaId: DRAMA, dramaTitle: SCRIPT_TITLE,
  phases: { rewrite, extract, voice, storyboard, images, tts, video, compose, merge },
  workbench: `http://localhost:3013/drama/${DRAMA}/episode/1`,
}
