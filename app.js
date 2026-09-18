// Схема песни: волна энергии сверху, строки со слогами по клеткам, запевы слева,
// точки в пустых клетках, границы фраз и знаки ключевых мест.
// Энергия рисуется мышкой по волне, клик по волне ставит ключевую точку или границу фразы.
// Клик по клетке открывает правку текста — редактор в конце файла.
const NS = 'http://www.w3.org/2000/svg';
// Размеры — как при печати: клетка 4,5 мм, текст 9 пт шрифтом Fira Sans Condensed.
const U = 17;                              // ширина клетки
const ROW_H = 18, GAP = 3, TOP = 4, PAD = 0.5;
const LEFT = 4, ZAPEV_GAP = 3, RIGHT = 4;     // запев отстоит от сетки как слоги друг от друга
const NUM_W = 18;                          // поле справа под номер куплета
const SPLIT = 5;                           // разрез между коленами: заметно уже клетки, доли не даёт
const RIBBON = 56, RIBBON_GAP = 10;        // двусторонняя волна над схемой
const MAX_ZOOM = 2;                        // короткая песня не растягивается на весь экран
const MIN_ZOOM = 1.2;                      // мельче этого работать неудобно: длинная песня едет вбок
const FONT = 'Fira Sans Condensed';
const FLOOR = 0.03;                        // тоньше волоска волна не бывает
const START = 0.35;                        // ровная волна, пока энергию не нарисовали
const RES = 4;                             // столько чисел энергии на клетку: рисовать точнее, чем по клеткам
const SOFT = 1;                            // лёгкое разглаживание: снимает дрожание руки, но не резкие взлёты
const SIZE = { 1: 3.6, 2: 5.2, 3: 7 };     // звезда ключевого места: радиус по уровню
const FADE = { 1: 0.34, 2: 0.62, 3: 0.95 };  // яркость мазков у ключевого слога
const LOW = [222, 205, 234], HIGH = [126, 61, 146];  // сиреневая гамма: тусклое → яркое

const list = document.getElementById('list');
const main = document.getElementById('song');
let songs = [];
let song = null;   // открытая песня

// Одна и та же страница работает у Дмитрия и у ученика. У Дмитрия её раздаёт программа
// и отвечает на /api/songs; на статическом хостинге этого запроса нет — значит ученик.
let author = true;
const blank = decodeURIComponent(location.search.slice(1));   // ?vereya — заготовка задания в ссылке
const DRAFT = `draft:${blank}`;                               // черновик ученика в браузере

// Память браузера бывает закрыта: в приватном окне обращение к ней падает.
const store = {
  get: key => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, value) => { try { localStorage.setItem(key, value); return true; } catch { return false; } },
  del: key => { try { localStorage.removeItem(key); } catch { /* нечего стирать */ } },
};

const emptySong = title => ({ id: title, title, cols: 16, notes: '', energy: [],
                              types: [{ keys: [], hints: [], bounds: [] }], rows: [{ type: 0, cells: [] }] });

const svgEl = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return parent.appendChild(e);
};
const htmlEl = (tag, parent, text = '', className = '') => {
  const e = parent.appendChild(document.createElement(tag));
  e.textContent = text;
  if (className) e.className = className;
  return e;
};
// Цвет волны по энергии: чем сильнее место, тем гуще и ярче.
const wave = (v, alpha) => `rgba(${LOW.map((c, i) => Math.round(c + (HIGH[i] - c) * v)).join(',')},${alpha.toFixed(3)})`;

// Энергия хранится числами по долям клетки. Между ними — кривая Катмулла-Рома:
// она проходит через сами точки, а переходы получаются плавными, без углов.
function energyAt(energy, x, res = RES) {
  const n = energy.length, t = Math.min(Math.max(x * res - 0.5, 0), n - 1), i = Math.floor(t), f = t - i;
  const at = k => energy[Math.min(n - 1, Math.max(0, k))];
  const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
  const v = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (p3 - p0 + 3 * (p1 - p2)) * f * f * f);
  return Math.min(1, Math.max(0, v));
}

// Песни, нарисованные при более грубом шаге, пересчитываются на нынешний без потери формы.
function songEnergy(song) {
  const need = song.cols * RES, old = song.energy;
  if (!old?.length) return song.energy = new Array(need).fill(START);
  if (old.length === need) return old;
  const was = old.length / song.cols;
  return song.energy = Array.from({ length: need }, (_, i) => +energyAt(old, (i + 0.5) / RES, was).toFixed(3));
}

// Рука дрожит мельче, чем шаг песни, и кривая по самим числам выходит рваной. Поэтому
// перед отрисовкой энергия разглаживается по соседям — сами числа при этом не меняются,
// и нарисованное однажды не затирается при каждом новом взгляде на песню.
function smooth(energy, radius = SOFT) {
  const at = i => energy[Math.min(energy.length - 1, Math.max(0, i))];
  return energy.map((_, i) => {
    let sum = 0, total = 0;
    for (let d = -radius; d <= radius; d++) {
      const weight = radius + 1 - Math.abs(d);   // ближние соседи весомее дальних
      sum += at(i + d) * weight;
      total += weight;
    }
    return sum / total;
  });
}

// Контур волны: сверху вниз — замкнутый.
function wavePath(ctx) {
  const edges = [0, ...(ctx.splits || []), ctx.cols];
  let d = '';
  for (let part = 0; part + 1 < edges.length; part++) {
    const up = [], down = [];
    for (let i = edges[part] * 10; i <= edges[part + 1] * 10; i++) {
      const x = ctx.X(i / 10), h = ctx.THIN + energyAt(ctx.energy, i / 10) * (ctx.THICK - ctx.THIN);
      up.push(`${x.toFixed(1)},${(ctx.axis - h).toFixed(1)}`);
      down.push(`${x.toFixed(1)},${(ctx.axis + h).toFixed(1)}`);
    }
    d += `M${up.join('L')}L${down.reverse().join('L')}Z`;
  }
  return d;
}

// Звезда-всплеск: острые лучи разной длины из плотной сердцевины — знак ключевого места.
// Лучи прямые и широкие у основания, углы и длины слегка сбиты, чтобы не выглядело циркулем.
function splashPath(cx, cy, r, spikes = 11, core = 0.44) {
  const p = (a, rad) => `${(cx + Math.cos(a) * rad).toFixed(2)},${(cy + Math.sin(a) * rad).toFixed(2)}`;
  const step = 2 * Math.PI / spikes, pts = [];
  for (let i = 0; i < spikes; i++) {
    pts.push(p(step * (i + 0.14 * Math.sin(i * 1.9)), r * (0.66 + 0.34 * Math.abs(Math.sin(i * 2.7)))));
    pts.push(p(step * (i + 0.5 + 0.12 * Math.sin(i * 3.1)), r * core));
  }
  return `M${pts.join('L')}Z`;
}

// Знак ключевого места: звезда с мягким свечением, размер по уровню.
function pin(parent, cx, cy, level) {
  const r = SIZE[level];
  svgEl('path', { d: splashPath(cx, cy, r * 1.2), fill: '#efe4ff', opacity: 0.35, filter: 'url(#blur2)' }, parent);
  svgEl('path', { d: splashPath(cx, cy, r), fill: 'var(--pin)', opacity: 0.95 }, parent);
}

// Ключевой слог: мазки кистью сверху и снизу, толщина и яркость по уровню.
function accent(parent, cx, cy, w, level) {
  const half = Math.max(w / 2 + 1.5, 5), h = 1.3 + level;
  for (const dir of [1, -1]) {
    const y = cy + dir * 7;
    svgEl('path', { d: `M${cx - half} ${y}Q${cx} ${y + dir * h} ${cx + half} ${y}Q${cx} ${y + dir * h * 0.35} ${cx - half} ${y}Z`,
                    fill: 'var(--accent)', opacity: FADE[level] }, parent);
  }
}

// Повтор колена: мазок кистью со стрелкой.
function repeatMark(parent, cx, cy) {
  const g = svgEl('g', { transform: `translate(${cx} ${cy}) scale(.8)`, class: 'mark' }, parent);
  svgEl('path', { d: 'M4.4 -6 C7.2 -2.2 6 3.4 -1 5.4 L-0.6 3.4 C4.6 1.6 5.8 -2 3 -5.4 Z' }, g);
  svgEl('path', { d: 'M-4.4 4.4 L1.2 1.6 L0.6 6.8 Z' }, g);
}

// Шрифт должен загрузиться до отрисовки: по нему измеряются и сжимаются слоги.
// Не загрузился — рисуем запасным: схема без шрифта хуже, чем пустая страница вместо неё.
const fontsReady = Promise.all(['', 'bold '].map(s => document.fonts.load(`${s}12px "${FONT}"`)))
  .catch(() => null);
