(function () {
  'use strict';

  var titleQueue = new Map();
  var titleTimer = null;
  var observer = null;
  var blockSeq = 0;
  var titleSeq = 0;

  function rawExtensionConfig() {
    if (window.context && window.context.extensions && window.context.extensions.aiTranslator) {
      return window.context.extensions.aiTranslator;
    }
    if (typeof context !== 'undefined' && context && context.extensions && context.extensions.aiTranslator) {
      return context.extensions.aiTranslator;
    }
    return {};
  }

  function config() {
    var raw = rawExtensionConfig();
    return {
      titleEndpoint: raw.titleEndpoint || '?c=AITranslator&a=translateTitles',
      blocksEndpoint: raw.blocksEndpoint || '?c=AITranslator&a=translateBlocks',
      summaryEndpoint: raw.summaryEndpoint || '?c=AITranslator&a=summary',
      csrf: raw.csrf || (window.context && window.context.csrf) || (typeof context !== 'undefined' && context ? context.csrf : '') || '',
      autoTranslateTitles: raw.autoTranslateTitles !== false,
      autoTranslateContent: raw.autoTranslateContent !== false,
      displayMode: raw.displayMode || 'bilingual',
      titleBatchSize: Math.max(1, Math.min(30, Number(raw.titleBatchSize || 12)))
    };
  }

  function post(endpoint, fields) {
    var data = new URLSearchParams();
    Object.keys(fields).forEach(function (k) { data.set(k, fields[k]); });
    data.set('_csrf', config().csrf);
    data.set('ajax', '1');

    return fetch(endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: data.toString()
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok || !body || !body.ok) {
          throw new Error(body && body.error ? body.error : 'Request failed.');
        }
        return body;
      });
    });
  }

  function isMostlyChinese(text) {
    if (!text) return false;
    var cjk = (text.match(/[\u3400-\u9fff]/g) || []).length;
    var letters = (text.match(/[A-Za-z\u3400-\u9fff]/g) || []).length;
    return letters > 0 && cjk / letters >= 0.45;
  }

  function titleAnchors(flux) {
    if (!flux || !flux.querySelectorAll) return [];
    return Array.from(flux.querySelectorAll('.flux_header a.item-element.title, h1.title a.go_website'));
  }

  function extractOriginalTitle(anchor) {
    if (!anchor) return '';
    if (anchor.dataset.aitOriginalTitle) return anchor.dataset.aitOriginalTitle;

    var clone = anchor.cloneNode(true);
    clone.querySelectorAll('.author, .ait-cn-title, .ait-original-title, .ait-original-only-title').forEach(function (n) { n.remove(); });
    var text = clone.textContent.trim();
    anchor.dataset.aitOriginalTitle = text;
    return text;
  }

  function preserveAuthor(anchor) {
    var author = anchor.querySelector('.author');
    return author ? author.cloneNode(true) : null;
  }

  function renderTitle(anchor, chinese, original) {
    if (!anchor || !chinese) return;
    var author = preserveAuthor(anchor);
    var mode = config().displayMode;

    while (anchor.firstChild) anchor.removeChild(anchor.firstChild);
    anchor.classList.add('ait-title-ready');

    if (mode !== 'original') {
      var cn = document.createElement('span');
      cn.className = 'ait-cn-title';
      cn.textContent = chinese;
      anchor.appendChild(cn);
    }

    if (mode === 'bilingual') {
      var originalLine = document.createElement('span');
      originalLine.className = 'ait-original-title';
      originalLine.dataset.fullTitle = original;
      originalLine.title = original;
      originalLine.textContent = original;
      anchor.appendChild(originalLine);
    } else if (mode === 'original') {
      var raw = document.createElement('span');
      raw.className = 'ait-original-only-title';
      raw.textContent = original;
      anchor.appendChild(raw);
    }

    if (author) {
      anchor.appendChild(document.createTextNode(' '));
      anchor.appendChild(author);
    }
    anchor.dataset.aitTranslated = '1';
    anchor.dataset.aitQueued = '';
  }

  function queueAnchor(anchor) {
    if (!config().autoTranslateTitles || !anchor) return;
    if (anchor.dataset.aitQueued === '1' || anchor.dataset.aitTranslated === '1') return;

    var original = extractOriginalTitle(anchor);
    if (!original) return;

    if (isMostlyChinese(original)) {
      anchor.dataset.aitTranslated = '1';
      return;
    }

    var id = 'title-' + (++titleSeq);
    anchor.dataset.aitQueued = '1';
    titleQueue.set(id, { id: id, text: original, anchor: anchor });

    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(flushTitles, 80);
  }

  function queueFlux(flux) {
    titleAnchors(flux).forEach(queueAnchor);
  }

  function scanTitles(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('.flux')) queueFlux(root);
    root.querySelectorAll('.flux').forEach(queueFlux);

    if (root.matches && root.matches('.flux_header a.item-element.title, h1.title a.go_website')) {
      queueAnchor(root);
    }
    root.querySelectorAll('.flux_header a.item-element.title, h1.title a.go_website').forEach(queueAnchor);
  }

  function flushTitles() {
    titleTimer = null;
    if (titleQueue.size === 0) return;

    var selected = Array.from(titleQueue.values()).slice(0, config().titleBatchSize);
    selected.forEach(function (item) { titleQueue.delete(item.id); });
    var payload = selected.map(function (item) { return { id: item.id, text: item.text }; });

    post(config().titleEndpoint, { items_json: JSON.stringify(payload) })
      .then(function (body) {
        selected.forEach(function (item) {
          var translated = body.items && body.items[item.id];
          if (translated) renderTitle(item.anchor, translated, item.text);
          else item.anchor.dataset.aitQueued = '';
        });
      })
      .catch(function (err) {
        console.error('[AI Translator] title translation:', err);
        selected.forEach(function (item) { item.anchor.dataset.aitQueued = ''; });
      })
      .finally(function () {
        if (titleQueue.size > 0) titleTimer = setTimeout(flushTitles, 80);
      });
  }

  function articleTextContainer(flux) {
    return flux && flux.querySelector ? flux.querySelector('.flux_content .text, .content .text') : null;
  }

  function button(label, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = label;
    return b;
  }

  function ensureToolbar(flux) {
    if (!flux || flux.querySelector('.ait-toolbar')) return;
    var text = articleTextContainer(flux);
    if (!text) return;

    var toolbar = document.createElement('div');
    toolbar.className = 'ait-toolbar';

    var translate = button('重新翻译', 'ait-translate');
    var summary = button('AI 摘要', 'ait-summary');
    var mode = document.createElement('div');
    mode.className = 'ait-mode-switch';

    [['zh', '中文'], ['bilingual', '双语'], ['original', '原文']].forEach(function (pair) {
      var b = button(pair[1], 'ait-mode-btn');
      b.dataset.mode = pair[0];
      if (config().displayMode === pair[0]) b.classList.add('active');
      mode.appendChild(b);
    });

    var status = document.createElement('span');
    status.className = 'ait-status';

    toolbar.appendChild(translate);
    toolbar.appendChild(summary);
    toolbar.appendChild(mode);
    toolbar.appendChild(status);
    text.parentNode.insertBefore(toolbar, text);
    applyReadingMode(flux, config().displayMode);
  }

  function collectBlocks(container) {
    var selectors = 'p, h1, h2, h3, h4, h5, h6, li, blockquote';
    var blocks = [];
    container.querySelectorAll(selectors).forEach(function (el) {
      if (el.closest('pre, code, .ait-translation, .ait-summary-panel')) return;
      if (el.querySelector(selectors)) return;
      var text = el.textContent.trim();
      if (!text || isMostlyChinese(text)) return;
      if (!el.dataset.aitBlockId) el.dataset.aitBlockId = 'b' + (++blockSeq);
      blocks.push({ id: el.dataset.aitBlockId, text: text, element: el });
    });
    return blocks;
  }

  function hasTranslationFor(element) {
    if (!element || !element.dataset.aitBlockId || !element.parentNode) return false;
    var id = element.dataset.aitBlockId;
    return Array.from(element.parentNode.children).some(function (child) {
      return child.classList && child.classList.contains('ait-translation') && child.dataset.for === id;
    });
  }

  function translateArticle(flux, force) {
    var container = articleTextContainer(flux);
    if (!container || flux.dataset.aitTranslating === '1') return;

    ensureToolbar(flux);
    var status = flux.querySelector('.ait-status');
    var blocks = collectBlocks(container).filter(function (x) { return force || !hasTranslationFor(x.element); });

    if (blocks.length === 0) {
      flux.dataset.aitContentDone = '1';
      setStatus(status, '双语内容已就绪');
      applyReadingMode(flux, config().displayMode);
      return;
    }

    flux.dataset.aitTranslating = '1';
    setStatus(status, '正在自动翻译正文…');

    if (force) {
      container.querySelectorAll('.ait-translation').forEach(function (n) { n.remove(); });
      container.querySelectorAll('.ait-original-block').forEach(function (n) { n.classList.remove('ait-original-block'); });
    }

    var batches = [];
    for (var i = 0; i < blocks.length; i += 8) batches.push(blocks.slice(i, i + 8));

    var chain = Promise.resolve();
    batches.forEach(function (batch) {
      chain = chain.then(function () {
        return post(config().blocksEndpoint, {
          items_json: JSON.stringify(batch.map(function (x) { return { id: x.id, text: x.text }; }))
        }).then(function (body) {
          batch.forEach(function (item) {
            var translated = body.items && body.items[item.id];
            if (!translated || !item.element.parentNode) return;
            item.element.classList.add('ait-original-block');
            var div = document.createElement('div');
            div.className = 'ait-translation';
            div.dataset.for = item.id;
            div.textContent = translated;
            item.element.parentNode.insertBefore(div, item.element);
          });
        });
      });
    });

    chain.then(function () {
      flux.dataset.aitContentDone = '1';
      setStatus(status, '双语翻译完成');
      applyReadingMode(flux, config().displayMode);
    }).catch(function (err) {
      console.error('[AI Translator] article translation:', err);
      setStatus(status, err.message || '翻译失败', true);
    }).finally(function () {
      flux.dataset.aitTranslating = '';
    });
  }

  function maybeAutoTranslateArticle(flux) {
    if (!flux || !config().autoTranslateContent) return;
    var container = articleTextContainer(flux);
    if (!container || flux.dataset.aitContentDone === '1' || flux.dataset.aitTranslating === '1') return;

    // FreshRSS marks the opened item active. In reader mode the content may be visible without that class.
    var visible = flux.classList.contains('active') || (container.offsetParent !== null && container.getBoundingClientRect().height > 0);
    if (!visible) return;
    translateArticle(flux, false);
  }

  function summarizeArticle(flux) {
    var container = articleTextContainer(flux);
    var status = flux.querySelector('.ait-status');
    if (!container) return;
    var text = container.textContent.trim();
    if (!text) return;
    setStatus(status, '摘要生成中…');

    post(config().summaryEndpoint, { text: text })
      .then(function (body) {
        var panel = flux.querySelector('.ait-summary-panel');
        if (!panel) {
          panel = document.createElement('div');
          panel.className = 'ait-summary-panel';
          container.parentNode.insertBefore(panel, container);
        }
        panel.textContent = body.summary || '';
        setStatus(status, '摘要已生成');
      })
      .catch(function (err) { setStatus(status, err.message || '摘要失败', true); });
  }

  function setStatus(el, message, error) {
    if (!el) return;
    el.textContent = message || '';
    el.dataset.error = error ? '1' : '';
  }

  function applyReadingMode(flux, mode) {
    flux.dataset.aitReadingMode = mode;
    flux.querySelectorAll('.ait-mode-btn').forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
  }

  function setupFlux(flux) {
    if (!flux) return;
    queueFlux(flux);
    ensureToolbar(flux);
    maybeAutoTranslateArticle(flux);
  }

  function setupAround(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.matches && node.matches('.flux')) setupFlux(node);
    var parentFlux = node.closest ? node.closest('.flux') : null;
    if (parentFlux) setupFlux(parentFlux);
    if (node.querySelectorAll) node.querySelectorAll('.flux').forEach(setupFlux);
    scanTitles(node);
  }

  function handleClick(event) {
    var originalTitle = event.target.closest('.ait-original-title');
    if (originalTitle) {
      if (window.matchMedia('(hover: none)').matches) {
        event.preventDefault();
        event.stopPropagation();
        originalTitle.classList.toggle('expanded');
      }
      return;
    }

    var flux = event.target.closest('.flux');
    if (!flux) return;
    if (event.target.closest('.ait-translate')) {
      translateArticle(flux, true);
      return;
    }
    if (event.target.closest('.ait-summary')) {
      summarizeArticle(flux);
      return;
    }
    var mode = event.target.closest('.ait-mode-btn');
    if (mode) applyReadingMode(flux, mode.dataset.mode);
  }

  function bind() {
    document.querySelectorAll('.flux').forEach(setupFlux);
    scanTitles(document);
    document.body.addEventListener('click', handleClick);

    var stream = document.getElementById('stream') || document.getElementById('global') || document.body;
    observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.type === 'attributes' && m.target && m.target.classList && m.target.classList.contains('flux')) {
          setupFlux(m.target);
          return;
        }
        m.addedNodes.forEach(setupAround);
      });
    });
    observer.observe(stream, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  document.addEventListener('freshrss:globalContextLoaded', function () {
    document.querySelectorAll('.flux').forEach(setupFlux);
    scanTitles(document);
  });
})();
