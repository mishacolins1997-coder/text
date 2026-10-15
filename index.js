import { eventSource, event_types, saveSettingsDebounced, reloadCurrentChat } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const MODULE = 'dialogue_splitter';

const DEFAULTS = {
    enabled: true,
    split: true,            // разбивать на отдельные абзацы
    mergeTags: true,        // не отрывать короткие ремарки автора ("— сказал он")
    tagLen: 30,             // макс. длина такой ремарки
    colorize: true,
    dialogueColor: '#f0cf8a',
    actionColor: '#a9b1bd',
    italic: true,           // курсив для действий
    gap: 0.6,               // отступ между блоками, em
};

// "реплика" в кавычках: "..." “...” «...» „...“
const QUOTE_RE = /"[^"\n]+"|“[^”\n]+”|«[^»\n]+»|„[^“”\n]+[“”]/g;

function getSettings() {
    if (!extension_settings[MODULE]) extension_settings[MODULE] = {};
    const s = extension_settings[MODULE];
    for (const key of Object.keys(DEFAULTS)) {
        if (!(key in s)) s[key] = DEFAULTS[key];
    }
    return s;
}

/* ---------------------------- Обработка текста ---------------------------- */

/** Разбирает <p> на последовательность сегментов: диалог / действие / разрыв / прочее. */
function getSegments(p) {
    const segs = [];
    for (const node of Array.from(p.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            let last = 0;
            let m;
            QUOTE_RE.lastIndex = 0;
            while ((m = QUOTE_RE.exec(text)) !== null) {
                if (m.index > last) segs.push({ type: 'action', node: document.createTextNode(text.slice(last, m.index)) });
                segs.push({ type: 'dialogue', node: document.createTextNode(m[0]) });
                last = m.index + m[0].length;
            }
            if (last < text.length) segs.push({ type: 'action', node: document.createTextNode(text.slice(last)) });
        } else if (node.nodeName === 'Q') {
            segs.push({ type: 'dialogue', node });
        } else if (node.nodeName === 'EM' || node.nodeName === 'I') {
            segs.push({ type: 'action', node });
        } else if (node.nodeName === 'BR') {
            segs.push({ type: 'break', node });
        } else {
            segs.push({ type: 'inline', node }); // strong, code и т.п. — продолжают текущий блок
        }
    }
    return segs;
}

/** Группирует сегменты в последовательные блоки одного типа. */
function buildRuns(segs) {
    const runs = [];
    let cur = null;

    for (const seg of segs) {
        if (seg.type === 'break') {
            cur = null;
            continue;
        }

        const type = seg.type === 'inline' ? (cur ? cur.type : 'action') : seg.type;
        const isText = seg.node.nodeType === Node.TEXT_NODE;

        // пробелы между блоками
        if (isText && !seg.node.textContent.trim()) {
            if (cur) cur.items.push({ type: cur.type, node: seg.node });
            continue;
        }

        if (!cur || cur.type !== type) {
            cur = { type, items: [] };
            runs.push(cur);
        }
        cur.items.push({ type, node: seg.node });
    }

    // обрезаем пробелы по краям блоков
    for (const run of runs) {
        const first = run.items[0]?.node;
        const last = run.items[run.items.length - 1]?.node;
        if (first?.nodeType === Node.TEXT_NODE) first.textContent = first.textContent.trimStart();
        if (last?.nodeType === Node.TEXT_NODE) last.textContent = last.textContent.trimEnd();
        run.items = run.items.filter(it => it.node.nodeType !== Node.TEXT_NODE || it.node.textContent.length > 0);
    }

    return runs.filter(r => r.items.length > 0);
}

function runText(run) {
    return run.items.map(it => it.node.textContent).join('').trim();
}

/** Приклеивает короткие ремарки ("— сказал он") к предыдущей реплике. */
function mergeShortTags(runs, maxLen) {
    for (let i = 1; i < runs.length; i++) {
        const run = runs[i];
        const prev = runs[i - 1];
        if (run.type !== 'action' || prev.type !== 'dialogue') continue;

        const firstEl = run.items.find(it => it.node.nodeType !== Node.TEXT_NODE || it.node.textContent.trim());
        if (firstEl && (firstEl.node.nodeName === 'EM' || firstEl.node.nodeName === 'I')) continue;

        const text = runText(run);
        if (text.length > maxLen) continue;
        if (!/^\s*[—–-]/.test(text) && !/^[\s,]*\p{Ll}/u.test(text)) continue;

        prev.items.push({ type: 'action', node: document.createTextNode(' ') });
        prev.items.push(...run.items);
        runs.splice(i, 1);
        i--;
    }
}

function buildBlock(items, blockType) {
    const p = document.createElement('p');
    p.className = `sdf-block sdf-block-${blockType}`;

    for (const { type, node } of items) {
        const cls = type === 'dialogue' ? 'sdf-d' : 'sdf-a';

        if (node.nodeType === Node.TEXT_NODE) {
            if (!node.textContent.trim()) {
                p.appendChild(node);
                continue;
            }
            const span = document.createElement('span');
            span.className = cls;
            span.appendChild(node);
            p.appendChild(span);
        } else if (node.nodeName === 'Q' || node.nodeName === 'EM' || node.nodeName === 'I') {
            node.classList.add(cls);
            p.appendChild(node);
        } else {
            const span = document.createElement('span');
            span.className = cls;
            span.appendChild(node);
            p.appendChild(span);
        }
    }
    return p;
}

