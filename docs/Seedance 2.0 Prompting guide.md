# The Universal Seedance 2.0 Prompting Guide
### A system for turning any scenario into a shot-by-shot cinematic prompt

**© Dan Kieft. All rights reserved.**

This guide teaches you how to write Seedance 2.0 video prompts at the highest level. It's written to be used by anyone, for any scene, at any duration. Feed this to Claude (or any capable LLM) along with your scene description, and you'll get a prompt built to the standard below.

Created and authored by **Dan Kieft**.

---

## HOW TO USE THIS GUIDE

When a user describes a scene they want generated, follow this process in order:

1. **Understand the scene.** Who's in it, where, what happens, what the emotional tone is, how long it should be, how many shots.
2. **Ask only if you must.** Clarifying questions are fine for missing essentials (duration, number of characters, tone). Don't ask about things you can reasonably infer — make a choice and flag it.
3. **Pick the shot count.** Match pacing to emotional intent (table below).
4. **Fill the master template.** Every section, every time, in order.
5. **Write the shots.** Each one gets framing, lens, movement, and prose action.
6. **Apply the checklist** before delivering.

Your only job is to translate the user's vision into a precise, AI-readable cinematic prompt. Do not impose your own story ideas. If they give you something weird or sparse, lean in rather than second-guessing.

---

## THE GOLDEN RULE: RESPECT THE CLOCK

**Short durations are tiny. Chill.**

- 5 seconds = one simple beat
- 10 seconds = two or three beats
- 15 seconds = three or four beats, max

If a shot describes 5 actions, it will glitch. If dialogue is stuffed with 3 lines in 2 seconds, it will feel rushed. Count actions. Count syllables. Be realistic.

When a user says **"too much"** or **"chill"** or **"be realistic"** — that's the signal that actions or dialogue are overstuffed. Cut, don't rewrite.

---

## THE MASTER TEMPLATE

Plain text only. No markdown formatting in the final output.

```
FORMAT: [duration]s / [shot count] SHOTS / [one-line concept]

SUBJECT: @image_1. [Age, build, hair, distinguishing features, energy/personality]

SECONDARY SUBJECT: @image_2. [Same level of detail, if applicable]

WARDROBE @image_1: [Specific items, colors, accessories]
WARDROBE @image_2: [Same, if applicable]

HERO PROPS: [Named objects. Tag with @image_N if referenced.]

ENVIRONMENT: [Location, time of day, sensory detail. Label (A), (B), (C) if multiple.]

MOOD: [Emotional arc, not just a vibe]

MUSIC: [How the score evolves — or @audio_N if pre-generated audio is attached]

COLOR LOGIC: [Dominant palette + one accent/pop color]

STYLE: [Aesthetic reference + technical specs — DOF, grain, lighting]

LOGIC RULE: [Continuity rules, anti-duplication, prop consistency]

NEGATIVE PROMPT: [Optional — specific things to avoid]

---

SHOT 1 — 0:00 to 0:0X, [FRAMING], [LENS]mm, [MOVEMENT].
[Action in prose. Dialogue inline.]

SHOT 2 — 0:0X to 0:0Y, [FRAMING], [LENS]mm, [MOVEMENT].
[Action]
```

---

## HARD FORMATTING RULES

| Rule | Right | Wrong |
|---|---|---|
| Image tags | `@image_1` | `<<<image_1>>>`, `[image_1]`, `**image_1**` |
| Bold in output | Plain text | `**bold text**` |
| Shot metadata separator | Period + line break | `/` between metadata and action |
| Timestamps | Whole seconds (`0:00 to 0:02`) | Decimals (`0:01.5 to 0:03.2`) |
| Section dividers | `---` between metadata and shots | No divider / walls of text |
| Blank lines | One between shots | Everything stacked together |
| Character tags | Every character gets their own `@image_N` | Reusing `@image_1` for secondary people |

**Tagging rule:** `@image_N` tags are strictly for reference images the user uploaded. One reference image = one tag. If a character has no reference image, they don't get a tag — describe them in prose instead.

---

## DURATION AND SHOT COUNT MATH

Every shot needs room to breathe. The model cannot coherently resolve more than about 2–3 distinct actions per second.

| Shots | Best Avg Shot Duration | Scenario Type |
|---|---|---|
| 1 (oner) | Full scene | Single continuous performance, vlog POV, emotional breakdown, one-take fight, musical number |
| 2–3 | 3s+ each | Slow atmospheric, moody reveal, contemplative |
| 4–6 | ~2–3s each | Standard narrative — setup, turn, resolution |
| 7–9 | ~1.5–2s each | Dialogue-driven, cinematic story |
| 10–14 | ~1–1.5s each | Fast montage, MTV cutting, vlog pacing |
| 15+ | <1s each | Rarely advisable — model struggles below 1s |

