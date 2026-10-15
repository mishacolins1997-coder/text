import { eventSource, event_types, saveSettingsDebounced, reloadCurrentChat } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const MODULE = 'dialogue_splitter';

const DEFAULTS = {
    enabled: true,
    split: true,               // начинать реплику с нового абзаца
    splitAfter: false,         // дополнительно отделять действие, идущее после реплики и ремарки
    indent: 1.5,               // красная строка, em
    indentDialogueOnly: false, // красная строка только у абзацев, начинающихся с реплики
    gap: 0.3,                  // отступ между абзацами, em
    colorize: false,
    dialogueColor: '#f0cf8a',
    actionColor: '#a9b1bd',
};

// реплика в кавычках: "..." “...” «...» „...“
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

/** Разбирает <p> на плоский список токенов: text / dialogue / em / inline / br. */
function tokenize(p) {
    const tokens = [];
    for (const node of Array.from(p.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent;
            let last = 0;
            let m;
            QUOTE_RE.lastIndex = 0;
            while ((m = QUOTE_RE.exec(text)) !== null) {
                if (m.index > last) tokens.push({ kind: 'text', node: document.createTextNode(text.slice(last, m.index)) });
                tokens.push({ kind: 'dialogue', node: document.createTextNode(m[0]) });
                last = m.index + m[0].length;
            }
            if (last < text.length) tokens.push({ kind: 'text', node: document.createTextNode(text.slice(last)) });
        } else if (node.nodeName === 'Q') {
            tokens.push({ kind: 'dialogue', node });
        } else if (node.nodeName === 'EM' || node.nodeName === 'I') {
            tokens.push({ kind: 'em', node });
        } else if (node.nodeName === 'BR') {
            tokens.push({ kind: 'br', node });
        } else {
            tokens.push({ kind: 'inline', node });
        }
    }
    return tokens;
}

