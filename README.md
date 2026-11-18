# Dialogue Splitter for SillyTavern

🇷🇺 [Русский](#русский) · 🇬🇧 [English](#english)

## Русский

Расширение для SillyTavern, которое разделяет пост на отдельные абзацы: **реплики**, **действия** и **повествование**.

**Было:**
```
*Она медленно подняла взгляд.* "Ты опоздал," сказала она, "как всегда." *Скрестила руки.* Ветер хлопнул ставнями.
```
**Стало:**
```
*Она медленно подняла взгляд.*

"Ты опоздал," сказала она, "как всегда."

*Скрестила руки.*

Ветер хлопнул ставнями.
```

### Возможности
- Автоматически форматирует каждый новый ответ (включая свайпы и регенерации).
- Понимает `*действия*`, `"реплики"`, `«ёлочки»`, `“кавычки”`, а также реплики через тире (`— Привет!`).
- Слова автора остаются рядом с репликой: `"Привет," — сказал он.`
- Не трогает блоки кода, HTML, заголовки, списки и таблицы.
- Склеивает слова, разорванные переносом (`Полов-⏎ины` → `Половины`), и отключает авто-переносы слов в чате.
- Кнопка на каждом сообщении (иконка выравнивания в меню «⋯») и команда `/dsplit [номер]`.
- Настройки: авто-режим, свои сообщения, разделитель (пустая строка / перенос), отступы между абзацами.

### Установка
1. В SillyTavern откройте **Extensions → Install extension**.
2. Вставьте ссылку на этот репозиторий: `https://github.com/YOUR_USERNAME/SillyTavern-DialogueSplitter`
3. Настройки появятся в списке расширений как **Dialogue Splitter**.

Либо вручную: скопируйте папку в `SillyTavern/public/scripts/extensions/third-party/` (или в `data/<user>/extensions/`).

### Ограничения
Если в одной строке есть кавычка без пары или незакрытая `*`, этот символ считается обычным текстом. Строки с HTML-тегами пропускаются целиком.

## English

A SillyTavern extension that splits a message into separate paragraphs for **dialogue**, **actions** and **narration**.

- Auto-formats every new character reply (swipes and regenerations included).
- Handles `*actions*`, `"dialogue"`, `«guillemets»`, `“curly quotes”` and dash-led dialogue (`— Hello!`).
- Keeps dialogue tags attached: `"Hello," he said.`
- Leaves code blocks, HTML, headings, lists and tables alone.
- Per-message button and `/dsplit [message id]` slash command.

**Install:** Extensions → Install extension → paste the repo URL.

## License
MIT