(async () => {
  const [data] = await Promise.all([
    fetch('/api/songs').then(r => (r.ok ? r.json() : null)).catch(() => null),
    fontsReady,
  ]);
  author = data !== null;
  document.body.classList.toggle('student', !author);
  if (author) {
    songs = data.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
    if (!songs.length) return htmlEl('p', main, 'Песен нет: положите файлы песен в songs/');
    fillList();
    list.onchange = () => { location.hash = encodeURIComponent(list.value); };
  } else {
    songs = [await studentSong()];
    startName();
    if (!save(songs[0])) noMemory();   // первая же запись показывает, есть ли куда сохранять
  }
  window.onhashchange = show;
  window.onresize = show;  // масштаб зависит от размера окна
  show();
})();

// Приватное окно и запрет на память: обещание «работа сохраняется сама» стало бы обманом.
function noMemory() {
  const note = document.getElementById('auto');
  note.textContent = ' Браузер не сохраняет работу: не закрывайте вкладку и сохраните черновик в файл.';
  note.style.color = '#a00';
}

// Ученик работает с одной песней: заготовкой задания из ссылки или пустым листом.
// Черновик живёт в браузере — закрытая вкладка не должна стоить часа набора.
async function studentSong() {
  const draft = store.get(DRAFT);
  if (draft) {
    try { return JSON.parse(draft); } catch { /* черновик испорчен — начинаем с заготовки */ }
  }
  const file = blank && await fetch(`blanks/${encodeURIComponent(blank)}.json`)
    .then(r => (r.ok ? r.json() : null)).catch(() => null);
  return file ? { ...file, id: file.title } : emptySong('Схема песни');
}

function fillList() {
  songs.sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  list.replaceChildren();
  htmlEl('option', list, 'Песня не выбрана').value = '';
  for (const s of songs) htmlEl('option', list, s.title).value = s.id;
}

function duplicateSong(source, taken = songs) {
  const base = `${source.title} — копия`;
  let title = base;
  for (let n = 2; taken.some(s => s.id === title); n++) title = `${base} ${n}`;
  return { ...JSON.parse(JSON.stringify(source)), id: title, title };
}

const HELP = { '!read': 'read', '!fill': 'fill' };
let backTo = '';   // куда возвращает «Назад к схеме» из справки

function show() {
  showSpacing();
  keepScroll = main.querySelector('.sheet')?.scrollLeft || 0;  // перерисовка не должна сбивать вид
  const id = decodeURIComponent(location.hash.slice(1));
  main.replaceChildren();
  if (HELP[id]) { sel = null; return drawHelp(main, HELP[id]); }
  backTo = location.hash;
  song = author ? songs.find(s => s.id === id) || null : songs[0];
  list.value = song ? song.id : '';
  if (!song) return drawStart(main);   // пустой лист: песню ещё не выбрали
  const h1 = htmlEl('h1', main, song.title);
  // У ученика своих песен в списке нет — название схемы правится кликом по заголовку,
  // чтобы файлы и картинки разных песен не назывались все одинаково.
  if (!author) {
    h1.title = 'Нажмите, чтобы назвать схему';
    h1.onclick = () => {
      const title = prompt('Название схемы', song.title)?.trim();
      if (!title || title === song.title) return;
      song.title = title;
      save(song);
      show();
    };
  }
  if (song.link) showLink(main, song.link);
  const sheet = htmlEl('div', main, '', 'sheet');
  const notes = song.notes ? htmlEl('p', main, song.notes, 'notes') : null;
  window.scrollTo(0, 0);  // до отрисовки: по прокрутке считаются и масштаб, и место поля правки
  drawScheme(sheet, song, (notes ? notes.offsetHeight : 0) + 40);
}

// Ссылка на выложенную заготовку остаётся при песне: её и дают ученикам.
function showLink(parent, url) {
  const line = htmlEl('p', parent, 'Ссылка для учеников: ', 'link');
  Object.assign(htmlEl('a', line, url), { href: url, target: '_blank', rel: 'noopener' });
  htmlEl('button', line, 'Убрать').onclick = unpublish;
}