/** Заканчивается ли накопленный текст законченным предложением (или репликой)? */
function endsSentence(text) {
    return /[.!?…»”"*]$/.test(text.trimEnd());
}

/**
 * Правила:
 *  - реплика начинает новый абзац (красная строка), если перед ней закончилось предложение;
 *  - если перед репликой стоит подводка с двоеточием/запятой/тире
 *    («Она ответила, не отрываясь от работы: «...»»), реплика остаётся в том же абзаце;
 *  - ремарка автора и действия после реплики остаются в абзаце с репликой
 *    (если не включена опция splitAfter).
 */
function splitIntoBlocks(tokens, s) {
    const blocks = [];
    let cur = null;
    let afterDialogue = false;

    const newBlock = () => {
        cur = { tokens: [], text: '' };
        blocks.push(cur);
    };
    const add = (kind, node) => {
        if (!cur) newBlock();
        cur.tokens.push({ kind, node });
        cur.text += node.textContent;
    };

    for (const t of tokens) {
        if (t.kind === 'br') {
            cur = null;
            afterDialogue = false;
            continue;
        }

        if (t.kind === 'dialogue') {
            if (cur && cur.text.trim() && endsSentence(cur.text)) newBlock();
            add('dialogue', t.node);
            afterDialogue = true;
            continue;
        }

        const isWhitespace = t.kind === 'text' && !t.node.textContent.trim();
        if (isWhitespace) {
            if (cur) add('text', t.node);
            continue;
        }

        if (s.splitAfter && afterDialogue) {
            if (t.kind === 'text') {
                const text = t.node.textContent;
                let tag = '';
                let rest = text;
                // ремарка автора: «— сказал он.» / «, проскрипела старушка.»
                if (/^\s*[—–-]/.test(text) || /^[\s,]*\p{Ll}/u.test(text)) {
                    const m = /[.!?…]+(?=\s|$)/.exec(text);
                    if (m) {
                        const end = m.index + m[0].length;
                        tag = text.slice(0, end);
                        rest = text.slice(end);
                    } else {
                        tag = text;
                        rest = '';
                    }
                }
                if (tag) add('text', document.createTextNode(tag));
                if (rest.trim()) {
                    newBlock();
                    add('text', document.createTextNode(rest));
                }
                afterDialogue = false;
                continue;
            }
            if (t.kind === 'em') {
                newBlock();
                add('em', t.node);
                afterDialogue = false;
                continue;
            }
        }

        add(t.kind, t.node);
    }

    // чистим пробелы по краям блоков
    for (const block of blocks) {
        const isWs = tk => tk.node.nodeType === Node.TEXT_NODE && !tk.node.textContent.trim();
        while (block.tokens.length && isWs(block.tokens[0])) block.tokens.shift();
        while (block.tokens.length && isWs(block.tokens[block.tokens.length - 1])) block.tokens.pop();

        const first = block.tokens[0]?.node;
        const last = block.tokens[block.tokens.length - 1]?.node;
        if (first?.nodeType === Node.TEXT_NODE) first.textContent = first.textContent.trimStart();
        if (last?.nodeType === Node.TEXT_NODE) last.textContent = last.textContent.trimEnd();
    }

    return blocks.filter(b => b.tokens.length > 0);
}

function buildParagraph(block) {
    const p = document.createElement('p');
    const startsWithDialogue = block.tokens[0].kind === 'dialogue';
    p.className = `sdf-block ${startsWithDialogue ? 'sdf-block-dialogue' : 'sdf-block-action'}`;

    for (const { kind, node } of block.tokens) {
        const cls = kind === 'dialogue' ? 'sdf-d' : 'sdf-a';

        if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
            p.appendChild(node);
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
    const tokens = tokenize(p);
    if (tokens.length === 0) return;

    const blocks = s.split
        ? splitIntoBlocks(tokens, s)
        : [{ tokens, text: '' }];

    if (blocks.length === 0) return;
    p.replaceWith(...blocks.map(buildParagraph));
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
    root.setProperty('--sdf-indent', `${s.indent}em`);
    document.body.classList.toggle('sdf-colorize', !!s.colorize);
    document.body.classList.toggle('sdf-indent-d', !!s.indentDialogueOnly);
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
                <label class="checkbox_label"><input type="checkbox" id="sdf_split"><span>Реплика — с новой строки (красная строка)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="sdf_after"><span>Отделять действие, идущее после реплики и ремарки автора</span></label>
                <hr>
                <div class="sdf-row">
                    <span>Красная строка (em):</span>
                    <input type="number" id="sdf_indent" class="text_pole" min="0" max="6" step="0.5">
                </div>
                <label class="checkbox_label"><input type="checkbox" id="sdf_indent_d"><span>Красная строка только у абзацев с репликой</span></label>
                <div class="sdf-row">
                    <span>Отступ между абзацами (em):</span>
                    <input type="number" id="sdf_gap" class="text_pole" min="0" max="3" step="0.1">
                </div>
                <hr>
                <label class="checkbox_label"><input type="checkbox" id="sdf_colorize"><span>Раскрасить реплики и действия</span></label>
                <div class="sdf-row">
                    <span>Реплики:</span><input type="color" id="sdf_dcolor">
                    <span>Действия:</span><input type="color" id="sdf_acolor">
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
    $('#sdf_after').prop('checked', s.splitAfter);
    $('#sdf_indent').val(s.indent);
    $('#sdf_indent_d').prop('checked', s.indentDialogueOnly);
    $('#sdf_gap').val(s.gap);
    $('#sdf_colorize').prop('checked', s.colorize);
    $('#sdf_dcolor').val(s.dialogueColor);
    $('#sdf_acolor').val(s.actionColor);

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
    bind('#sdf_after', 'splitAfter', checked, true);
    bind('#sdf_indent', 'indent', num, false);
    bind('#sdf_indent_d', 'indentDialogueOnly', checked, false);
    bind('#sdf_gap', 'gap', num, false);
    bind('#sdf_colorize', 'colorize', checked, false);
    bind('#sdf_dcolor', 'dialogueColor', value, false);
    bind('#sdf_acolor', 'actionColor', value, false);

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