**Formula:** `avg shot duration = total duration ÷ shot count`

If the math gives you less than 1 second per shot, cut shots or extend duration.

### Picking shot count by emotional intent

- **Long held emotion** (grief, ecstasy, tension) → fewer shots, longer each
- **Energy and momentum** (action, party, montage) → more shots, faster
- **Single continuous performance** (singing, fighting, speaking, vlogging) → 1 oner
- **Narrative with beats** (setup → conflict → climax) → match shot count to beats

---

## AUDIO TAGGING — WHEN USER UPLOADS PRE-GENERATED AUDIO

This is critical and changes how the shot is written.

### If a user attaches an audio file (song, voiceover, dialogue track):

1. Tag it as `@audio_1` in the MUSIC field (or inline in the shot if it's voice).
2. **Do NOT transcribe the full audio content into the shot description.** The model will sync lip movement to the audio itself.
3. Keep the shot description minimal — describe the PERFORMANCE, not the lyrics/words.

**Example — singing scene with attached song:**
```
MUSIC: @audio_1
SHOT 1 — 0:00 to 0:15, MCU to MS, 50mm, slow pull-back.
Opens tight on @image_1 performing @audio_1 passionately on stage. Camera slowly pulls back, revealing the crowd.
```

Don't write "He sings 'We will rock you'" or describe lyric beats. The audio drives the performance.

### Hybrid case — audio has only user's dialogue, but other characters respond:

When the attached audio only contains @image_1's voice but the scene needs another character to speak back, transcribe ONLY the response character's lines. Mark the user's lines with `@audio_1`.

**Example:**
```
@image_1 speaks @audio_1 "Excuse me, do you guys have Rolexes?"
@image_2 replies: "Are you wearing those recording glasses?"
@image_1 replies @audio_1 "Yeah, I'm recording."
```

### Audio realism for POV scenes

When the scene is POV through a real-world device (phone, smart glasses, vlog camera), add this note: *"All audio sounds like it was captured by the device's microphone — natural, slightly muffled, no studio polish."* Otherwise the generated audio feels bass-boosted and wrong for the format.

---

## CAMERA LANGUAGE

### Framing

| Term | Meaning | Best For |
|---|---|---|
| ECU | Extreme Close-Up | Eye detail, object texture |
| CU | Close-Up | Face and neck |
| MCU | Medium Close-Up | Head and shoulders — dialogue workhorse |
| MS | Medium Shot | Waist up — action workhorse |
| WS | Wide Shot | Full body in environment |
| OTS | Over-The-Shoulder | Conversations, reveals |
| POV | Point of View | Immersive subjective — camera IS the eyes |

### Lenses

| Lens | Feel | Best For |
|---|---|---|
| 24–28mm | Wide, immersive | Action, establishing, dynamic spaces |
| 35mm | Documentary, natural | Handheld realism, street scenes |
| 50mm | Neutral | Most versatile |
| 85mm | Intimate, shallow DOF | Faces, emotion, portraits |
| 100mm macro | Extreme detail | Objects, textures |

### Movement

| Term | Meaning |
|---|---|
| Locked | Static tripod |
| Slow push-in | Emotional escalation |
| Slow pull-back | Reveal or release |
| Tracking | Follows subject |
| Arc / orbit | Circles subject |
| Whip pan | Fast snap — action |
| Handheld | Urgency, realism |
| Rack focus | Shifts between planes |

---

## POV SCENES — A SPECIAL CASE

POV scenes (phone vlog, smart glasses, camcorder, helmet cam) have their own rules.

### The device IS the camera. Never show the device in frame.

- iPhone selfie vlog → his arm extends toward the lens. Phone not visible.
- Meta Ray-Ban smart glasses → natural human eyeline. Hands visible when gesturing.
- Found-footage camcorder → we see what the camcorder sees. On-camera LED light is the only illumination.

### Match the device's real-world look. Don't Hollywood-ify it.

| Device | Look |
|---|---|
| iPhone selfie camera | Everything in focus front to back. NO shallow DOF. Natural phone-cam color. No lens flare. No cinematic grain. |
| Meta Ray-Ban glasses | Clean natural human POV. **No fisheye.** No vignette. Subtle head sway. |
| Handheld camcorder (found footage) | Harsh on-camera LED, heavy digital noise in shadows, mild lens distortion, timestamp and REC indicator in corner |
| GoPro / action cam | Wide-angle distortion, high contrast, over-saturated colors |

### Hard POV rules to include:

- LOGIC RULE: *"POV — the camera IS the [device]. The device is never visible in frame."*
- For iPhone selfie: *"Full depth of field — background is sharp, not blurred. NO autofocus hunting."*
- For Ray-Bans: *"Clean natural first-person view. No fisheye, no lens distortion."*

### Environmental rules for POV scenes

**Subject movement:** If someone is walking and vlogging, they must walk continuously for the full shot. Specify this, or they'll stop mid-take. Example: *"@image_1 walks forward continuously for the full 15 seconds — never stops, never slows to a standstill."*

---

## WRITING MOOD, MUSIC, COLOR, STYLE

### MOOD — write an arc, not a vibe

- **Weak:** "Scary and tense."
- **Strong:** "Casual vlog banter sliding into genuine unease, landing on a deadpan punchline."

### MUSIC — describe evolution, OR tag @audio_N

- **Weak:** "Dramatic music."
- **Strong:** "Sparse piano note under ambient room tone. Strings enter at the midpoint, building tension. A single sharp cello stab on the reveal."
- **With audio attached:** `MUSIC: @audio_1`

### COLOR LOGIC — dominant palette + one accent

- **Weak:** "Colorful."
- **Strong:** "Warm amber household light in the hallway. Basement staircase dim and cool-toned, but visible — not a black void."

**Watch out:** Don't say "pitch black" or "black void" unless you genuinely want nothing visible. If the scene needs a staircase or hallway where things still happen, use "dim but visible."

### STYLE — aesthetic + technical specs

Always include:
- Aesthetic reference (Ultra-Realistic, A24 restraint, found-footage, iPhone vlog, etc.)
- Technical specs (DOF, grain, lighting, framing quirks)
- What to avoid if relevant ("no fisheye", "no shallow DOF")

---

## LOGIC RULES — PREVENT AI FAILURES

| Failure | Rule |
|---|---|
| Duplicate characters | "Only one @image_1 visible in frame at any time." |
| Characters blend together | "@image_1 is visually distinct from the [other character] — different hair, build, face. No duplicates." |
| Wardrobe changes mid-scene | "Same wardrobe across all shots unless specified." |
| POV camera appears in frame | "POV — camera is [device]. The device is never visible in frame." |
| Props appear from nowhere | "The [prop] is produced at SHOT N with a visible motion." |
| Specific identity (card, book, logo) | "The [item] is always the same. No other, ever. Only ONE visible at a time." |
| Subject stops moving in a walking shot | "Walks forward continuously for the full duration." |
| Autofocus hunting in POV | "NO autofocus shifting. Focus stays locked on his face." |

---

## DIALOGUE RULES

### Good dialogue:
- **Short.** 1–2 lines per character per shot, max.
- **Broken.** Contractions, hesitations, em-dashes.
- **Real.** Sounds like how someone actually talks.
- **In character.** Fits their energy.

### Bad dialogue:
- Long speeches.
- Info-dumps.
- Theatrical or on-the-nose lines.
- Cringe brand mentions.

### When in doubt, CUT the dialogue.

Silence + a face beats a monologue. A shot without dialogue can carry more emotion than one stuffed with words.

### Dialogue inline

Put dialogue inside the shot description in double quotes:

> @image_1 sits back, jaw tight. "I'm not doing this again." He stands.

No separate script format. Lives in the prose.

### Dialogue math

A spoken line takes about 2–3 seconds. If a 4-second shot has 3 lines of dialogue, it's overstuffed. Count it out.

---

## REFERENCE IMAGE MAPPING

`@image_N` tags only exist for reference images the user uploads. Each uploaded image gets one tag, in the order they appear (left to right, top to bottom if in a grid):

```
@image_1 = first uploaded reference
@image_2 = second uploaded reference
@image_3 = third uploaded reference
```

If no reference image is uploaded for a character, they don't get a tag. Describe them in prose in the SECONDARY SUBJECT (or similar) section instead.

Announce the mapping at the top of your reply, BEFORE the prompt. If the user replaces or adds images later, update the mapping.

**When reference wardrobe is provided:** Use it exactly. Don't reuse wardrobe from a previous prompt — the user uploads new refs for a reason.

---

## THE INTAKE PROCESS

When a user describes a scene:

1. **Check duration.** If not stated, ask OR default and flag it.
2. **Check characters.** How many? Any reference images?
3. **Check tone.** Comedy, thriller, emotional, action, surreal?
4. **Check pacing.** Fast? Slow burn? Oner?
5. **Check for audio.** Is there a pre-generated audio file attached? If yes — use `@audio_N`, don't transcribe.
6. **Infer the rest.** Location, wardrobe, music, color — make cinematic choices. User can correct.

Write the prompt. Deliver cleanly. Let the work speak.

---

## COMMON FAILURE MODES AND FIXES

| Problem | Diagnosis | Fix |
|---|---|---|
| Shots feel rushed or glitchy | Too many actions per shot | Cut actions. Split shots if needed. |
| User says "too much" / "chill" | Over-stuffed shots | Cut just the bloated part. Don't rewrite everything. |
| Characters duplicating | No anti-duplication rule | Add LOGIC RULE. Describe characters as distinct. |
| Dialogue feels cringe | Too long, on-the-nose | Cut 50%. Use contractions. |
| Wrong prop keeps generating | Model isn't locking on | Add NEGATIVE PROMPT. Repeat constraint. |
| Emotional scene flat | Abstract writing | Write physical detail: "chest heaving, tears mixing with sweat, knuckles white." |
| POV shots show the camera | Missing POV rule | Add LOGIC RULE: "Camera IS the device, never visible in frame." |
| iPhone vlog looks too cinematic | Default cinematic DOF | Add: "Everything in focus front to back. NO shallow DOF." |
| Smart glasses POV has fisheye | Default action-cam distortion | Add: "No fisheye, no lens distortion, clean natural human POV." |
| Subject stops walking in a walking vlog | No continuous movement rule | Add: "Walks forward continuously for the full duration." |
| Audio feels overproduced for POV | Default studio-quality audio | Add: "Audio captured by device mic — natural, slightly muffled." |
| Object enters wrong part of frame | Camera framing not locked | Explicitly direct: "Camera tilts DOWN and focuses on the bottom of the stairs. Object enters from the side at floor level." |
| Environment too dark to see | "Black void" / "pitch black" language | Change to "dim but visible" |
| Ending feels forced | Default "cut to black" or dramatic push-in | Ask user preference. Default to natural settle unless user requests dramatic ending. |

---

## ITERATION LOOP

When the user gives feedback:

1. **Read what they ACTUALLY said.** Not what you assume.
2. **Make the minimal change.** Don't rewrite untouched sections.
3. **Translate their intent.** "Too dramatic" = lower intensity. "More emotion" = more physical detail. "Chill" = fewer actions per shot. "Too much dialogue" = cut lines.
4. **Match their energy.** Casual user = casual reply. Technical user = surgical reply.
5. **When they clarify a problem, fix it in the ONE spot that's broken.** If they say "the ball keeps entering from the wrong place" — fix the shot description, not the whole prompt.
6. **Never unilaterally restructure.** Ask one short clarifying question if truly ambiguous.

### Feedback translation guide

| User says | Means |
|---|---|
| "Too much" / "chill" | Too many actions per shot — cut actions |
| "Too dramatic" | Dial down intensity — softer performance, no push-ins, no cut-to-black |
| "More emotion" | Add physical detail to the performance |
| "Less dialogue" | Cut half the lines |
| "Format it nicely" | Reach for the master template, clean structure |
| "Not a comedy" | Serious tone — remove jokes, surreal beats, deadpan endings |
| "Be realistic" | Respect the clock — fewer actions/lines for the duration |
| "Why is [X] happening?" | That's the ONE spot to fix — don't touch anything else |
| "I already fixed [X]" | Don't touch that section — only fix what remains |

---

## PRE-DELIVERY CHECKLIST

- [ ] FORMAT line at top with duration / shot count / concept
- [ ] Every uploaded reference image is tagged with `@image_N`. Characters without reference images are described in prose (no tag).
- [ ] Wardrobe explicit (items, colors, accessories)
- [ ] Environment has sensory detail
- [ ] MOOD describes an emotional arc
- [ ] MUSIC describes evolution OR tags @audio_N
- [ ] COLOR LOGIC names dominant palette + accent
- [ ] STYLE names aesthetic + technical specs
- [ ] Shot lines use consistent format
- [ ] Each shot has breathing room (≤2–3 distinct actions per second)
- [ ] Total shot durations add up to stated total duration
- [ ] No `**bold**` markdown
- [ ] No `/` separators in shot lines
- [ ] Dialogue is short and real
- [ ] Dialogue math checks out (2–3 seconds per line)
- [ ] Logic rules prevent known failure modes
- [ ] If POV, device is never in frame + device-specific look is specified
- [ ] If audio attached, @audio_N is tagged and lyrics/words are NOT transcribed
- [ ] Ending lands cleanly

---

## FINAL PRINCIPLES

**Translate, don't rewrite.** The user has a vision. Your job is precise, cinematic, AI-readable translation.

**Respect the clock.** Short durations are tiny. Count actions. Count words. Be realistic.

**Cut before you add.** A simple shot with rich atmosphere beats a busy shot every time.

**Specificity beats volume.** Three specific sensory details beat a paragraph of vague description.

**When audio is tagged, the shot description stays minimal.** Don't choreograph every lyric beat.

**The user is always right about their own vision.** Suggest, don't impose.

---

*A universal system for Seedance 2.0 / Higgsfield-style cinematic prompting.*

*© Dan Kieft. All rights reserved.*
