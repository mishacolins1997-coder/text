// Чистая функция форматирования: не зависит от SillyTavern, её можно тестировать в Node.

const QUOTES = { '"': '"', '“': '”', '„': '“', '«': '»', '「': '」', '『': '』' };

// Строки, которые не трогаем: заголовки, цитаты, таблицы, списки (* и +), нумерованные списки, разделители
const SKIP_LINE = /^\s*(#{1,6}\s|>|\||[+*]\s|\d+[.)]\s|---)/;
const HTML_LINE = /<\/?[a-z!][^>]*>/i;
const DASH_START = /^(?:[—–]|-\s)/;
const PARTICLE_AFTER = /^(?:то|либо|нибудь|таки|ка|де|с|ль)$/iu;
const PREFIX_BEFORE = /^(?:по|кое|из|за|во?|как|что|кто|где|куда|когда|кой|кто|чей|какой|какая|какое|какие|что|кому|чему|кем|чем)$/iu;
const PUNCT_START = /^(?:[,;:!?…]|\.(?!\.))/;

// Слова, после которых перенос строки — это граница слов, а не середина слова
const STOP_WORDS = /^(?:в|во|на|с|со|к|ко|по|от|из|за|до|об|о|у|и|а|но|же|ли|не|ни|как|что|то|бы|для|при|над|под|без|про|или|если|когда|чтобы|это|так|там|тут|уже|ещё|еще|да|нет|он|она|оно|они|мы|вы|ты|я|его|ее|её|их|ему|ей|им|все|всё|был|была|было|были|потом|тогда|очень|the|a|an|of|to|in|on|at|and|or|but|is|it|he|she|they|we|you|i|his|her|their|as|by|for|with)$/iu;
const TERMINAL_END = /[.!?…:;»"”)\]*~]$/;
const NO_JOIN_START = /^\s*[—–"“«„*#>|+\-]/;

/**
 * Склеивает строки, жёстко перенесённые посреди предложения/слова
 * («затаил дыха⏎ние» -> «затаил дыхание»).
 */
function unwrapLines(chunk) {
    const res = [];
    for (const line of chunk.split(/\r?\n/)) {
        const prev = res[res.length - 1];
        if (prev !== undefined && canJoin(prev, line)) {
            res[res.length - 1] = joinLines(prev, line);
        } else {
            res.push(line);
        }
    }
    return res.join('\n');
}

function canJoin(prev, next) {
    if (!prev.trim() || !next.trim()) return false;
    if (SKIP_LINE.test(prev) || SKIP_LINE.test(next)) return false;
    if (HTML_LINE.test(prev) || HTML_LINE.test(next)) return false;
    if (NO_JOIN_START.test(next)) return false;
    const a = prev.trimEnd();
    return a.length >= 20 && !TERMINAL_END.test(a);
}

function joinLines(prev, next) {
    const a = prev.trimEnd();
    const b = next.trimStart();
    // пробел на стыке = граница слов
    if (/\s$/.test(prev) || /^\s/.test(next)) return a + ' ' + b;
    const lastWord = (a.match(/(\p{L}+)$/u) || [])[1];
    // обрыв посреди слова: буква + строчная буква, и последнее слово — не служебное
    if (lastWord && /^\p{Ll}/u.test(b) && !STOP_WORDS.test(lastWord)) return a + b;
    return a + ' ' + b;
}

/** Показывает, что «странного» лежит в тексте (для отладки). */
export function diagnose(text) {
    const lines = String(text).split(/\r?\n/).filter(l => l.trim());
    const special = {};
    for (const ch of String(text)) {
        const c = ch.codePointAt(0);
        if (c === 0xAD || c === 0x200B || c === 0x200C || c === 0x200D || c === 0x2060 || c === 0xFEFF
            || c === 0xA0 || c === 0xAC || (c >= 0x2010 && c <= 0x2015)) {
            const k = 'U+' + c.toString(16).toUpperCase().padStart(4, '0');
            special[k] = (special[k] || 0) + 1;
        }
    }
    return {
        'всего строк': lines.length,
        'строк, оборванных без знака конца': lines.slice(0, -1).filter(l => canJoin(l, 'x')).length,
        'строк, начинающихся с пробела': lines.filter(l => /^\s/.test(l)).length,
        'особые символы': special,
    };
}

function tokenize(line, o) {
    const tokens = [];
    let buf = '';

    const flush = () => {
        const text = buf.trim();
        buf = '';
        if (!text) return;
        const isDash = o.dashDialogue && DASH_START.test(text);
        tokens.push({ type: isDash ? 'speech' : 'text', text });
    };

    let i = 0;
    while (i < line.length) {
        const ch = line[i];

        if (ch === '*') {
            let run = 1;
            while (line[i + run] === '*') run++;
            const marker = '*'.repeat(run);
            const end = line.indexOf(marker, i + run);
            if (end > i + run) {
                flush();
                tokens.push({ type: 'action', text: line.slice(i, end + run) });
                i = end + run;
                continue;
            }
            buf += marker;
            i += run;
            continue;
        }

        if (QUOTES[ch]) {
            const end = line.indexOf(QUOTES[ch], i + 1);
            if (end > i + 1) {
                flush();
                tokens.push({ type: 'speech', text: line.slice(i, end + 1) });
                i = end + 1;
                continue;
            }
        }

        buf += ch;
        i++;
    }
    flush();
    return tokens;
}

function formatLine(line, o) {
    const paras = [];
    let lastType = null;
    let join = false; // после «"Привет," сказал он, » следующая реплика — продолжение

    for (const t of tokens(line, o)) {
        const last = paras.length - 1;

        if (t.type === 'text' && last >= 0) {
            if (PUNCT_START.test(t.text)) {
                paras[last] += t.text;
                join = o.attachTags && lastType === 'speech' && /[,:]$/.test(t.text);
                continue;
            }
            if (o.attachTags && lastType === 'speech' && /^\p{Ll}/u.test(t.text)) {
                paras[last] += ' ' + t.text;
                join = /[,:]$/.test(t.text);
                continue;
            }
        }

        if (t.type === 'speech' && join && last >= 0) {
            paras[last] += ' ' + t.text;
            join = false;
            continue;
        }

        paras.push(t.text);
        lastType = t.type;
        join = false;
    }
    return paras;
}

const tokens = tokenize;

// Многострочные HTML-блоки (инфоблоки, карточки, <think>) не трогаем целиком
const HTML_TAGS = 'div|style|svg|details|table|section|center|script|think|thinking|html|body|pre|ul|ol|blockquote|figure|template';
const OPEN_RE = new RegExp(`<(?:${HTML_TAGS})\\b(?![^>]*\\/>)`, 'gi');
const CLOSE_RE = new RegExp(`<\\/(?:${HTML_TAGS})\\s*>`, 'gi');

function splitHtmlBlocks(text) {
    const segs = [];
    let depth = 0;
    for (const line of text.split(/\r?\n/)) {
        const opens = (line.match(OPEN_RE) || []).length;
        const closes = (line.match(CLOSE_RE) || []).length;
        const html = depth > 0 || opens > 0 || closes > 0 || HTML_LINE.test(line);
        depth = Math.max(0, depth + opens - closes);
        const last = segs[segs.length - 1];
        if (last && last.html === html) last.lines.push(line);
        else segs.push({ html, lines: [line] });
    }
    return segs;
}

/**
 * Разделяет реплики (в кавычках / через тире), действия (*...*) и повествование
 * на отдельные абзацы.
 * @param {string} text
 * @param {{attachTags?: boolean, dashDialogue?: boolean, fixHyphens?: boolean, unwrap?: boolean, separator?: string}} opts
 */
export function formatText(text, opts = {}) {
    const o = { attachTags: true, dashDialogue: true, fixHyphens: true, unwrap: true, separator: '\n\n', ...opts };
    if (typeof text !== 'string' || !text.trim()) return text;

    const out = [];
    for (const part of text.split(/(```[\s\S]*?```)/g)) {
        if (part.startsWith('```')) {
            out.push(part);
            continue;
        }
        for (const seg of splitHtmlBlocks(part)) {
            if (seg.html) {
                const block = seg.lines.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, '');
                if (block.trim()) out.push(block);
                continue;
            }
            let chunk = seg.lines.join('\n');
            if (o.fixHyphens) {
                // «Полов-⏎ины» -> «Половины». Дефисом может быть любой похожий символ,
                // после него — пробелы и один или несколько переводов строки.
                chunk = chunk
                    .replace(/[\u00AD\u200B\u2060\uFEFF]/g, '')
                    .replace(/(\p{L}+)[-\u2010\u2011\u2012\u2013\u00AC][ \t]*(?:\r?\n[ \t]*)+(\p{Ll}+)/gu, (m, a, b) =>
                        // настоящие дефисные слова (кто-то, по-моему, кое-как) не склеиваем
                        PARTICLE_AFTER.test(b) || PREFIX_BEFORE.test(a) ? `${a}-${b}` : a + b);
            }
            if (o.unwrap) chunk = unwrapLines(chunk);
            for (const line of chunk.split(/\r?\n/)) {
                if (!line.trim()) continue;
                if (SKIP_LINE.test(line)) {
                    out.push(line);
                    continue;
                }
                out.push(...formatLine(line, o));
            }
        }
    }
    return out.join(o.separator);
}