let saving;
function save(song) {
  clearTimeout(saving);  // сохранение само, но не на каждое движение мышки
  if (!author) return store.set(DRAFT, JSON.stringify(song));   // у ученика песня живёт в браузере
  const { id, ...body } = song;
  saving = setTimeout(() => fetch(`/api/songs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) }), 400);
}

// Тип, по которому идёт волна: тот, которым размечено больше всего строк.
// Первый куплет с особой разметкой волна просто не учитывает.
function mainType(song) {
  const count = song.types.map(() => 0);
  for (const row of song.rows) count[row.type]++;
  return count.indexOf(Math.max(...count));
}

function writeText(text, cell) {
  for (const part of Array.isArray(cell.t) ? cell.t : [cell]) {
    const span = svgEl('tspan', {}, text);
    if (part.b) span.setAttribute('font-weight', 'bold');
    if (part.i) span.setAttribute('class', 'pale');  // вместо курсива — бледный текст
    span.textContent = part.t;
  }
  return text;
}

// Ставит текст в промежуток [left, right] по выравниванию; не влезает — сжимает. Возвращает края текста.
function place(text, left, right, align = 'center') {
  const natural = text.getComputedTextLength(), room = right - left - 2 * PAD, len = Math.min(natural, room);
  if (natural > room) {
    text.setAttribute('textLength', room);
    text.setAttribute('lengthAdjust', 'spacingAndGlyphs');
  }
  const x = align === 'left' ? left + PAD : align === 'right' ? right - PAD - len : (left + right - len) / 2;
  text.setAttribute('x', x);
  return [x, x + len];
}

// Размытия, зерно бумаги и шов границы фразы.
function makeDefs(defs, cols, X) {
  for (const [id, dev] of [['blur1', 1], ['blur2', 2.4], ['blur3', 3.6]])
    svgEl('feGaussianBlur', { stdDeviation: dev },
      svgEl('filter', { id, x: '-20%', y: '-40%', width: '140%', height: '180%' }, defs));

  const seam = svgEl('linearGradient', { id: 'seam', x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  for (const [offset, opacity] of [[0, 0], [0.25, 0.8], [0.75, 0.8], [1, 0]])
    svgEl('stop', { offset, style: `stop-color:var(--seam);stop-opacity:${opacity}` }, seam);

  return ['fill', 'wave'].map(id => {
    const gradient = svgEl('linearGradient', { id, gradientUnits: 'userSpaceOnUse', x1: X(0), x2: X(cols), y1: 0, y2: 0 }, defs);
    return Array.from({ length: cols * 4 + 1 }, (_, i) => svgEl('stop', { offset: (i / (cols * 4)).toFixed(4) }, gradient));
  });
}

function drawScheme(parent, song, bottom, still) {
  const energy = songEnergy(song);
  const type = song.types[mainType(song)];
  const svg = svgEl('svg', { class: 'scheme' }, parent);  // в документе сразу: тексты надо измерять
  const defs = svgEl('defs', {}, svg);
  const back = svgEl('g', { filter: 'url(#blur1)' }, svg);  // заливка строк под текстом, с растушёванными краями
  const rowTop = k => TOP + RIBBON + RIBBON_GAP + k * (ROW_H + GAP);
  const baseline = k => rowTop(k) + ROW_H / 2 + 4;

  // Ширина блока запевов — по самому длинному запеву, который не заходит на сетку.
  const zapevs = song.rows.map((row, k) => row.zapev && writeText(svgEl('text', { y: baseline(k) }, svg), row.zapev));
  const wide = t => (t ? t.getComputedTextLength() : 0);
  const own = zapevs.map((t, k) => song.rows[k].zapev?.w ? 0 : wide(t));
  const zapevW = Math.max(0, ...own) || Math.max(0, ...zapevs.map(wide));
  const x0 = LEFT + (zapevW && zapevW + 2 * PAD + ZAPEV_GAP);
  const splits = song.splits || [];
  const X = c => x0 + c * U + SPLIT * splits.filter(s => s <= c).length;

  const stops = makeDefs(defs, song.cols, X);
  const ctx = { energy, cols: song.cols, splits, X, axis: TOP + RIBBON / 2, THIN: 1.5, THICK: RIBBON / 2 - 3 };
  const wash = svgEl('path', { fill: 'url(#wave)', filter: 'url(#blur3)', opacity: 0.5 }, svg);
  const body = svgEl('path', { fill: 'url(#wave)' }, svg);

  const refresh = () => {
    ctx.energy = smooth(energy);
    const d = wavePath(ctx);
    for (const el of [wash, body]) el.setAttribute('d', d);
    for (const [i, kind] of [[0, 'fill'], [1, 'wave']]) {
      stops[i].forEach((stop, j) => {
        const v = energyAt(ctx.energy, j / 4);
        const alpha = kind === 'fill' ? 0.07 + 0.42 * v : 0.45 + 0.55 * v;
        stop.setAttribute('style', `stop-color:${wave(v, alpha)}`);
      });
    }
  };
  refresh();

  // Граница фразы идёт через волну тем же швом, что и через строки.
  for (const b of type.bounds)
    if (!splits.includes(b))
      svgEl('rect', { x: X(b) - 0.6, y: TOP, width: 1.2, height: RIBBON, rx: 0.6, fill: 'url(#seam)' }, svg);
  for (const [c, level] of type.keys) pin(svg, X(c + 0.5), ctx.axis, level);
  svgEl('rect', { x: X(0), y: TOP - 4, width: song.cols * U, height: RIBBON + 8, class: 'band' }, svg);

  song.rows.forEach((row, k) => {
    const top = rowTop(k), y = baseline(k), rowType = song.types[row.type], keys = new Map(rowType.keys);
    const zapevCells = row.zapev?.w || 0;
    const taken = new Set(Array.from({ length: zapevCells }, (_, i) => i));
    const free = new Set(taken);  // запевы и большие ячейки живут без заливки и без точек
    for (const cell of row.cells)
      for (let i = 0; i < (cell.w || 1); i++) {
        taken.add(cell.c + i);
        if ((cell.w || 1) > 1) free.add(cell.c + i);
      }

    // Заливка рвётся на границах фраз и на больших ячейках: между кусками остаётся просвет.
    const breaks = new Set([...rowType.bounds, ...splits]);
    for (let c = 0, start = null; c <= song.cols; c++) {
      const stop = c === song.cols || free.has(c) || (breaks.has(c) && start !== null);
      if (stop && start !== null) {
        svgEl('rect', { x: X(start) + 1.2, y: top + 2, width: (c - start) * U - 2.4, height: ROW_H - 4,
                        rx: (ROW_H - 4) / 2, fill: 'url(#fill)' }, back);
        start = null;
      }
      if (c < song.cols && !free.has(c)) start ??= c;
    }

    svgEl('text', { x: X(song.cols) + 5, y, class: 'num' }, svg).textContent = k + 1;
    if (row.zapev) place(zapevs[k], LEFT, zapevCells ? X(zapevCells) : x0 - ZAPEV_GAP, row.zapev.a || 'left');

    // Расстояния — во всех пустых клетках строки, где тянется звук: шаг песни виден с начала.
    for (let c = 0; c < song.cols; c++)
      if (!taken.has(c)) drawSpacing(svg, X(c), top);

    for (const cell of row.cells) {
      const w = cell.w || 1, left = X(cell.c);
      if (cell.t === '↵') {
        repeatMark(svg, left + w * U / 2, top + ROW_H / 2);
        continue;
      }
      const level = keys.get(cell.c);
      const text = writeText(svgEl('text', { y }, svg), cell);
      const [from, to] = place(text, left, left + w * U, w > 1 ? cell.a || 'left' : 'center');
      // Большая ячейка вольная и по энергии, и по темпу: заливки, точек и мазков в ней нет.
      if (level && w === 1) accent(svg, (from + to) / 2, top + ROW_H / 2 - 0.5, to - from, level);
    }

    for (const [c, level] of rowType.keys)
      if (!taken.has(c)) accent(svg, X(c + 0.5), top + ROW_H / 2 - 0.5, 0, level);

    for (const b of rowType.bounds)
      if (!splits.includes(b))
        svgEl('rect', { x: X(b) - 0.6, y: top - GAP / 2, width: 1.2, height: ROW_H + GAP, rx: 0.6, fill: 'url(#seam)' }, svg);

  });

  // Разрез колена — двойная черта сверху донизу. Она не клетка и шага песни не меняет.
  for (const at of splits)
    for (const shift of [-1.1, 1.1])
      svgEl('rect', { x: X(at) - SPLIT / 2 + shift - 0.6, y: TOP, width: 1.2,
                      height: rowTop(song.rows.length) - GAP - TOP, rx: 0.5, class: 'cut' }, svg);

  // Песня целиком помещается в окно: масштаб — по свободному месту в нём.
  const width = X(song.cols) + NUM_W + RIGHT, height = rowTop(song.rows.length) + TOP;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const css = getComputedStyle(parent);
  const room = window.innerHeight - svg.getBoundingClientRect().top - bottom;
  const inner = parent.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  // За работой длинная песня не ужимается до нечитаемого: по ширине она уезжает вбок и
  // прокручивается. Для показа и вывода — по-прежнему целиком, как и решено про лист.
  const fit = Math.min(inner / width, still ? Infinity : room / height, MAX_ZOOM);
  const whole = still || document.body.classList.contains('clean');
  const scale = whole ? fit : Math.min(Math.max(fit, MIN_ZOOM), room / height, MAX_ZOOM);
  svg.setAttribute('width', width * scale);
  svg.setAttribute('height', height * scale);
  if (still) return { svg, X, rowTop, x0, scale, width, height };

  waveInput(svg, song, energy, type, { ...ctx, x0, rowTop, refresh });
  placeEdit(svg, scale, X, rowTop, x0);
}

// Волна: тянешь мышкой — рисуется энергия, кликаешь — ключевая точка или граница фразы.
function waveInput(svg, song, energy, type, g) {
  const point = e => new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const at = x => Math.min(energy.length - 1, Math.max(0, Math.floor((x - g.x0) / U * RES)));
  let drag = null;

  const paint = p => {
    const v = Math.min(1, Math.max(FLOOR, (Math.abs(p.y - g.axis) - g.THIN) / (g.THICK - g.THIN)));
    const i = at(p.x);
    if (drag.i !== undefined && Math.abs(i - drag.i) > 1) {  // мышь вели быстро — заполняем пропущенное
      const step = Math.sign(i - drag.i);
      for (let k = drag.i + step; k !== i; k += step)
        energy[k] = drag.v + (v - drag.v) * Math.abs(k - drag.i) / Math.abs(i - drag.i);
    }
    energy[i] = v;
    drag.i = i;
    drag.v = v;
    g.refresh();
  };

  const click = p => {
    const x = (p.x - g.x0) / U, edge = Math.round(x);
    snapshot();
    if (Math.abs(x - edge) < 0.25 && edge >= 0 && edge <= song.cols) {  // у края клетки — граница фразы
      const i = type.bounds.indexOf(edge);
      if (i < 0) type.bounds.push(edge), type.bounds.sort((a, b) => a - b);
      else type.bounds.splice(i, 1);
    } else {  // в клетке — ключевая точка: уровни 1 → 2 → 3 → нет
      const c = Math.min(song.cols - 1, Math.max(0, Math.floor(x))), key = type.keys.find(k => k[0] === c);
      if (!key) type.keys.push([c, 1]), type.keys.sort((a, b) => a[0] - b[0]);
      else if (key[1] < 3) key[1]++;
      else type.keys.splice(type.keys.indexOf(key), 1);
    }
    save(song);
    show();
  };

  // Клетка под мышкой. Слева от сетки — запев (c = -1), ещё левее, на номере строки, — вся строка.
  // Разрывы раздвигают схему, поэтому столбец ищется по самим координатам.
  const colUnder = x => {
    for (let c = 0; c < song.cols; c++) if (x < g.X(c + 1)) return c;
    return song.cols - 1;
  };
  const cellUnder = p => {
    const k = Math.floor((p.y - (TOP + RIBBON + RIBBON_GAP)) / (ROW_H + GAP));
    if (k < 0 || k >= song.rows.length) return null;
    if (p.x >= g.X(song.cols)) return { k, c: 'строка' };     // номер куплета справа — вся строка
    if (p.x < g.x0) return { k, c: -1 };                      // левее сетки — запев
    return { k, c: colUnder(p.x) };
  };

  // Блок клеток выделяется протяжкой, как в таблице: рамка тянется за мышкой.
  let area = null;
  const frame = () => {
    const b = blockOf({ k: area.from.k, c: area.from.c, k2: area.to.k, c2: area.to.c });
    area.box ??= svgEl('rect', { class: 'area' }, svg);
    for (const [name, v] of Object.entries({
      ...areaBox(b, g.X, g.x0), y: g.rowTop(b.k0) - 1, height: (b.k1 - b.k0 + 1) * (ROW_H + GAP) - GAP + 2,
    })) area.box.setAttribute(name, v);
  };

  svg.onpointerdown = e => {
    const p = point(e);
    if (p.y > TOP + RIBBON + 4) {
      const cell = cellUnder(p);
      typing = false;
      if (!cell) { sel = null; return show(); }
      if (cell.c === 'строка') { sel = { k: cell.k, c: 0, k2: cell.k, c2: song.cols - 1 }; return show(); }
      if (e.shiftKey && sel) { sel = { ...sel, k2: cell.k, c2: cell.c }; return show(); }
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      area = { from: cell, to: cell, box: null };
      return;
    }
    if (p.y < TOP - 4 || p.x < g.x0 || p.x > g.X(song.cols)) return;
    e.preventDefault();  // иначе вместе с рисованием выделяется текст схемы
    svg.setPointerCapture(e.pointerId);
    drag = { p0: p, moved: false };
  };
  svg.onpointermove = e => {
    if (area) {
      const cell = cellUnder(point(e));
      if (!cell || (cell.k === area.to.k && cell.c === area.to.c)) return;
      area.to = cell;
      return frame();
    }
    if (!drag) return;
    const p = point(e);
    if (!drag.moved && Math.hypot(p.x - drag.p0.x, p.y - drag.p0.y) < 3) return;
    if (!drag.moved) {
      drag.moved = true;
      snapshot();
      paint(drag.p0);
    }
    paint(p);
  };
  svg.onpointerup = e => {
    if (area) {
      const { from, to } = area;
      sel = from.k === to.k && from.c === to.c ? { k: from.k, c: from.c }
                                               : { k: from.k, c: from.c, k2: to.k, c2: to.c };
      area = null;
      return show();
    }
    if (!drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) save(song);
    else click(point(e));
  };
}

// ——— Редактор текста ———
// Набор идёт в обычное поле ввода поверх выбранной клетки: каретка, выделение,
// вставка и раскладка клавиатуры достаются от браузера, писать их не нужно.
const edit = document.getElementById('edit');
let sel = null;      // {k, c}: клетка c строки k; c = -1 — запев
let typing = false;  // правка одной клетки — одно действие для отмены
const past = [], future = [];

const cw = cell => cell.w || 1;
const cellText = cell => Array.isArray(cell.t) ? cell.t.map(p => p.t).join('') : cell.t;
const cellAt = (row, c) => row.cells.find(x => x.c <= c && c < x.c + cw(x));

// Отмена: перед каждым действием песня целиком кладётся в стопку. Песни маленькие.
function snapshot() {
  if (!song) return;
  past.push(JSON.stringify(song));
  if (past.length > 100) past.shift();
  future.length = 0;
}
function change(fn) {
  if (!song) return;
  snapshot();
  fn();
  save(song);
  show();
}
function undo(from = past, to = future) {
  if (!from.length || !song) return;
  to.push(JSON.stringify(song));
  const back = JSON.parse(from.pop());
  songs[songs.indexOf(song)] = back;
  save(back);
  show();
}
const redo = () => undo(future, past);

// Поле ввода встаёт ровно на выбранную клетку или на запев.
// Где стоит рамка: по столбцам или по блоку запевов слева от сетки.
const areaBox = (b, X, x0) => b.c0 < 0
  ? { x: LEFT, width: Math.max(U, x0 - ZAPEV_GAP - LEFT) }
  : { x: X(b.c0), width: (b.c1 - b.c0 + 1) * U };

let keepScroll = 0;

function placeEdit(svg, scale, X, rowTop, x0) {
  svg.parentElement.scrollLeft = keepScroll;   // лист остаётся там, куда его отвели
  edit.hidden = !sel || wide();
  if (!sel) return;
  if (wide()) {                                    // выделен блок: вместо поля — рамка
    const b = block();
    svgEl('rect', { class: 'area', ...areaBox(b, X, x0), y: rowTop(b.k0) - 1,
                    height: (b.k1 - b.k0 + 1) * (ROW_H + GAP) - GAP + 2 }, svg);
    return;
  }
  const row = song.rows[sel.k], cell = sel.c >= 0 && cellAt(row, sel.c);
  const zapevCells = row.zapev?.w || 0;
  // Пока у песни нет ни одного запева, места под них на схеме нет: поле открывается на пять клеток.
  const zapevRight = zapevCells ? X(zapevCells) : Math.max(x0 - ZAPEV_GAP, LEFT + 5 * U);
  const [left, right, how, text] = sel.c < 0
    ? [LEFT, zapevRight, row.zapev?.a || 'left', row.zapev?.t || '']
    : cell
      ? [X(cell.c), X(cell.c + cw(cell)), cw(cell) > 1 ? cell.a || 'left' : 'center', cellText(cell)]
      : [X(sel.c), X(sel.c + 1), 'center', ''];
  // Схема прокручивается внутри листа, поэтому место поля пересчитывается и при прокрутке.
  putEdit = () => {
    const box = svg.getBoundingClientRect();
    Object.assign(edit.style, {
      left: `${box.left + scrollX + left * scale}px`,
      top: `${box.top + scrollY + rowTop(sel.k) * scale}px`,
      width: `${(right - left) * scale}px`,
      height: `${ROW_H * scale}px`,
      fontSize: `${12 * scale}px`,
      textAlign: how,
    });
  };
  putEdit();
  edit.value = text;
  edit.focus();
  edit.select();

  // Клетка, до которой дошли табом, сама выезжает в видимую часть листа.
  const sheet = svg.parentElement, area = sheet.getBoundingClientRect(), box = edit.getBoundingClientRect();
  if (box.left < area.left) sheet.scrollLeft -= area.left - box.left + U * scale;
  else if (box.right > area.right) sheet.scrollLeft += box.right - area.right + U * scale;
  putEdit();
}

let putEdit = () => {};
document.addEventListener('scroll', () => { if (!edit.hidden) putEdit(); }, true);

// Пустой текст убирает клетку: пустая клетка в песне не хранится.
function setCell(row, c, text) {
  const old = cellAt(row, c);
  if (old) row.cells.splice(row.cells.indexOf(old), 1);
  if (text) row.cells.push({ c, t: text });
  row.cells.sort((a, b) => a.c - b.c);
}

function applyText(text) {
  const row = song.rows[sel.k];
  if (sel.c < 0) {
    if (text) row.zapev = { ...row.zapev, t: text };
    else delete row.zapev;
    return;
  }
  const cell = cellAt(row, sel.c);
  if (cell && text) cell.t = text;  // начертание клетки сохраняется; два начертания в одной сводятся к одному
  else setCell(row, sel.c, text);
}

function move(dk, dc) {
  if (!sel) return;
  typing = false;
  let { k, c } = sel;
  const cell = dc && sel.c >= 0 && cellAt(song.rows[k], sel.c);
  if (cell) c = dc > 0 ? cell.c + cw(cell) - 1 : cell.c;  // большая ячейка проходится целиком
  c += dc;
  k += dk;
  if (c >= song.cols) { c = 0; k++; }       // за последней клеткой — следующая строка
  if (c < -1) { c = song.cols - 1; k--; }
  if (k < 0) return;
  sel = { k, c };
  if (k >= song.rows.length) return change(() => addRow(song.rows.length - 1));
  show();
}

function addRow(k, copy) {
  const src = song.rows[k];
  song.rows.splice(k + 1, 0, copy ? JSON.parse(JSON.stringify(src)) : { type: src?.type || 0, cells: [] });
}

// Столбец вставляется и удаляется во всех строках сразу, вместе с энергией,
// ключевыми точками и границами фраз: иначе закон разъедется с текстом.
function column(d, at) {
  for (const row of song.rows) {
    if (d < 0) row.cells = row.cells.filter(x => !(x.c === at && cw(x) === 1));
    for (const x of row.cells) {
      // При удалении большая ячейка, начатая в этом же столбце, не едет влево, а сужается.
      if (d > 0 ? x.c >= at : x.c > at) x.c += d;
      else if (x.c + cw(x) > at) {       // столбец пришёлся на большую ячейку — меняется её ширина
        const w = cw(x) + d;
        if (w > 1) x.w = w; else delete x.w;
      }
    }
    if (row.zapev?.w > at) row.zapev.w += d;
  }
  for (const type of song.types) {
    const shift = places => places.filter(([c]) => d > 0 || c !== at).map(([c, v]) => [c >= at ? c + d : c, v]);
    type.keys = shift(type.keys);
    type.hints = shift(type.hints || []);
    type.bounds = [...new Set(type.bounds.map(b => b >= at + (d > 0 ? 0 : 1) ? b + d : b))].sort((a, b) => a - b);
  }
  const move = list => [...new Set(list.map(c => (c >= at + (d > 0 ? 0 : 1) ? c + d : c)))].sort((a, b) => a - b);
  if (song.splits) song.splits = move(song.splits);
  const i = at * RES;
  if (d > 0) song.energy.splice(i, 0, ...new Array(RES).fill(song.energy[Math.max(0, i - 1)] ?? START));
  else song.energy.splice(i, RES);
  song.cols += d;
}

// Большая ячейка: присоединяет соседнюю клетку справа или отдаёт последнюю обратно.
// Для запева то же самое: он заходит на клетки схемы, как у первого куплета «Отчего Дон».
function merge(d) {
  const row = song.rows[sel.k];
  if (sel.c < 0) {
    const w = Math.min(song.cols, Math.max(0, (row.zapev?.w || 0) + d));
    row.zapev = { ...row.zapev, t: row.zapev?.t || '' };
    if (w) row.zapev.w = w; else delete row.zapev.w;
    row.cells = row.cells.filter(x => x.c >= w);  // клетки, на которые лёг запев, уходят
    return;
  }
  let cell = cellAt(row, sel.c);
  if (!cell) {
    cell = { c: sel.c, t: '' };
    row.cells.push(cell);
    row.cells.sort((a, b) => a.c - b.c);
  }
  if (d > 0) {
    if (cell.c + cw(cell) >= song.cols) return;
    const next = cellAt(row, cell.c + cw(cell));
    cell.w = cw(cell) + (next ? cw(next) : 1);
    if (next) {
      cell.t = cellText(cell) + cellText(next);
      row.cells.splice(row.cells.indexOf(next), 1);
    }
  } else if (cw(cell) > 1) {
    const w = cw(cell) - 1;
    if (w > 1) cell.w = w; else delete cell.w;
  }
}

const mergeHere = d => { if (sel) change(() => merge(d)); };  // и для клетки, и для запева

function style(flag) {  // 'b' — жирный, 'i' — бледный
  if (wide()) return change(() => styleBlock(block(), flag));
  const cell = sel && sel.c >= 0 && cellAt(song.rows[sel.k], sel.c);
  if (!cell) return;
  change(() => {
    if (Array.isArray(cell.t)) cell.t = cellText(cell);
    if (cell[flag]) delete cell[flag]; else cell[flag] = 1;
  });
}

// Выравнивание Дмитрий меняет сам — у запевов и больших ячеек.
const ALIGN = ['left', 'center', 'right'];
function align() {
  if (!sel) return;
  const b = block(), targets = [];
  for (let k = b.k0; k <= b.k1; k++) {
    const row = song.rows[k];
    if (b.c0 < 0) { if (row.zapev) targets.push(row.zapev); }
    else targets.push(...row.cells.filter(x => inBlock(x, b)));
  }
  if (!targets.length) return;
  const next = ALIGN[(ALIGN.indexOf(targets[0].a || 'left') + 1) % 3];
  change(() => { for (const target of targets) target.a = next; });
}

edit.oninput = () => {
  if (!sel) return;
  if (!typing) { snapshot(); typing = true; }
  applyText(edit.value);
  save(song);
};

// Готовый текст разбивается на слоги по пробелам и дефисам и раскладывается по клеткам.
edit.onpaste = e => {
  const text = e.clipboardData.getData('text').trim();
  if (sel.c < 0 || !/[\s-]/.test(text)) return;  // запев и один слог вставляются как есть
  e.preventDefault();
  change(() => {
    text.split(/\r?\n/).forEach((line, n) => {
      if (sel.k + n >= song.rows.length) addRow(song.rows.length - 1);
      line.split(/[\s-]+/).filter(Boolean).forEach((part, j) => {
        while (sel.c + j >= song.cols) column(1, song.cols);  // сетка растёт под вставленный текст
        setCell(song.rows[sel.k + n], sel.c + j, part);
      });
    });
  });
};

edit.onkeydown = e => {
  const ctrl = e.ctrlKey || e.metaKey, caret = edit.selectionStart === edit.selectionEnd;
  const done = () => e.preventDefault();
  if (ctrl && e.code === 'KeyB') { done(); style('b'); }
  else if (ctrl && e.code === 'KeyI') { done(); style('i'); }
  else if (ctrl && e.code === 'KeyM') { done(); mergeHere(e.shiftKey ? -1 : 1); }
  else if (ctrl && e.code === 'KeyZ') { done(); if (e.shiftKey) redo(); else undo(); }
  else if (e.key === 'Tab') { done(); move(0, e.shiftKey ? -1 : 1); }
  else if (e.key === 'Enter') { done(); move(1, 0); }
  else if (e.key === 'ArrowUp') { done(); move(-1, 0); }
  else if (e.key === 'ArrowDown') { done(); move(1, 0); }
  else if (e.key === 'ArrowRight' && caret && edit.selectionStart === edit.value.length) { done(); move(0, 1); }
  else if (e.key === 'ArrowLeft' && caret && edit.selectionStart === 0) { done(); move(0, -1); }
  else if (e.key === 'Escape') { sel = null; show(); }

};

document.onpointerdown = e => {  // клик мимо схемы снимает выбор клетки
  if (sel && !e.target.closest('.scheme, header, #edit')) {
    sel = null;
    show();
  }
};

document.onkeydown = e => {
  if (e.key === 'Escape' && document.body.classList.contains('clean')) return clean(false);
  if (e.target !== edit && blockKey(e)) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && e.target !== edit) {  // отмена и без выбранной клетки
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
  }
};

// ——— Блок клеток ———
// Выделение протяжкой, как в таблице: очистить, скопировать, вставить, сменить начертание
// сразу во многих строках и столбцах. Ради этого и затевалось: чистить по одной клетке долго.
const blockOf = s => {
  const k0 = Math.min(s.k, s.k2 ?? s.k), k1 = Math.max(s.k, s.k2 ?? s.k);
  const c0 = Math.min(s.c, s.c2 ?? s.c), c1 = Math.max(s.c, s.c2 ?? s.c);
  return c1 < 0 ? { k0, k1, c0: -1, c1: -1 } : { k0, k1, c0: Math.max(0, c0), c1 };
};
const block = () => sel && blockOf(sel);
const wide = () => sel?.k2 !== undefined && (sel.k2 !== sel.k || sel.c2 !== sel.c);
const inBlock = (x, b) => x.c + cw(x) - 1 >= b.c0 && x.c <= b.c1;   // задета ли клетка блоком

let clip = null;   // свой буфер обмена: копия куска схемы

function clearBlock(b) {
  for (let k = b.k0; k <= b.k1; k++) {
    if (b.c0 < 0) delete song.rows[k].zapev;
    else song.rows[k].cells = song.rows[k].cells.filter(x => !inBlock(x, b));
  }
}

function copyBlock(b) {
  if (b.c0 < 0) {
    clip = { zapev: true, rows: [] };
    for (let k = b.k0; k <= b.k1; k++) clip.rows.push(song.rows[k].zapev && { ...song.rows[k].zapev });
    return;
  }
  clip = { width: b.c1 - b.c0 + 1, rows: [] };
  for (let k = b.k0; k <= b.k1; k++)
    clip.rows.push(song.rows[k].cells.filter(x => x.c >= b.c0 && x.c + cw(x) - 1 <= b.c1)
      .map(x => ({ ...x, c: x.c - b.c0 })));
}

function pasteBlock(b) {
  if (clip.zapev) {
    clip.rows.forEach((zapev, i) => {
      const row = song.rows[b.k0 + i];
      if (!row) return;
      if (zapev) row.zapev = { ...zapev }; else delete row.zapev;
    });
    return;
  }
  const place = { k0: b.k0, k1: b.k0 + clip.rows.length - 1, c0: b.c0, c1: b.c0 + clip.width - 1 };
  clip.rows.forEach((cells, i) => {
    const row = song.rows[b.k0 + i];
    if (!row) return;
    row.cells = row.cells.filter(x => !inBlock(x, { ...place, k0: 0, k1: 0 }));
    for (const x of cells) if (b.c0 + x.c < song.cols) row.cells.push({ ...x, c: b.c0 + x.c });
    row.cells.sort((a, b) => a.c - b.c);
  });
}

// Начертание на весь блок: если оно уже у всех — снимаем, иначе ставим.
function styleBlock(b, flag) {
  const cells = [];
  for (let k = b.k0; k <= b.k1; k++) cells.push(...song.rows[k].cells.filter(x => inBlock(x, b)));
  const all = cells.length && cells.every(x => x[flag]);
  for (const x of cells) {
    if (Array.isArray(x.t)) x.t = cellText(x);
    if (all) delete x[flag]; else x[flag] = 1;
  }
}

// Клавиши блока: поле ввода в это время скрыто, поэтому их ловит вся страница.
function blockKey(e) {
  const b = block();
  if (!b || !wide()) return false;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.key === 'Delete' || e.key === 'Backspace') change(() => clearBlock(b));
  else if (ctrl && e.code === 'KeyC') copyBlock(b);
  else if (ctrl && e.code === 'KeyX') change(() => { copyBlock(b); clearBlock(b); });
  else if (ctrl && e.code === 'KeyV' && clip) change(() => pasteBlock(b));
  else if (ctrl && e.code === 'KeyB') change(() => styleBlock(b, 'b'));
  else if (ctrl && e.code === 'KeyI') change(() => styleBlock(b, 'i'));
  else if (e.key === 'Escape') { sel = null; show(); }
  else return false;
  e.preventDefault();
  return true;
}

const tools = document.getElementById('tools');
const ops = {
  bold: () => style('b'),
  pale: () => style('i'),
  repeat: () => { if (sel?.c >= 0) change(() => setCell(song.rows[sel.k], sel.c, '↵')); },
  zapev: () => {                                  // попасть кликом в узкую полосу слева трудно
    if (!song) return;
    sel = { k: sel ? block().k0 : 0, c: -1 };
    typing = false;
    show();
  },
  merge: () => mergeHere(1),
  split: () => mergeHere(-1),
  align,
  colAdd: () => change(() => column(1, sel ? Math.max(0, sel.c) : song.cols)),
  colDel: () => { if (song.cols > 1) change(() => column(-1, sel ? Math.max(0, sel.c) : song.cols - 1)); },
  rowAdd: () => change(() => addRow(sel ? sel.k : song.rows.length - 1)),
  rowCopy: () => change(() => addRow(sel ? sel.k : song.rows.length - 1, true)),
  rowDel: () => {
    if (song.rows.length > 1) change(() => { song.rows.splice(sel ? sel.k : song.rows.length - 1, 1); sel = null; });
  },
  undo: () => undo(),
  redo,
  spacing: () => {
    spacing = SPACING[(SPACING.indexOf(spacing) + 1) % SPACING.length];
    store.set('spacing', spacing);
    show();
  },
  clear: () => { if (wide()) change(() => clearBlock(block())); },
  cut: () => {                                    // разрыв между коленами — не клетка, доли не даёт
    if (!song || !sel || sel.c <= 0) return;
    const at = block().c0, splits = song.splits || [];
    change(() => {
      song.splits = splits.includes(at) ? splits.filter(s => s !== at) : [...splits, at].sort((a, b) => a - b);
      if (!song.splits.length) delete song.splits;
    });
  },
  clean: () => clean(true),
  read: () => { location.hash = '!read'; },
  fill: () => { location.hash = '!fill'; },
  reset: () => {
    if (!confirm('Стереть всё и вернуться к исходному заданию?\n\n'
      + 'Прежняя схема пропадёт из браузера — если она ещё нужна, сначала сохраните её в файл. '
      + 'Отменить это будет нельзя.')) return;
    store.del(DRAFT);
    location.reload();
  },
  publish,
  refresh,
  png: savePng,
  draft: saveDraft,
  open: openDraft,
  all: saveAllPng,
  print: () => window.print(),
  duplicate: async () => {
    if (!song) return;
    const copy = duplicateSong(song);
    const { id, ...body } = copy;
    const saved = await fetch(`/api/songs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!saved.ok) return alert('Не получилось дублировать песню.');
    songs.push(copy);
    fillList();
    typing = false;
    location.hash = encodeURIComponent(id);
  },
  rename: async () => {
    const title = song && prompt('Новое название песни', song.title)?.trim();
    if (!title || title === song.title) return;
    if (songs.some(s => s.id === title)) return alert('Песня с таким названием уже есть');
    clearTimeout(saving);  // недописанное сохранение не должно воскресить старое название
    const was = song.id;
    const { id, ...body } = { ...song, title };
    const put = await fetch(`/api/songs/${encodeURIComponent(title)}`, { method: 'PUT', body: JSON.stringify(body) });
    if (!put.ok) return alert('Не получилось переименовать. Возможно, дело в названии.');
    await fetch(`/api/songs/${encodeURIComponent(was)}`, { method: 'DELETE' });
    Object.assign(song, { id: title, title });
    fillList();
    location.hash = encodeURIComponent(title);
  },
  remove: async () => {
    if (!song || !confirm(`Удалить песню «${song.title}»? Она останется только в истории git.`)) return;
    clearTimeout(saving);
    await fetch(`/api/songs/${encodeURIComponent(song.id)}`, { method: 'DELETE' });
    songs.splice(songs.indexOf(song), 1);
    sel = null;
    fillList();
    location.hash = '';
    show();
  },
};
tools.onmousedown = e => { if (e.target.tagName !== 'SELECT') e.preventDefault(); };  // кнопки не отбирают ввод у поля, список должен открываться
tools.onclick = e => ops[e.target.closest('button')?.dataset.do]?.();  // клик мог прийтись на текст внутри кнопки