function processParagraph(p, s) {
    const runs = buildRuns(getSegments(p));
    if (runs.length === 0) return;

    if (s.mergeTags) mergeShortTags(runs, s.tagLen);

    let blocks;
    if (s.split) {
        blocks = runs.map(run => buildBlock(run.items, run.type));
    } else {
        const all = [];
        runs.forEach((run, i) => {
            if (i > 0) all.push({ type: run.type, node: document.createTextNode(' ') });
            all.push(...run.items);
        });
        blocks = [buildBlock(all, 'mixed')];
    }

    p.replaceWith(...blocks);
}

function processMessage(el) {
    const s = getSettings();
    if (!s.enabled || !el || el.querySelector('.sdf-block')) return;

    for (const child of Array.from(el.children)) {
        if (child.tagName === 'P') processParagraph(child, s);
    }
}

function processAll() {
    document.querySelectorAll('#chat .mes_text').forEach(processMessage);
}

/* -------------------------------- Стили ---------------------------------- */

function applyStyle() {
    const s = getSettings();
    const root = document.documentElement.style;
    root.setProperty('--sdf-d-color', s.dialogueColor);
    root.setProperty('--sdf-a-color', s.actionColor);
    root.setProperty('--sdf-gap', `${s.gap}em`);
    document.body.classList.toggle('sdf-colorize', !!s.colorize);
    document.body.classList.toggle('sdf-italic', !!s.italic);
}

/* ------------------------------ Интерфейс -------------------------------- */

function buildSettingsUI() {
    const s = getSettings();

    const html = `
    <div class="sdf-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Dialogue Splitter</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="sdf_enabled"><span>Включить расширение</span></label>
                <label class="checkbox_label"><input type="checkbox" id="sdf_split"><span>Разделять реплики и действия на отдельные абзацы</span></label>
                <label class="checkbox_label"><input type="checkbox" id="sdf_merge"><span>Не отрывать короткие ремарки («— сказал он»)</span></label>
                <div class="sdf-row">
                    <span>Макс. длина ремарки:</span>
                    <input type="number" id="sdf_taglen" class="text_pole" min="5" max="200" step="5">
                </div>
                <hr>
                <label class="checkbox_label"><input type="checkbox" id="sdf_colorize"><span>Раскрасить реплики и действия</span></label>
                <div class="sdf-row">
                    <span>Реплики:</span><input type="color" id="sdf_dcolor">
                    <span>Действия:</span><input type="color" id="sdf_acolor">
                </div>
                <label class="checkbox_label"><input type="checkbox" id="sdf_italic"><span>Курсив для действий</span></label>
                <div class="sdf-row">
                    <span>Отступ между блоками (em):</span>
                    <input type="number" id="sdf_gap" class="text_pole" min="0" max="3" step="0.1">
                </div>
                <div class="sdf-row">
                    <div id="sdf_apply" class="menu_button">Применить к текущему чату</div>
                </div>
                <small>Расширение меняет только отображение, сам текст сообщений не изменяется.</small>
            </div>
        </div>
    </div>`;

    $('#extensions_settings2').append(html);

    $('#sdf_enabled').prop('checked', s.enabled);
    $('#sdf_split').prop('checked', s.split);
    $('#sdf_merge').prop('checked', s.mergeTags);
    $('#sdf_taglen').val(s.tagLen);
    $('#sdf_colorize').prop('checked', s.colorize);
    $('#sdf_dcolor').val(s.dialogueColor);
    $('#sdf_acolor').val(s.actionColor);
    $('#sdf_italic').prop('checked', s.italic);
    $('#sdf_gap').val(s.gap);

    const bind = (selector, key, getter, needsReload) => {
        $(selector).on('input change', function () {
            s[key] = getter($(this));
            saveSettingsDebounced();
            applyStyle();
            if (needsReload) $('#sdf_apply').addClass('redWarningBG');
        });
    };

    const checked = el => el.prop('checked');
    const value = el => el.val();
    const num = el => Number(el.val()) || 0;

    bind('#sdf_enabled', 'enabled', checked, true);
    bind('#sdf_split', 'split', checked, true);
    bind('#sdf_merge', 'mergeTags', checked, true);
    bind('#sdf_taglen', 'tagLen', num, true);
    bind('#sdf_colorize', 'colorize', checked, false);
    bind('#sdf_dcolor', 'dialogueColor', value, false);
    bind('#sdf_acolor', 'actionColor', value, false);
    bind('#sdf_italic', 'italic', checked, false);
    bind('#sdf_gap', 'gap', num, false);

    $('#sdf_apply').on('click', async () => {
        $('#sdf_apply').removeClass('redWarningBG');
        await reloadCurrentChat();
    });
}

/* -------------------------------- Запуск --------------------------------- */

jQuery(() => {
    getSettings();
    buildSettingsUI();
    applyStyle();

    // Следим за чатом: новые сообщения, свайпы, правки, смена чата
    const chat = document.getElementById('chat');
    if (chat) {
        let timer = null;
        const observer = new MutationObserver(() => {
            clearTimeout(timer);
            timer = setTimeout(processAll, 120);
        });
        observer.observe(chat, { childList: true, subtree: true });
    }

    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(processAll, 150));
    processAll();
});
