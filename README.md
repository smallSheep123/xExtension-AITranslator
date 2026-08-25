# FreshRSS AI Translator

A FreshRSS user extension for an AI-assisted bilingual reading workflow.

## v0.1.0

- Automatically translates **titles currently loaded in the FreshRSS stream**
- Works with **infinite scrolling** and when switching feeds/categories
- Uses a persistent **per-user server cache**:
  - cached titles return immediately
  - changed titles naturally get a new cache key and are translated again
- Default title UI: **Chinese main title + smaller original title**
- Original titles are clamped to two lines
  - desktop: hover for the full original title
  - touch devices: tap the original subtitle to expand/collapse
- Article body: on-demand **Chinese + original paragraph-level bilingual mode**
- Reading modes: **中文 / 双语 / 原文**
- AI summary button
- Separate model fields for title, article translation, and summary
- OpenAI-compatible `/chat/completions` APIs
- API key stays on the FreshRSS server and is not exposed through JS vars
- API Base URL must use HTTPS
- AI output is inserted with `textContent`, not trusted as HTML

## Installation

```bash
cd /opt/homelab/freshrss/extensions
sudo git clone https://github.com/smallSheep123/xExtension-AITranslator.git
```

If FreshRSS runs in Docker and that host directory is mounted to `/var/www/FreshRSS/extensions`, restart the container and enable the extension from `Settings -> Extensions`.

## API settings

Example:

- API base URL: `https://api.example.com/v1`
- API key: a dedicated, low-limit key is recommended
- Title model: a cheap fast model is usually sufficient
- Content model: a stronger model can be used for technical text
- Summary model: choose according to cost/quality

The extension sends `POST {API base URL}/chat/completions` with the usual OpenAI-compatible `model` + `messages` structure.

## Design notes

FreshRSS currently renders normal stream titles inside:

```css
.flux_header a.item-element.title
```

The extension observes newly inserted `.flux` elements so infinite scrolling does not need a separate “translate current page” action.

It does **not** translate every historical article in the database. It only translates what appears in the current reading flow and caches results.

## Cache

A bounded per-user JSON cache is stored as `users/<username>/ai-translator-cache.json`.

Cache keys include the original text, model, and prompt. Changing the original title, model, or prompt naturally triggers a new translation.

## License

AGPL-3.0-or-later.