document.getElementById('new').onclick = async () => {
  const title = prompt('Название песни')?.trim();
  if (!title) return;
  if (songs.some(s => s.id === title)) return alert('Песня с таким названием уже есть');
  const { id: _, ...fresh } = emptySong(title);
  const saved = await fetch(`/api/songs/${encodeURIComponent(title)}`, { method: 'PUT', body: JSON.stringify(fresh) });
  if (!saved.ok) return alert('Не получилось создать песню. Возможно, дело в названии.');
  songs.push({ ...fresh, id: title });
  fillList();
  sel = { k: 0, c: 0 };
  location.hash = encodeURIComponent(title);
};

// ——— Главный экран: условные обозначения ———
// Образец — маленькая песня, которая живёт прямо здесь: в списке песен её нет.
// Выноски находят свои места в ней сами, поэтому легенда не разойдётся со схемой.
const SAMPLE = {
  title: 'Условные обозначения', cols: 28, notes: '',
  // Энергия — по числу на клетку: программа сама разложит её на четыре и сгладит.
  energy: [0.95, 0.9, 0.6, 0.45, 0.55, 0.45, 0.34, 0.28, 0.38, 0.36, 0.34, 0.41, 0.52, 0.47, 0.44, 0.57, 0.74, 0.62, 0.48, 0.37, 0.59, 0.64, 0.67, 0.82, 0.88, 0.66, 0.7, 0.79],
  types: [{ keys: [[0, 3], [4, 1], [12, 1], [16, 2], [24, 2]], hints: [], bounds: [0, 16] }],
  rows: [{
    type: 0,
    zapev: { t: "Где летал так далеко" },
    cells: [{c: 0, t: "ты", b: 1}, {c: 2, t: "да", i: 1}, {c: 3, t: "при"}, {c: 4, t: "нёс", b: 1}, {c: 8, t: "v", i: 1}, {c: 9, t: "мне"}, {c: 10, t: "чёр"}, {c: 11, t: "ный"}, {c: 12, t: "во", b: 1}, {c: 15, t: "ран"}, {c: 16, t: "ру", b: 1}, {c: 19, t: "ку"}, {c: 20, t: "бе"}, {c: 21, t: "ла"}, {c: 22, t: "ю"}, {c: 23, t: "скаль", b: 1}, {c: 24, t: "цом", b: 1}, {c: 27, t: "↵"}],
  }],
};
const LEGEND = [
  ['Лента песни', 'визуальное отображение энергии в песне.'],
  ['Ключевая точка', 'отображение ключевой точки схода песни. В ленте — звезда-всплеск разного размера и яркости, в тексте — мазки кистью по контуру ячейки.'],
  ['Граница фразы', 'показывает границы между смысловыми фразами в песне.'],
  ['Запев', 'обычно вольный, вне схемы и ленты.'],
  ['Начертания слога', 'жирный — слог обязателен к пропеванию для всех именно в этом месте; обычный — этот текст можно пропеть и в другом месте, необязательно здесь; бледный — текст необязателен к пропеванию вовсе.'],
  ['«v»', 'опциональные свободные огласовки в песне: «ой», «эх», «да», «вот», «ба» и подобные. Их можно не проставлять.'],
  ['Точка ритма', 'условный шаг песни. Нужна, чтобы посчитать шаги при разучивании, метрономом не является. Пустая клетка обычно означает продолжение пропевания предыдущей.'],
  ['Повтор колена', 'петля со стрелкой в конце строки: колено поётся ещё раз.'],
];

