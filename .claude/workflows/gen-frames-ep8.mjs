import fs from 'fs'

const BASE = 'http://localhost:5679/api/v1'

// characters
const chars = {
  7: { name: '短发美女', url: 'static/images/ba14150b-24bd-4e13-ba00-82fc6ba44de5.png' },
  8: { name: '憨厚小伙', url: 'static/images/24dbc1de-6220-44a0-877d-dc04550bc743.png' },
}
// scenes
const scenes = {
  8: 'static/images/826a646f-f152-42b2-b2af-841b1860ac8a.png',
  9: 'static/images/6764a66f-67b9-410a-8db7-7bdb526f605e.png',
  10: 'static/images/f79ca9e9-7714-4e9c-b8c4-8abe1b8aa15a.png',
}

// dialogue per storyboard (only those with dialogue) to pick main char
const dialogueBySb = {
  51: '憨厚小伙：沟！沟！沟！！',
  52: '短发美女：收到！Go Go！',
  54: '憨厚小伙：沟沟沟！！！有沟啊！！！',
  55: '短发美女：Go Go Go！冲！',
  62: '短发美女：你刚说啥？',
  63: '憨厚小伙：我——说——有——沟——啊！！！',
}

// storyboard data: id -> {character_ids, scene_id, image_prompt}
const storyboards = JSON.parse(fs.readFileSync('D:/code/huobao-drama/.claude/workflows/sb-data.json','utf8'))

// last prompts
const lastPrompts = {}
const lpArr = JSON.parse(fs.readFileSync('D:/code/huobao-drama/.claude/workflows/last-prompts.json','utf8'))
for (const x of lpArr) lastPrompts[x.id] = x.last_prompt

// supplementary appearance text for non-main chars in multi-char shots
const appText = {
  7: 'a young Chinese woman with neat black short hair, black leather jacket with silver zipper, black square sunglasses',
  8: 'a chubby young Chinese man with messy black hair, Hawaiian floral shirt (white base with red-green tropical flowers) buttoned all the way to the top',
}

function pickMainChar(sb) {
  const ids = sb.character_ids || []
  if (ids.length === 0) return null
  if (ids.length === 1) return ids[0]
  // multi: check dialogue
  const d = dialogueBySb[sb.id]
  if (d) {
    if (d.startsWith('短发美女：') && ids.includes(7)) return 7
    if (d.startsWith('憨厚小伙：') && ids.includes(8)) return 8
  }
  return ids[0]
}

function buildRefs(sb) {
  const refs = []
  const main = pickMainChar(sb)
  if (main != null && chars[main]) refs.push(chars[main].url)
  // scene
  const scUrl = scenes[sb.scene_id]
  if (scUrl) refs.push(scUrl)
  return { refs, main }
}

function buildFirstPrompt(sb) {
  // base image_prompt + append supp text for non-main char in multi-char shots
  const ids = sb.character_ids || []
  let p = sb.image_prompt
  if (ids.length > 1) {
    const main = pickMainChar(sb)
    const supp = ids.filter(i => i !== main)
    const suppStr = supp.map(i => appText[i]).filter(Boolean).join('; ')
    if (suppStr) p += `, also featuring in frame ${suppStr}`
  }
  return p
}

const tasks = []
for (const sb of storyboards) {
  const { refs, main } = buildRefs(sb)
  const fp = buildFirstPrompt(sb)
  const lp = lastPrompts[sb.id]
  tasks.push({ sb, refs, main, firstPrompt: fp, lastPrompt: lp })
}

// dump plan
console.log('=== PLAN ===')
for (const t of tasks) {
  console.log(`sb=${t.sb.id} chars=[${t.sb.character_ids}] main=${t.main} refs=[${t.refs.join(', ')}]`)
}

const results = { first: {}, last: {} }

