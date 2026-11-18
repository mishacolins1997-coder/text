import { eventSource, event_types, chat, saveChatConditional, saveSettingsDebounced, updateMessageBlock } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { formatText, diagnose } from './formatter.js';

const MODULE = 'dialogue_splitter';
const DEFAULTS = {
    auto: true,           // форматировать новые ответы персонажа автоматически
    userMessages: false,  // форматировать и сообщения пользователя
    attachTags: true,     // «...», — сказал он  (слова автора остаются с репликой)
    dashDialogue: true,   // реплики через тире (— Привет!)
    separator: 'blank',   // 'blank' = пустая строка, 'single' = обычный перенос
    spacing: true,        // отступы между абзацами в чате
    fixHyphens: true,     // склеивать слова, разорванные переносом («Полов-\nины»)
    indent: true,         // красная строка (отступ первой строки абзаца)
    tint: true,           // разные фоны для реплик / действий / повествования
    unwrap: true,         // склеивать строки, жёстко оборванные посреди слов/предложений
    noAutoHyphens: true,  // отключить авто-переносы слов браузером в чате
};

function getSettings() {
    extension_settings[MODULE] = Object.assign({}, DEFAULTS, extension_settings[MODULE]);
    return extension_settings[MODULE];
}

function formatOptions() {
    const s = getSettings();
    return {
        attachTags: s.attachTags,
        dashDialogue: s.dashDialogue,
        fixHyphens: s.fixHyphens,
        unwrap: s.unwrap,
        separator: s.separator === 'single' ? '\n' : '\n\n',
    };
}

/** Переформатирует сообщение по индексу. Возвращает true, если текст изменился. */
async function reformatMessage(id) {
    const msg = chat[id];
    if (!msg || msg.is_system || typeof msg.mes !== 'string') return false;

    const next = formatText(msg.mes, formatOptions());
    if (next === msg.mes) return false;

    msg.mes = next;
    if (Array.isArray(msg.swipes) && msg.swipe_id !== undefined && msg.swipes[msg.swipe_id] !== undefined) {
        msg.swipes[msg.swipe_id] = next;
    }
    updateMessageBlock(id, msg);
    await saveChatConditional();
    return true;
}

function applyBodyClass() {
    document.body.classList.toggle('st-dsplit-spacing', getSettings().spacing);
    document.body.classList.toggle('st-dsplit-nohyphen', getSettings().noAutoHyphens);
    document.body.classList.toggle('st-dsplit-indent', getSettings().indent);
    document.body.classList.toggle('st-dsplit-tint', getSettings().tint);
}

function addMessageButtons() {
    const btn = '<div title="Разделить диалоги и действия" class="mes_button st-dsplit-btn fa-solid fa-align-left interactable" tabindex="0"></div>';
    $('#message_template .mes_buttons .extraMesButtons').prepend(btn);
    $('#chat .mes .extraMesButtons').each(function () {
        if (!$(this).find('.st-dsplit-btn').length) $(this).prepend(btn);
    });
    $(document).on('click', '.st-dsplit-btn', async function () {
        const id = Number($(this).closest('.mes').attr('mesid'));
        if (Number.isNaN(id)) return;
        const changed = await reformatMessage(id);
        toastr.info(changed ? 'Сообщение отформатировано' : 'Менять нечего', 'Dialogue Splitter');
    });
}