// Куда смотрит каждая выноска: места берутся из самой песни, а не заданы числами.
function marksOf(song) {
  const type = song.types[mainType(song)];
  const row = song.rows.find(r => r.cells.length) || song.rows[0];
  const axis = TOP + RIBBON / 2, THIN = 1.5, THICK = RIBBON / 2 - 3;
  const at = c => energyAt(smooth(song.energy), c);
  const cell = test => row.cells.find(test);
  const columns = [...Array(song.cols).keys()];

  const key = type.keys.reduce((a, b) => (b[1] >= a[1] ? b : a), type.keys[0] || [0, 1]);
  const star = key[0] + 0.5;
  const bound = type.bounds.find(b => b > 0 && b < song.cols);
  const taken = new Set(row.cells.flatMap(c => [...Array(c.w || 1).keys()].map(i => c.c + i)));
  const zapevW = row.zapev?.w || 0;

  // Выноски стоят вертикально, поэтому места для них выбираются подальше от уже занятых.
  const used = [star, bound ?? -9];
  const free = list => {
    const room = c => Math.min(...used.map(u => Math.abs(u - c)));
    return list.find(c => room(c) >= 2) ?? list.reduce((a, b) => (room(b) > room(a) ? b : a), list[0]);
  };

  // Самое жирное место ленты — но не там, где стоит звезда: номера не должны налезать.
  const away = columns.map(c => c + 0.5).filter(c => Math.abs(c - star) > 1.5);
  const loud = away.reduce((a, b) => (at(b) > at(a) ? b : a), away[0] ?? star);

  // Начертания показываем там, где рядом видно сразу несколько: бледный, обычный, жирный.
  const kind = c => (c.b ? 'ж' : c.i ? 'б' : 'о');
  const trio = row.cells.map((c, i) => row.cells.slice(Math.max(0, i - 1), i + 2))
    .filter(g => g.length === 3 && g[2].c - g[0].c <= 3);
  const mix = trio.reduce((a, g) => (new Set(g.map(kind)).size > new Set(a.map(kind)).size ? g : a), trio[0] || []);
  const empty = columns.filter(c => c >= zapevW && !taken.has(c));
  used.push(loud, mix[1] ? mix[1].c + 0.5 : -9,
            ...row.cells.filter(c => c.t === 'v' || c.t === '↵').map(c => c.c + 0.5));

  const up = (n, c, y) => ({ n, up: true, x: c, y });
  const down = (n, c, y) => ({ n, up: false, x: c, y });
  return [
    up(1, loud, axis - (THIN + at(loud) * (THICK - THIN))),        // ровно в край ленты
    type.keys.length && up(2, star, axis - SIZE[key[1]]),          // вплотную к звезде
    bound !== undefined && up(3, bound, TOP),
    row.zapev && up(4, null, 0),                                   // над запевом, место считается по блоку
    type.keys.length && down(2, star, null),
    mix.length && down(5, mix[1].c + 0.5, null),
    cell(c => c.t === 'v') && down(6, cell(c => c.t === 'v').c + 0.5, null),
    empty.length && down(7, free(empty.map(c => c + 0.5)), 'точка'),  // вплотную к точке ритма
    cell(c => c.t === '↵') && down(8, cell(c => c.t === '↵').c + 0.5, null),
  ].filter(Boolean);
}