async function postImage(body) {
  const r = await fetch(`${BASE}/images`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  return j
}

async function waitFor(genId, kind, sbId) {
  const start = Date.now()
  const max = 560_000
  while (Date.now() - start < max) {
    const r = await fetch(`${BASE}/images/${genId}`)
    const j = await r.json()
    const st = j.data?.status
    if (st === 'completed') {
      return j.data?.localPath || j.data?.imageUrl
    }
    if (st === 'failed' || st === 'error') return null
    await new Promise(res => setTimeout(res, 5000))
  }
  return null
}

async function submitOne(t, kind) {
  const prompt = kind === 'first' ? t.firstPrompt : t.lastPrompt
  if (!prompt) return { sb: t.sb.id, kind, genId: null, skipped: true }
  const body = {
    storyboard_id: t.sb.id,
    drama_id: 7,
    prompt: prompt + ', 竖屏9:16, cinematic, high quality',
    size: '1080x1920',
    frame_type: kind === 'first' ? 'first_frame' : 'last_frame',
    reference_images: t.refs,
  }
  const j = await postImage(body)
  if (j.code !== 201 && j.code !== 200) {
    console.log(`[${kind}] sb=${t.sb.id} submit FAILED:`, JSON.stringify(j).slice(0, 200))
    return { sb: t.sb.id, kind, genId: null }
  }
  const genId = j.data?.id
  console.log(`[${kind}] sb=${t.sb.id} genId=${genId} submitted`)
  return { sb: t.sb.id, kind, genId }
}

const arg = process.argv[2]
const CONCURRENCY = 5

async function runKind(kind) {
  const todo = tasks.filter(t => kind === 'first' || t.lastPrompt)
  // submit in batches of CONCURRENCY
  const submitted = []
  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY)
    const res = await Promise.all(batch.map(t => submitOne(t, kind)))
    submitted.push(...res)
  }
  // poll all
  const ok = {}, fail = {}
  const active = submitted.filter(s => s.genId)
  while (active.some(s => s.genId != null && !s.done)) {
    await Promise.all(active.filter(s => s.genId && !s.done).map(async (s) => {
      const r = await fetch(`${BASE}/images/${s.genId}`)
      const j = await r.json()
      const st = j.data?.status
      if (st === 'completed') {
        const url = j.data?.localPath || j.data?.imageUrl
        console.log(`[${kind}] sb=${s.sb} genId=${s.genId} DONE -> ${url}`)
        ok[s.sb] = url; s.done = true
      } else if (st === 'failed' || st === 'error') {
        console.log(`[${kind}] sb=${s.sb} genId=${s.genId} FAILED`)
        fail[s.sb] = true; s.done = true
      }
    }))
    if (active.some(s => s.genId && !s.done)) await new Promise(r => setTimeout(r, 5000))
  }
  // retry failures once (sequentially)
  const failIds = Object.keys(fail).map(Number)
  for (const t of todo) {
    if (failIds.includes(t.sb)) {
      console.log(`[${kind}] sb=${t.sb} RETRY`)
      const r = await submitOne(t, kind)
      if (r.genId) {
        const url = await waitForSingle(r.genId, kind)
        if (url) { ok[t.sb] = url; delete fail[t.sb] }
      }
    }
  }
  const okCount = Object.keys(ok).length
  const failCount = Object.keys(fail).length
  console.log(`=== ${kind.toUpperCase()} DONE ok=${okCount} fail=${failCount} ===`)
  fs.writeFileSync(`D:/code/huobao-drama/.claude/workflows/${kind}-results.json`, JSON.stringify(ok, null, 1))
}

async function waitForSingle(genId, kind) {
  const start = Date.now()
  while (Date.now() - start < 560_000) {
    const r = await fetch(`${BASE}/images/${genId}`)
    const j = await r.json()
    const st = j.data?.status
    if (st === 'completed') return j.data?.localPath || j.data?.imageUrl
    if (st === 'failed' || st === 'error') return null
    await new Promise(res => setTimeout(res, 5000))
  }
  return null
}

if (arg === 'first') runKind('first')
else if (arg === 'last') runKind('last')
else { console.log('usage: node gen-frames-ep8.mjs [first|last]') }
