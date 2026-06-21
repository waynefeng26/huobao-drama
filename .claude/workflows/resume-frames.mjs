import fs from 'fs'
const BASE = 'http://localhost:5679/api/v1'
const firstResults = JSON.parse(fs.readFileSync('D:/code/huobao-drama/.claude/workflows/first-results.json','utf8'))

const chars = {
  7: 'static/images/ba14150b-24bd-4e13-ba00-82fc6ba44de5.png',
  8: 'static/images/24dbc1de-6220-44a0-877d-dc04550bc743.png',
}
const scenes = {
  8: 'static/images/826a646f-f152-42b2-b2af-841b1860ac8a.png',
  9: 'static/images/6764a66f-67b9-410a-8db7-7bdb526f605e.png',
  10: 'static/images/f79ca9e9-7714-4e9c-b8c4-8abe1b8aa15a.png',
}
const dialogueBySb = { 51:'憨厚小伙：',52:'短发美女：',54:'憨厚小伙：',55:'短发美女：',62:'短发美女：',63:'憨厚小伙：' }
const storyboards = JSON.parse(fs.readFileSync('D:/code/huobao-drama/.claude/workflows/sb-data.json','utf8'))
const lpArr = JSON.parse(fs.readFileSync('D:/code/huobao-drama/.claude/workflows/last-prompts.json','utf8'))
const lastPrompts = {}; for (const x of lpArr) lastPrompts[x.id] = x.last_prompt
const appText = { 7:'a young Chinese woman with neat black short hair, black leather jacket with silver zipper, black square sunglasses', 8:'a chubby young Chinese man with messy black hair, Hawaiian floral shirt (white base with red-green tropical flowers) buttoned all the way to the top' }

function pickMain(sb){const ids=sb.character_ids||[];if(ids.length===0)return null;if(ids.length===1)return ids[0];const d=dialogueBySb[sb.id];if(d){if(d.startsWith('短发美女：')&&ids.includes(7))return 7;if(d.startsWith('憨厚小伙：')&&ids.includes(8))return 8}return ids[0]}
function refs(sb){const r=[];const m=pickMain(sb);if(m!=null&&chars[m])r.push(chars[m]);if(scenes[sb.scene_id])r.push(scenes[sb.scene_id]);return r}
function firstPrompt(sb){let p=sb.image_prompt;const ids=sb.character_ids||[];if(ids.length>1){const m=pickMain(sb);const supp=ids.filter(i=>i!==m).map(i=>appText[i]).filter(Boolean).join('; ');if(supp)p+=`, also featuring in frame ${supp}`}return p}

const kind = process.argv[2] // 'first' | 'last'
const DELAY_MS = Number(process.argv[3] || 12000) // delay between submissions

async function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function postImage(body){const r=await fetch(`${BASE}/images`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return await r.json()}
async function poll(genId){const start=Date.now();while(Date.now()-start<560000){const r=await fetch(`${BASE}/images/${genId}`);const j=await r.json();const st=j.data?.status;if(st==='completed')return j.data?.localPath||j.data?.imageUrl;if(st==='failed'||st==='error')return null;await sleep(6000)}return null}

async function genOne(t){
  const prompt = kind==='first'?firstPrompt(t):lastPrompts[t.id]
  if(!prompt)return null
  const body={storyboard_id:t.id,drama_id:7,prompt:prompt+', 竖屏9:16, cinematic, high quality',size:'1080x1920',frame_type:kind==='first'?'first_frame':'last_frame',reference_images:refs(t)}
  for(let attempt=0;attempt<3;attempt++){
    const j=await postImage(body)
    if(j.code!==201&&j.code!==200){console.log(`sb=${t.id} submit err`,JSON.stringify(j).slice(0,150));await sleep(DELAY_MS);continue}
    const genId=j.data?.id
    console.log(`[${kind}] sb=${t.id} attempt=${attempt} genId=${genId} polling`)
    const url=await poll(genId)
    if(url){console.log(`[${kind}] sb=${t.id} DONE -> ${url}`);return url}
    console.log(`[${kind}] sb=${t.id} attempt=${attempt} failed (likely rate-limit), waiting ${DELAY_MS}ms`)
    await sleep(DELAY_MS)
  }
  return null
}

;(async()=>{
  const results = {...(kind==='first'?firstResults:{})}
  const todo = storyboards.filter(t=>{
    if(kind==='last'&&!lastPrompts[t.id])return false
    if(results[t.id])return false
    return true
  })
  console.log(`=== ${kind} RESUME todo=${todo.length} delay=${DELAY_MS}ms ===`)
  let ok=0,fail=0
  for(const t of todo){
    const url=await genOne(t)
    if(url){ok++;results[t.id]=url}else{fail++}
    await sleep(DELAY_MS) // throttle between shots
  }
  console.log(`=== ${kind.toUpperCase()} DONE ok=${ok} fail=${fail} ===`)
  fs.writeFileSync(`D:/code/huobao-drama/.claude/workflows/${kind}-results.json`,JSON.stringify(results,null,1))
})()