// Как заполнять схему: порядок работы и клавиши. Что означают знаки, написано
// в «Как читать схему», и здесь это не повторяется.
const HOWTO = [
  ['Сначала текст', 'клик по клетке открывает её для правки, Tab — следующая клетка, Enter — строкой ниже. В клетку пишется слог.'],
  ['Готовый текст можно вставить', 'он сам режется на слоги по пробелам и дефисам и раскладывается по клеткам, каждая строка — в свою.'],
  ['Начертания', 'Ctrl+B — жирный, Ctrl+I — бледный. На выделенном блоке те же клавиши меняют начертание сразу всем клеткам.'],
  ['Запев', 'кнопка «Запев» или клик слева от сетки. Ctrl+M заводит запев на клетки схемы, Ctrl+Shift+M возвращает обратно.'],
  ['Вольные места', 'Ctrl+M объединяет клетку с соседней в большую ячейку, Ctrl+Shift+M разделяет. «Разбивка» разрезает строку на колена, «Повтор колена» ставит знак в конце строки.'],
  ['Сетка', 'кнопки «+ столбец», «− столбец», «+ строка», «− строка» меняют её сразу во всех строках, вместе со всей разметкой.'],
  ['Лента энергии', 'волна рисуется протяжкой мышки прямо по ленте. Дрожание руки программа сглаживает сама.'],
  ['Ключевая точка', 'клик по ленте внутри клетки. Клики перебирают уровни: первый, второй, третий, снято.'],
  ['Граница фразы', 'клик по ленте у самого края клетки, между столбцами. Второй клик её убирает.'],
  ['Много клеток разом', 'протяжка мышкой выделяет блок: Delete очищает, Ctrl+C и Ctrl+V переносят. Клик по номеру строки справа выделяет всю строку.'],
  ['Если ошиблись', 'Ctrl+Z отменяет, Ctrl+Shift+Z возвращает. Работа сохраняется сама.'],
];

