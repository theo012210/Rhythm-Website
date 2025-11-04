/**
 * Rhythm Guessing - script.js
 * - Generates a 2-bar rhythm according to level rules
 * - Renders using VexFlow (via CDN)
 * - Shows 3 distractor options plus the correct one
 * - Toast feedback bottom-left
 */

// Basic utilities and music token definitions
const UNIT = 1; // smallest unit = demisemiquaver (1/32 note) -> we'll call it 1 unit
const UNITS_PER_QUARTER = 8; // quarter = 8 units
const UNITS_PER_BAR = UNITS_PER_QUARTER * 4; // 32 units per bar

const TYPES = {
  semibreve: {name:'semibreve', units: 32, vfDur:'w'},
  minim: {name:'minim', units: 16, vfDur:'h'},
  crotchet: {name:'crotchet', units: 8, vfDur:'q'},
  quaver: {name:'quaver', units: 4, vfDur:'8'},
  semiquaver: {name:'semiquaver', units: 2, vfDur:'16'},
  demisemiquaver: {name:'demisemiquaver', units: 1, vfDur:'32'},
};

function dottedOf(type){
  return {name:`dotted-${type.name}`, units: Math.floor(type.units * 1.5), vfDur: type.vfDur, dots:1};
}

// Triplet group (we'll implement as a tuple of three crotchet/eighths depending on selected base value)
function tripletGroup(baseType){
  // baseType is usually quaver or crotchet - we'll set as quaver (three quaver-triplets occupy 1 beat)
  return {name:`triplet-${baseType.name}`, units: UNITS_PER_QUARTER, isTriplet:true, base:baseType};
}

// Level config
const LEVELS = {
  easy: {
    allowed:['semibreve','minim','crotchet','quaver'],
    required:['semibreve','minim','crotchet','quaver'],
    allowDotted:false,
    allowTriplets:false,
    halfOfTypes:false
  },
  medium: {
    allowed:['semibreve','minim','crotchet','quaver','semiquaver'],
    required:['semibreve','minim','crotchet','quaver','semiquaver','dotted','triplet'],
    allowDotted:true,
    allowTriplets:true,
    halfOfTypes:false
  },
  difficult: {
    allowed:['semibreve','minim','crotchet','quaver','semiquaver','demisemiquaver'],
    required:[], // choose half of the types randomly
    allowDotted:false,
    allowTriplets:false,
    halfOfTypes:true
  }
};

// DOM
const vfContainer = document.getElementById('renderer');
const optionsContainer = document.getElementById('optionsContainer');
const levelSelect = document.getElementById('level');
const newBtn = document.getElementById('newBtn');
const playBtn = document.getElementById('playBtn');
const toast = document.getElementById('toast');
const toastManager = new Toasts({position:'bottom-left', offsetX:16, offsetY:16});

let currentCorrectIndex = null;
let currentRhythm = null;
let attemptsRemaining = 3;
let rng = (n)=>Math.floor(Math.random()*n);

let audioCtx = null;
let scheduledOscillators = [];
let playbackTimeout = null;
let isPlaying = false;
const TEMPO_BPM = 96;
const secondsPerUnit = (60 / TEMPO_BPM) / UNITS_PER_QUARTER;

