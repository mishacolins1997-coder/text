// Чистая функция форматирования: не зависит от SillyTavern, её можно тестировать в Node.

const QUOTES = { '"': '"', '“': '”', '„': '“', '«': '»', '「': '」', '『': '』' };

// Строки, которые не трогаем: заголовки, цитаты, таблицы, списки (* и +), нумерованные списки, разделители
const SKIP_LINE = /^\s*(#{1,6}\s|>|\||[+*]\s|\d+[.)]\s|---)/;
const HTML_LINE = /<\/?[a-z!][^>]*>/i;
const DASH_START = /^(?:[—–]|-\s)/;
const PARTICLE_AFTER = /^(?:то|либо|нибудь|таки|ка|де|с|ль)$/iu;
const PREFIX_BEFORE = /^(?:по|кое|из|за|во?|как|что|кто|где|куда|когда|кой|кто|чей|какой|какая|какое|какие|что|кому|чему|кем|чем)$/iu;
const PUNCT_START = /^(?:[,;:!?…]|\.(?!\.))/;

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

/**
 * Разделяет реплики (в кавычках / через тире), действия (*...*) и повествование
 * на отдельные абзацы.
 * @param {string} text
 * @param {{attachTags?: boolean, dashDialogue?: boolean, fixHyphens?: boolean, separator?: string}} opts
 */
export function formatText(text, opts = {}) {
    const o = { attachTags: true, dashDialogue: true, fixHyphens: true, separator: '\n\n', ...opts };
    if (typeof text !== 'string' || !text.trim()) return text;

    const out = [];
    for (const part of text.split(/(```[\s\S]*?```)/g)) {
        if (part.startsWith('```')) {
            out.push(part);
            continue;
        }
        let chunk = part;
        if (o.fixHyphens) {
            // «Полов-⏎ины» -> «Половины». Дефисом может быть любой похожий символ,
            // после него — пробелы и один или несколько переводов строки.
            chunk = chunk
                .replace(/\u00AD/g, '')
                .replace(/(\p{L}+)[-\u2010\u2011\u2012\u2013\u00AC][ \t]*(?:\r?\n[ \t]*)+(\p{Ll}+)/gu, (m, a, b) =>
                    // настоящие дефисные слова (кто-то, по-моему, кое-как) не склеиваем
                    PARTICLE_AFTER.test(b) || PREFIX_BEFORE.test(a) ? `${a}-${b}` : a + b);
        }
        for (const line of chunk.split(/\r?\n/)) {
            if (!line.trim()) continue;
            if (SKIP_LINE.test(line) || HTML_LINE.test(line)) {
                out.push(line);
                continue;
            }
            out.push(...formatLine(line, o));
        }
    }
    return out.join(o.separator);
}