// Только у ученика: своего списка песен нет, и схема живёт в браузере одна за раз.
const HOWTO_STUDENT = [
  ['Название схемы', 'клик по заголовку меняет его. Название попадёт в имя файла и на картинку.'],
  ['Файл схемы', '«Сохранить» сохраняет схему файлом json, «Открыть» — загрузка любого json существующей схемы. '
    + 'В браузере живёт только последняя схема: беретесь за новую песню — сначала сохраните прежнюю в файл, '
    + 'если она вам потом будет нужна для редактирования.'],
];

// Пустой лист: с него программа начинается, песня выбирается в списке.
function drawStart(parent) {
  sel = null;
  const head = htmlEl('div', parent, '', 'front');
  htmlEl('h1', head, 'Раскладка');
  htmlEl('p', head, 'Песню выберите в списке сверху, «Новая» начинает пустую. '
    + 'Что означают знаки схемы и как её заполнять — в «Справке».');
}

// Справка — один компактный экран. «Как читать схему» — образец с выносками и
// расшифровка по номерам; «Как заполнять схему» — порядок работы, образец там не нужен.
function drawHelp(parent, kind) {
  const read = kind === 'read';
  const head = htmlEl('div', parent, '', 'front');
  htmlEl('h1', head, read ? 'Как читать схему' : 'Как заполнять схему');
  htmlEl('p', head, read ? 'Ниже — всё, что есть на схеме песни.'
                         : 'По порядку: сначала текст, потом закон песни. Что означают знаки — в «Как читать схему».');
  htmlEl('button', head, 'Назад к схеме').onclick = () => { location.hash = backTo; };

  if (read) drawSample(parent, SAMPLE);

  const marks = htmlEl('ol', parent, '', 'marks');
  const items = read ? LEGEND : author ? HOWTO : [...HOWTO, ...HOWTO_STUDENT];
  for (const [name, text] of items) {
    const li = htmlEl('li', marks);
    htmlEl('b', li, name);
    htmlEl('span', li, ' — ' + text);
  }
  if (read) return;
  const li = htmlEl('li', marks);
  htmlEl('b', li, author ? 'Когда готово' : 'Экспорт');
  htmlEl('span', li, author
    ? ' — схему сохраняет картинкой кнопка «Картинка».'
    : ' — впишите имя наверху страницы и нажмите «Картинка»: её отправьте боту в раздел домашних заданий.');
}

function drawSample(parent, song, items) {
  const sheet = htmlEl('div', parent, '', 'sheet sample');
  const g = drawScheme(sheet, song, 0, true);
  const pad = 34, side = 14;                       // поля под номера вокруг схемы
  const under = items ? textHeight(g.svg, g.width + 2 * side, items) : 0;
  const height = g.height + 2 * pad + under, width = g.width + 2 * side;
  const scale = Math.min((sheet.clientWidth - 32) / width, MAX_ZOOM);
  g.svg.setAttribute('viewBox', `${-side} ${-pad} ${width} ${height}`);
  g.svg.setAttribute('width', width * scale);
  g.svg.setAttribute('height', height * scale);
  g.svg.querySelectorAll('.num').forEach(one => one.remove());   // номер куплета образцу не нужен
  if (items) writeLegend(g.svg, -side + 6, g.height + pad + 16, width - 12, items);

  const k = Math.max(0, song.rows.findIndex(r => r.cells.length));
  const top = g.rowTop(k), low = top + ROW_H, zapev = song.rows[k]?.zapev;
  for (const m of marksOf(song)) {
    // Выноска строго вертикальна: номер стоит ровно над своим местом или под ним.
    const x = m.x === null ? (LEFT + (zapev?.w ? g.X(zapev.w) : g.x0 - ZAPEV_GAP)) / 2 : g.X(m.x);
    const goal = m.up ? (m.n === 4 ? top : m.y) : m.y === 'точка' ? top + ROW_H / 2 + 3.5 : low + 1;
    const cy = m.up ? -pad + 7 : low + pad - 7;
    arrow(g.svg, x, cy + (m.up ? 8.5 : -8.5), x, goal + (m.up ? -2 : 2));
    svgEl('circle', { cx: x, cy, r: 6.5, class: 'leadnum' }, g.svg);
    svgEl('text', { x, y: cy + 3, class: 'leadtext' }, g.svg).textContent = m.n;
  }
  return sheet;
}

// Расшифровка на самой картинке: без неё лист обозначений бесполезен.
// Строки переносятся по словам, ширину каждого слова меряет сам браузер.
const LINE = 13;   // шаг строки расшифровки на картинке

function legendLines(svg, width, items) {
  const ruler = svgEl('text', { x: -9999, class: 'legend' }, svg);
  const fits = text => { ruler.textContent = text; return ruler.getComputedTextLength() <= width; };
  const lines = [];
  items.forEach(([name, text], i) => {
    let line = `${i + 1}. ${name} — `;
    for (const word of text.split(' ')) {
      if (line !== '' && !fits(line + word)) { lines.push(line.trimEnd()); line = '    '; }
      line += word + ' ';
    }
    lines.push(line.trimEnd());
  });
  ruler.remove();
  return lines;
}

const textHeight = (svg, width, items) => legendLines(svg, width - 12, items).length * LINE + 26;

function writeLegend(svg, x, y, width, items) {
  legendLines(svg, width, items).forEach((line, i) => {
    svgEl('text', { x, y: y + i * LINE, class: 'legend' }, svg).textContent = line;
  });
}