function ensureAudioContext(){
  if(!audioCtx){
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if(audioCtx.state === 'suspended'){
    audioCtx.resume();
  }
}

function finalizePlaybackState(){
  isPlaying = false;
  scheduledOscillators = [];
  if(playbackTimeout){
    clearTimeout(playbackTimeout);
    playbackTimeout = null;
  }
  if(playBtn){
    playBtn.disabled = false;
    playBtn.textContent = 'Play (metronome)';
  }
}

function stopPlayback(){
  if(scheduledOscillators.length){
    for(const osc of scheduledOscillators){
      try { osc.stop(); } catch(e){/* ignore */}
    }
  }
  finalizePlaybackState();
}

function scheduleClick(time, accent){
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(accent ? 880 : 660, time);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(accent ? 0.6 : 0.4, time + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.15);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(time);
  osc.stop(time + 0.2);
  osc.onended = ()=>{
    gain.disconnect();
  };
  scheduledOscillators.push(osc);
}

function playRhythm(bars){
  if(!bars || !bars.length){
    return;
  }
  ensureAudioContext();
  stopPlayback();
  if(playBtn){
    playBtn.disabled = true;
    playBtn.textContent = 'Playing...';
  }
  isPlaying = true;

  let startTime = audioCtx.currentTime + 0.1;
  let cursor = startTime;

  for(const bar of bars){
    let isFirstNoteInBar = true;
    for(const token of bar){
      if(token.isTriplet){
        const subDur = (token.units / 3) * secondsPerUnit;
        for(let i=0;i<3;i++){
          scheduleClick(cursor, isFirstNoteInBar && i === 0);
          cursor += subDur;
        }
      } else {
        scheduleClick(cursor, isFirstNoteInBar);
        cursor += token.units * secondsPerUnit;
      }
      isFirstNoteInBar = false;
    }
  }

  playbackTimeout = setTimeout(()=>{
    finalizePlaybackState();
  }, Math.max(0, (cursor - startTime) * 1000 + 150));
}

// -- Generation helpers --
function pickRandom(arr){return arr[Math.floor(Math.random()*arr.length)];}

function cloneBars(bars){
  return bars.map(bar=>bar.map(token=>Object.assign({}, token)));
}

function barsKey(bars){
  return bars.map(bar=>bar.map(token=>{
    if(token.isTriplet) return `triplet:${token.base ? token.base.name : ''}`;
    return `${token.name}:${token.units}:${token.vfDur || ''}:${token.dots || 0}`;
  }).join('-')).join('|');
}

function generateForLevel(levelKey){
  const cfg = LEVELS[levelKey];

  // compute allowed types as objects
  let allowed = cfg.allowed.map(k=>TYPES[k]);
  // include dotted if allowed
  if(cfg.allowDotted){
    // dotted variants of crotchet/quaver/semiquaver etc are allowed
  allowed = allowed.concat(allowed.map(t=>({name:'dotted-'+t.name, units:Math.floor(t.units*1.5), vfDur:t.vfDur, dots:1})));
  }
  // triplets allowed -> we'll allow triplet groups of quavers (3 in one beat)
  const tripletTemplate = tripletGroup(TYPES.quaver);

  // required tokens
  let requiredTokens = [];
  if(cfg.halfOfTypes){
    // choose half of the available types from allowed base types (non-dotted)
    const baseTypes = LEVELS.difficult.allowed; // base keys
    const chooseCount = Math.max(1, Math.floor(baseTypes.length/2));
    const shuffled = baseTypes.slice().sort(()=>Math.random()-.5);
    const chosen = shuffled.slice(0, chooseCount);
    requiredTokens = chosen.map(k=>TYPES[k]);
  } else if(cfg.required && cfg.required.length){
    for(const r of cfg.required){
      if(r==='dotted'){
        // ensure at least one dotted from base allowed notes
  const base = LEVELS.medium.allowed.map(k=>TYPES[k]).find(t=>t.units<=16) || TYPES.crotchet;
  requiredTokens.push(dottedOf(base));
      } else if(r==='triplet'){
        requiredTokens.push(tripletTemplate);
      } else {
        requiredTokens.push(TYPES[r]);
      }
    }
  }

  // We will build two bars separately (each 32 units)
  function fillBar(withRequiredTokens){
    const tokens = [];
    let usedUnits = 0;

    // Insert the required tokens that we decide to place in this bar
    for(const t of withRequiredTokens){
      tokens.push(Object.assign({}, t));
      usedUnits += t.units;
    }

    // Fill remaining units with random allowed tokens
    const allowedPool = allowed.slice();
    // also triplet optionally
    if(cfg.allowTriplets) allowedPool.push(tripletTemplate);

    // greedy random fill
    const maxTries = 1000;
    let tries=0;
    while(usedUnits < UNITS_PER_BAR && tries < maxTries){
      tries++;
      // pick a random candidate
      const cand = pickRandom(allowedPool);
      if(usedUnits + cand.units > UNITS_PER_BAR) continue;
      tokens.push(Object.assign({}, cand));
      usedUnits += cand.units;
    }

    // If not exact, attempt adjustment by filling with smallest unit
    while(usedUnits < UNITS_PER_BAR){
  const smallest = {name:'demisemiquaver', units:1, vfDur:'32'}; // always allowed in worst-case when resolving
  tokens.push(smallest);
      usedUnits++;
    }

    // If overfilled (shouldn't happen), trim
    let i=0;
    while(usedUnits > UNITS_PER_BAR && tokens.length && i<50){
      const t = tokens.pop();
      usedUnits -= t.units;
      i++;
    }

    // final validation
    if(usedUnits !== UNITS_PER_BAR) {
      console.warn('bar units mismatch', usedUnits);
    }

    // shuffle tokens slightly so required tokens aren't always front
    return tokens.sort(()=>Math.random()-.5);
  }

  // Decide how to distribute requiredTokens across two bars
  const reqs = requiredTokens.slice();
  const barReqs = [[],[]];
  // place each required token in a random bar if it fits (if too big, put in its own bar)
  for(const req of reqs){
    // place in bar 0 or 1 randomly; but ensure it fits (i.e., doesn't exceed 32)
    const choice = Math.random() < 0.5 ? 0 : 1;
    barReqs[choice].push(req);
  }

  // Ensure the bars can still be filled: if a single required consumes >32 units (unlikely), adjust
  // Build bars
  const barTokens = [fillBar(barReqs[0]), fillBar(barReqs[1])];

  return {bars:barTokens};
}

// Convert our token representation into VexFlow StaveNotes and tuplets
function renderRhythmInto(div, bars, opts={width:600, height:140}){
  // clear
  div.innerHTML='';
  if(!window.Vex || !Vex.Flow){
    throw new Error('VexFlow library is not available.');
  }
  const VF = Vex.Flow;
  const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
  renderer.resize(opts.width, opts.height);
  const context = renderer.getContext();
  context.setFont('Arial', 10, 'normal');

  // create a stave across the width
  const staff = new VF.Stave(10, 10, opts.width-20);
  staff.addClef('percussion');
  staff.setContext(context).draw();

  // create two voices (one per bar)
  const allTuplets = [];
  const barNotes = [];

  // We'll place notes for each bar sequentially, but draw them on the same stave using formatter
  let allNotes = [];

  for(const bar of bars){
    const notes = [];
    for(const token of bar){
      if(token.isTriplet){
        // create three quaver notes and collect into tuplet
        const n1 = new VF.StaveNote({keys:['b/4'], duration:'8'});
        const n2 = new VF.StaveNote({keys:['b/4'], duration:'8'});
        const n3 = new VF.StaveNote({keys:['b/4'], duration:'8'});
        // add a rest style if needed? We'll keep as normal noteheads (for percussion clef it's fine)
        notes.push(n1,n2,n3);
        allTuplets.push(new VF.Tuplet([n1,n2,n3]));
      } else {
        const dur = token.vfDur || (()=>{
          // fallback mapping from units
          for(const k in TYPES) if(TYPES[k].units===token.units) return TYPES[k].vfDur;
          return 'q';
        })();
        const st = new VF.StaveNote({keys:['b/4'], duration:dur});
        if(token.dots){
          for(let d=0; d<token.dots; d++) st.addDotToAll();
        }
        notes.push(st);
      }
    }
    allNotes = allNotes.concat(notes);
    barNotes.push(notes);
  }

  // Create a single voice with total ticks = 8/4*2 bars -> VexFlow voices require ticks: we will create 2 voices and format them across the stave
  const voice = new VF.Voice({num_beats: 8,  beat_value: 4});
  voice.setMode(VF.Voice.Mode.SOFT);
  // add ticks for each note
  voice.addTickables(allNotes);

  // Format and draw
  const formatter = new VF.Formatter();
  formatter.joinVoices([voice]).format([voice], opts.width-60);
  voice.draw(context, staff);

  // Draw tuplets
  for(const t of allTuplets) t.setContext(context).draw();

  // Draw barlines between measures for clarity
  if(bars.length > 1){
    const topY = staff.getYForLine(0) - 1;
    const bottomY = staff.getYForLine(staff.getNumLines() - 1) + 1;
    context.save();
    context.setStrokeStyle('#111');
    context.setLineWidth(1.2);
    for(let i=1;i<barNotes.length;i++){
      const notes = barNotes[i];
      if(!notes.length) continue;
      const firstNote = notes[0];
      const x = Math.max(staff.getX() + 6, firstNote.getAbsoluteX() - 12);
      context.beginPath();
      context.moveTo(x, topY);
      context.lineTo(x, bottomY);
      context.stroke();
    }
    context.restore();
  }
}

function tokenLabel(token){
  if(token.isTriplet){
    const base = token.base ? token.base.name : 'quaver';
    return `Triplet (${base})`;
  }
  return (token.name || 'note').replace(/-/g,' ');
}

function renderRhythmFallback(div, bars){
  div.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'fallbackRhythm';
  bars.forEach((bar, idx)=>{
    const barRow = document.createElement('div');
    barRow.className = 'fallbackBar';
    const label = document.createElement('span');
    label.className = 'fallbackBarLabel';
    label.textContent = `Bar ${idx+1}`;
    const notes = document.createElement('span');
    notes.className = 'fallbackNotes';
    notes.textContent = bar.map(tokenLabel).join('   ');
    barRow.appendChild(label);
    barRow.appendChild(notes);
    wrap.appendChild(barRow);
  });
  div.appendChild(wrap);
}

function tryRenderRhythm(div, bars, opts){
  try {
    renderRhythmInto(div, bars, opts);
  } catch(err){
    console.error('Failed to render rhythm', err, bars);
    renderRhythmFallback(div, bars);
  }
}

// Option generation: create three distractors by mutating the correct bars
function generateOptions(correctBars, levelKey){
  const options = [correctBars];
  const seen = new Set([barsKey(correctBars)]);
  let attempts = 0;
  while(options.length < 4 && attempts < 200){
    attempts++;
    const candidate = generateForLevel(levelKey).bars;
    const key = barsKey(candidate);
    if(seen.has(key)) continue;
    options.push(candidate);
    seen.add(key);
  }

  while(options.length < 4){
    options.push(cloneBars(correctBars));
  }

  const order = options.map((o,i)=>({o,i})).sort(()=>Math.random()-.5);
  const shuffled = order.map(x=>x.o);
  const correctIndex = order.findIndex(x=>x.i===0);

  return {options:shuffled, correctIndex};
}

// UI wiring
function showToast(text, ok=true){
  toastManager.push({
    style: ok ? 'success' : 'error',
    title: ok ? 'Great job!' : 'Try again',
    content: text,
    dismissAfter: '2000ms',
    closeButton: false
  });
}

function renderOptionCard(container, bars, idx){
  const card = document.createElement('div');
  card.className='optionCard';
  const label = document.createElement('div');
  label.className = 'optionLabel';
  label.textContent = `Option ${idx+1}`;
  card.appendChild(label);
  const canvas = document.createElement('div');
  canvas.className='optionRenderer';
  card.appendChild(canvas);
  card.addEventListener('click',()=>{
    if(attemptsRemaining <= 0) return;
    if(currentCorrectIndex===idx){
      attemptsRemaining = 0;
      showToast('Correct!', true);
      setTimeout(()=>{
        // Automatically progress after a short delay
        newQuestion();
      }, 600);
    } else {
      attemptsRemaining -= 1;
      if(attemptsRemaining > 0){
        const triesWord = attemptsRemaining === 1 ? 'try' : 'tries';
        showToast(`Not quite. ${attemptsRemaining} ${triesWord} left.`, false);
      } else {
        showToast(`Out of tries! The correct option was option ${currentCorrectIndex+1}.`, false);
        setTimeout(()=>{
          newQuestion();
        }, 900);
      }
    }
  });
  container.appendChild(card);
  // render a smaller VexFlow graphic inside canvas
  const rect = card.getBoundingClientRect();
  const renderWidth = Math.max(360, Math.floor((rect.width || 0) - 32));
  const renderHeight = Math.max(120, Math.floor(renderWidth * 0.34));
  tryRenderRhythm(canvas, bars, {width:renderWidth, height:renderHeight});
}

function newQuestion(){
  const level = levelSelect.value;
  const gen = generateForLevel(level);
  const {options, correctIndex} = generateOptions(gen.bars, level);
  currentCorrectIndex = correctIndex;
  attemptsRemaining = 3;
  currentRhythm = options[correctIndex];
  if(isPlaying) stopPlayback();

  // hide visual question for listening-only mode
  if(vfContainer){
    vfContainer.innerHTML = '';
    vfContainer.style.display = 'none';
  }

  // render options
  optionsContainer.innerHTML='';
  options.forEach((opt, i)=> renderOptionCard(optionsContainer, opt, i));
}

// initial
newBtn.addEventListener('click', newQuestion);
levelSelect.addEventListener('change', ()=> newQuestion());
if(playBtn){
  playBtn.addEventListener('click', ()=>{
    if(isPlaying){
      stopPlayback();
    } else {
      playRhythm(currentRhythm);
    }
  });
}

// first question
newQuestion();