function renderSettings() {
    const html = `
    <div class="st-dsplit-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Dialogue Splitter</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_auto"><span>Авто-форматирование ответов персонажа</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_user"><span>Форматировать и мои сообщения</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_tags"><span>Оставлять слова автора рядом с репликой («…», — сказал он)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_dash"><span>Считать репликами строки с тире (— Привет!)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_fixhyph"><span>Склеивать слова, разорванные переносом (Полов-ины)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_unwrap"><span>Склеивать строки, оборванные посреди слов (дыха⏎ние)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_nohyph"><span>Отключить авто-переносы слов в чате</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_indent"><span>Красная строка (отступ первой строки)</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_tint"><span>Разные фоны для реплик, действий и повествования</span></label>
                <label class="checkbox_label"><input type="checkbox" id="st_dsplit_spacing"><span>Отступы между абзацами в чате</span></label>
                <label for="st_dsplit_sep">Разделитель абзацев</label>
                <select id="st_dsplit_sep" class="text_pole">
                    <option value="blank">Пустая строка</option>
                    <option value="single">Обычный перенос строки</option>
                </select>
                <div class="menu_button" id="st_dsplit_last">Отформатировать последнее сообщение</div>
                <div class="menu_button" id="st_dsplit_diag">Диагностика последнего сообщения</div>
            </div>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    const s = getSettings();
    const bind = (sel, key) => {
        $(sel).prop('checked', s[key]).on('change', function () {
            s[key] = $(this).prop('checked');
            saveSettingsDebounced();
            if (['spacing', 'noAutoHyphens', 'indent', 'tint'].includes(key)) applyBodyClass();
        });
    };
    bind('#st_dsplit_auto', 'auto');
    bind('#st_dsplit_user', 'userMessages');
    bind('#st_dsplit_tags', 'attachTags');
    bind('#st_dsplit_dash', 'dashDialogue');
    bind('#st_dsplit_spacing', 'spacing');
    bind('#st_dsplit_fixhyph', 'fixHyphens');
    bind('#st_dsplit_nohyph', 'noAutoHyphens');
    bind('#st_dsplit_unwrap', 'unwrap');
    bind('#st_dsplit_indent', 'indent');
    bind('#st_dsplit_tint', 'tint');

    $('#st_dsplit_sep').val(s.separator).on('change', function () {
        s.separator = String($(this).val());
        saveSettingsDebounced();
    });
    $('#st_dsplit_diag').on('click', showDiagnostics);
    $('#st_dsplit_last').on('click', async () => {
        const changed = await reformatMessage(chat.length - 1);
        toastr.info(changed ? 'Сообщение отформатировано' : 'Менять нечего', 'Dialogue Splitter');
    });
}

/** Помечает абзацы в чате классами: реплика / действие / повествование (только для оформления). */
function classifyParagraph(p) {
    const text = p.textContent.trim();
    if (!text) return null;
    const nodes = [...p.childNodes].filter(n => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim()));
    const single = nodes.length === 1 ? nodes[0].nodeName : '';
    if (single === 'EM') return 'action';
    if (single === 'Q' || /^[«"“„—–-]/.test(text)) return 'speech';
    return 'narration';
}

function decorateChat() {
    document.querySelectorAll('#chat .mes_text > p').forEach((p) => {
        const type = classifyParagraph(p);
        p.classList.remove('st-dsplit-speech', 'st-dsplit-action', 'st-dsplit-narration');
        if (type) p.classList.add(`st-dsplit-${type}`);
    });
}

function watchChat() {
    let timer = null;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(decorateChat, 120);
    };
    // классы не отслеживаем (attributes: false), поэтому цикла не будет
    new MutationObserver(schedule).observe(document.getElementById('chat'), {
        childList: true, subtree: true, characterData: true,
    });
    decorateChat();
}

function showDiagnostics() {
    const msg = chat[chat.length - 1];
    if (!msg || typeof msg.mes !== 'string') return toastr.warning('Нет сообщения');
    const d = diagnose(msg.mes);
    console.log('[Dialogue Splitter] диагностика', d, JSON.stringify(msg.mes.slice(0, 600)));
    toastr.info(JSON.stringify(d, null, 1), 'Dialogue Splitter: диагностика', { timeOut: 20000 });
}

async function registerSlashCommand() {
    try {
        const { SlashCommandParser } = await import('../../../slash-commands/SlashCommandParser.js');
        const { SlashCommand } = await import('../../../slash-commands/SlashCommand.js');
        SlashCommandParser.addCommandObject(SlashCommand.fromProps({
            name: 'dsplit',
            helpString: 'Разделяет реплики и действия в сообщении. Без аргумента — последнее сообщение, иначе номер сообщения: /dsplit 12',
            callback: async (_args, value) => {
                const id = value && String(value).trim() ? Number(value) : chat.length - 1;
                const changed = await reformatMessage(id);
                return changed ? 'ok' : 'no changes';
            },
        }));
    } catch (e) {
        console.warn('[Dialogue Splitter] slash command not registered', e);
    }
}

jQuery(() => {
    getSettings();
    renderSettings();
    addMessageButtons();
    applyBodyClass();
    registerSlashCommand();
    watchChat();

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, async (id) => {
        if (getSettings().auto) await reformatMessage(Number(id));
    });
    eventSource.on(event_types.USER_MESSAGE_RENDERED, async (id) => {
        const s = getSettings();
        if (s.auto && s.userMessages) await reformatMessage(Number(id));
    });
});