// Стрелка от номера к месту на схеме: упирается наконечником прямо в него.
function arrow(svg, x0, y0, x1, y1) {
  svgEl('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'lead' }, svg);
  const a = Math.atan2(y1 - y0, x1 - x0), back = 4.5, half = 1.9;
  const bx = x1 - Math.cos(a) * back, by = y1 - Math.sin(a) * back;
  svgEl('path', { class: 'leadtip', d: `M${x1.toFixed(2)} ${y1.toFixed(2)}`
    + `L${(bx - Math.sin(a) * half).toFixed(2)} ${(by + Math.cos(a) * half).toFixed(2)}`
    + `L${(bx + Math.sin(a) * half).toFixed(2)} ${(by - Math.cos(a) * half).toFixed(2)}Z` }, svg);
}

// ——— Вывод: вид для учеников, картинка, печать ———
// Расстояния в пустых клетках: точки, бледные клетки или ничего. Выбор общий для всех песен.
const SPACING = ['точки', 'клетки', 'ничего'];
let spacing = store.get('spacing') || SPACING[0];

// На кнопке видно, что сейчас выбрано.
const spacingButton = document.querySelector('[data-do="spacing"]');
const showSpacing = () => { if (spacingButton) spacingButton.textContent = `Расстояния: ${spacing}`; };

function drawSpacing(svg, x, top) {
  if (spacing === 'точки') svgEl('circle', { cx: x + U / 2, cy: top + ROW_H / 2, r: 1.2, class: 'dot' }, svg);
  else if (spacing === 'клетки')
    svgEl('rect', { x: x + 1.5, y: top + 3, width: U - 3, height: ROW_H - 6, rx: 2, class: 'box' }, svg);
}

// Вид для учеников: только схема, без панели правки. Выход — Esc или кнопка в углу.
function clean(on) {
  document.body.classList.toggle('clean', on ?? !document.body.classList.contains('clean'));
  sel = null;
  show();
}

document.getElementById('exit')?.addEventListener('click', () => clean(false));

// Картинка схемы: шрифт и правила вида уезжают внутрь SVG, иначе в картинке будет не то,
// что на экране. Плотность втрое — чтобы годилось и для печати, и для Телеграма.
const DENSITY = 3;
const MAX_PNG = 5 << 20;                   // картинка должна оставаться отправляемой: не больше 5 МБ

const dataUrl = blob => new Promise(done => {
  const reader = new FileReader();
  reader.onload = () => done(reader.result);
  reader.readAsDataURL(blob);
});

let styleOnce = null;
async function schemeStyle() {
  return styleOnce ??= buildStyle();
}

async function buildStyle() {
  const faces = await Promise.all([['Regular', 400], ['Bold', 700]].map(async ([name, weight]) => {
    const file = await (await fetch(`fonts/FiraSansCondensed-${name}.ttf`)).blob();
    return `@font-face{font-family:'${FONT}';font-weight:${weight};src:url(${await dataUrl(file)})}`;
  }));
  const root = getComputedStyle(document.documentElement);
  const vars = ['--ink', '--muted', '--seam', '--accent', '--pin']
    .map(name => `${name}:${root.getPropertyValue(name)}`).join(';');
  const rules = [...document.styleSheets[0].cssRules]
    .filter(rule => rule.selectorText?.startsWith('.scheme'))
    .map(rule => rule.cssText.replaceAll('.scheme ', 'svg '))
    .join('');
  return `${faces.join('')}svg{${vars};font-family:'${FONT}',sans-serif}${rules}`;
}

// Плотность снижается, пока картинка не уложится в 5 МБ.
async function schemePng(source = document.querySelector('.scheme'), sign = '') {
  for (const density of [DENSITY, 2, 1.5, 1]) {
    const picture = await drawPng(source, density, sign);
    if (!picture || picture.size <= MAX_PNG) return picture;
  }
  return drawPng(source, 0.75, sign);
}

const STRIP = 15;   // полоска под схемой: в ней стоит подпись ученика

async function drawPng(source, density, sign) {
  if (!source) return null;
  const svg = source.cloneNode(true);
  const style = svgEl('style', {}, svg);
  style.textContent = await schemeStyle();
  svg.insertBefore(style, svg.firstChild);

  const image = new Image();
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  await image.decode();
  const box = source.getBoundingClientRect();
  // Подпись не налезает на схему: под неё отводится своя полоска внизу картинки.
  const strip = sign ? Math.round(STRIP * density) : 0;
  const canvas = Object.assign(document.createElement('canvas'),
    { width: Math.round(box.width * density), height: Math.round(box.height * density) + strip });
  const paper = canvas.getContext('2d');
  paper.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--card').trim() || '#fff';
  paper.fillRect(0, 0, canvas.width, canvas.height);
  paper.drawImage(image, 0, 0, canvas.width, canvas.height - strip);
  if (sign) {
    paper.fillStyle = '#6b6375';
    paper.font = `${Math.round(10 * density)}px "${FONT}", sans-serif`;
    paper.textAlign = 'right';
    paper.fillText(sign, canvas.width - 6 * density, canvas.height - 5 * density);
  }
  return new Promise(done => canvas.toBlob(done, 'image/png'));
}

// Все песни разом: программа сама рисует каждую и складывает картинки в папку png/.
async function saveAllPng() {
  const button = document.querySelector('[data-do="all"]');
  const box = document.body.appendChild(document.createElement('div'));
  Object.assign(box.style, { position: 'absolute', left: '-99999px', top: '0', width: '20000px' });
  let done = 0;
  box.replaceChildren();
  const legend = await schemePng(drawSample(box, SAMPLE, LEGEND).querySelector('.scheme'));
  await fetch('/api/png/Как читать схему', { method: 'PUT', body: legend });
  button.textContent = `Картинки: ${++done} из ${songs.length + 1}`;

  for (const one of songs) {
    box.replaceChildren();
    const sheet = htmlEl('div', box, '', 'sheet');
    drawScheme(sheet, one, 0, true);
    const picture = await schemePng(sheet.querySelector('.scheme'));
    await fetch(`/api/png/${encodeURIComponent(one.title)}`, { method: 'PUT', body: picture });
    button.textContent = `Картинки: ${++done} из ${songs.length + 1}`;
  }
  box.remove();
  button.textContent = 'Все картинки';
  alert(`Готово: ${done} картинок в папке png рядом с программой.`);
}

// Имя ученика вводится один раз и запоминается в браузере.
const who = document.getElementById('who');
function startName() {
  who.value = store.get('who') || '';
  who.oninput = () => store.set('who', who.value.trim());
}

// Дата в подписи — как во всём интерфейсе: ДД.ММ.ГГГГ, следом время.
const stamp = () => new Date().toLocaleString('ru-RU',
  { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');

async function savePng() {
  if (!song) return;
  const name = author ? '' : who.value.trim();
  if (!author && !name) {
    alert('Впишите имя наверху страницы: без него будет непонятно, чья это работа.');
    return who.focus();
  }
  const picture = await schemePng(undefined, name && `${song.title} · ${name} · ${stamp()}`);
  if (!picture) return;
  download(picture, name ? `${song.title} — ${name}.png` : `${song.title}.png`);
}

// Выгрузка файла: ссылка на данные в памяти, клик по ней и уборка за собой.
function download(blob, name) {
  const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

// Черновик в файле — запас на случай, когда память браузера не годится: приватное
// окно, чистка, другое устройство. Имя лежит в самом файле, поэтому чужой черновик
// подпишет картинку чужим именем.
// ponytail: имя в файле правится текстовым редактором — бережёт от путаницы, не от умысла.
function saveDraft() {
  if (!song) return;
  const name = who.value.trim();
  download(new Blob([JSON.stringify({ ...song, who: name })], { type: 'application/json' }),
           `${song.title}${name ? ` — ${name}` : ''}.json`);
}

// Открытый черновик ложится в память браузера вместо текущего: дальше страница
// поднимает его обычным путём, разбирать его отдельно не нужно.
function openDraft() {
  const pick = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
  pick.onchange = async () => {
    let draft;
    try { draft = JSON.parse(await pick.files[0].text()); } catch { draft = null; }
    if (!draft?.rows?.length) return alert('Это не файл схемы: нужен файл, сохранённый кнопкой «Сохранить».');
    if (draft.title !== song.title && !confirm(
      `В файле схема «${draft.title}», а на странице «${song.title}». Открыть? Работа на странице пропадёт.`)) return;
    if (draft.who) store.set('who', draft.who);
    if (!store.set(DRAFT, JSON.stringify(draft))) return noMemory();
    location.reload();
  };
  pick.click();
}

// Заготовка для учеников: программа кладёт песню на страницу и возвращает готовую ссылку.
// Выкладывается то, что на экране, поэтому недописанное сохранение сперва дописывается.
async function publish() {
  if (!song) return;
  if (!confirm(`Выложить «${song.title}» заготовкой для учеников?\n\nЗаодно обновится и сама страница.`)) return;
  await flush();
  await working('Выкладываю…', () => fetch('/api/publish', { method: 'POST', body: song.id }));
}

// Правка самой программы доезжает до учеников вместе с заготовкой. Когда публиковать
// нечего, а страницу обновить надо, уезжает она одна: тот же запрос, только без песни.
async function refresh() {
  if (!confirm('Обновить страницу для учеников?\n\nТуда уедет нынешний вид программы, выложенные заготовки останутся на месте.')) return;
  await working('Обновляю…', () => fetch('/api/publish', { method: 'POST' }), 'refresh');
}

// Заготовка уходит со страницы: ссылка перестаёт работать, и её больше не показываем.
async function unpublish() {
  if (!song || !confirm(`Убрать «${song.title}» со страницы для учеников?\n\nСсылка перестанет работать.`)) return;
  await working('Убираю…', () => fetch(`/api/publish/${encodeURIComponent(song.id)}`, { method: 'DELETE' }));
}

// Отправка на GitHub идёт долго: пока идёт, на нажатой кнопке видно, что программа занята.
async function working(label, run, act = 'publish') {
  const button = document.querySelector(`[data-do="${act}"]`);
  const was = button.textContent;
  button.textContent = label;
  const answer = await run().then(r => r.json()).catch(() => null);
  button.textContent = was;
  if (!answer || answer.error) return alert(`Не получилось.\n\n${answer?.error || 'Программа не ответила.'}`);
  if (act === 'refresh') return alert('Страница для учеников обновлена.\n\nGitHub выкладывает её около минуты.');
  if (answer.url) song.link = answer.url; else delete song.link;   // ссылку хранит сама песня
  show();
}

// Дописать отложенное сохранение: дальше песню читает программа, а не браузер.
async function flush() {
  clearTimeout(saving);
  const { id, ...body } = song;
  await fetch(`/api/songs/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
}
