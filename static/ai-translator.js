(function () {
  'use strict';

  var titleQueue = new Map();
  var titleTimer = null;
  var observer = null;
  var blockSeq = 0;

  function config() {
    var candidates = [
      window.extensions && window.extensions.aiTranslator,
      window.context && window.context.aiTranslator,
      window.context && window.context.extensions && window.context.extensions.aiTranslator
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      if (candidates[i] && typeof candidates[i] === 'object') return candidates[i];
    }
    return {};
  }

  function csrf() {
    var c = config();
    return c.csrf || (window.context && window.context.csrf) || '';
  }

  function post(endpoint, fields) {
    var data = new URLSearchParams();
    Object.keys(fields).forEach(function (k) { data.set(k, fields[k]); });
    data.set('_csrf', csrf());
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

  function titleAnchor(flux) {
    if (!flux || !flux.querySelector) return null;
    return flux.querySelector('.flux_header a.item-element.title, h1.title a.go_website');
  }

  function extractOriginalTitle(anchor) {
    if (!anchor) return '';
    if (anchor.dataset.aitOriginalTitle) return anchor.dataset.aitOriginalTitle;

    var clone = anchor.cloneNode(true);
    clone.querySelectorAll('.author, .ait-cn-title, .ait-original-title').forEach(function (n) { n.remove(); });
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
    var mode = config().displayMode || 'bilingual';

    while (anchor.firstChild) anchor.removeChild(anchor.firstChild);

    if (mode !== 'original') {
      var cn = document.createElement('span');
      cn.className = 'ait-cn-title';
      cn.textContent = chinese;
      anchor.appendChild(cn);
    }

    if (mode === 'bilingual') {
      var en = document.createElement('span');
      en.className = 'ait-original-title';
      en.dataset.fullTitle = original;
      en.title = original;
      en.textContent = original;
      anchor.appendChild(en);
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
  }

  function queueFlux(flux) {
    if (!config().autoTranslateTitles) return;
    var anchor = titleAnchor(flux);
    if (!anchor || anchor.dataset.aitQueued === '1' || anchor.dataset.aitTranslated === '1') return;

    var original = extractOriginalTitle(anchor);
    if (!original) return;

    if (isMostlyChinese(original)) {
      anchor.dataset.aitTranslated = '1';
      return;
    }

    var id = flux.getAttribute('data-entry') || flux.dataset.entry || flux.id || ('dom-' + Math.random().toString(36).slice(2));
    anchor.dataset.aitQueued = '1';
    titleQueue.set(id, { id: id, text: original, anchor: anchor });

    if (titleTimer) clearTimeout(titleTimer);
    titleTimer = setTimeout(flushTitles, 120);
  }

  function scanTitles(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('.flux')) queueFlux(root);
    root.querySelectorAll('.flux').forEach(queueFlux);
  }

  function flushTitles() {
    titleTimer = null;
    if (titleQueue.size === 0) return;

    var batchSize = Math.max(1, Math.min(30, Number(config().titleBatchSize || 12)));
    var selected = Array.from(titleQueue.values()).slice(0, batchSize);
    selected.forEach(function (item) { titleQueue.delete(item.id); });

    var payload = selected.map(function (item) { return { id: item.id, text: item.text }; });

    post(config().titleEndpoint || '?c=AITranslator&a=translateTitles', {
      items_json: JSON.stringify(payload)
    }).then(function (body) {
      selected.forEach(function (item) {
        var translated = body.items && body.items[item.id];
        if (translated) {
          renderTitle(item.anchor, translated, item.text);
        } else {
          item.anchor.dataset.aitQueued = '';
        }
      });
    }).catch(function () {
      selected.forEach(function (item) { item.anchor.dataset.aitQueued = ''; });
    }).finally(function () {
      if (titleQueue.size > 0) titleTimer = setTimeout(flushTitles, 100);
    });
  }

  function articleTextContainer(flux) {
    return flux && flux.querySelector ? flux.querySelector('.flux_content .text, .content .text') : null;
  }

  function ensureToolbar(flux) {
    if (!flux || flux.querySelector('.ait-toolbar')) return;
    var text = articleTextContainer(flux);
    if (!text) return;

    var toolbar = document.createElement('div');
    toolbar.className = 'ait-toolbar';

    var translate = button('AI 双语翻译', 'ait-translate');
    var summary = button('AI 摘要', 'ait-summary');
    var mode = document.createElement('div');
    mode.className = 'ait-mode-switch';

    [['zh', '中文'], ['bilingual', '双语'], ['original', '原文']].forEach(function (pair) {
      var b = button(pair[1], 'ait-mode-btn');
      b.dataset.mode = pair[0];
      if ((config().displayMode || 'bilingual') === pair[0]) b.classList.add('active');
      mode.appendChild(b);
    });

    var status = document.createElement('span');
    status.className = 'ait-status';

    toolbar.appendChild(translate);
    toolbar.appendChild(summary);
    toolbar.appendChild(mode);
    toolbar.appendChild(status);
    text.parentNode.insertBefore(toolbar, text);

    applyReadingMode(flux, config().displayMode || 'bilingual');
  }

  function button(label, cls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ' + cls;
    b.textContent = label;
    return b;
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

  function translateArticle(flux) {
    var container = articleTextContainer(flux);
    var status = flux.querySelector('.ait-status');
    if (!container) return;

    var blocks = collectBlocks(container).filter(function (x) {
      return !x.element.parentNode.querySelector(':scope > .ait-translation[data-for="' + x.id + '"]');
    });

    if (blocks.length === 0) {
      setStatus(status, '已无需要翻译的新段落');
      applyReadingMode(flux, 'bilingual');
      return;
    }

    setStatus(status, '翻译中…');
    var batches = [];
    for (var i = 0; i < blocks.length; i += 8) batches.push(blocks.slice(i, i + 8));

    var chain = Promise.resolve();
    batches.forEach(function (batch) {
      chain = chain.then(function () {
        return post(config().blocksEndpoint || '?c=AITranslator&a=translateBlocks', {
          items_json: JSON.stringify(batch.map(function (x) { return { id: x.id, text: x.text }; }))
        }).then(function (body) {
          batch.forEach(function (item) {
            var translated = body.items && body.items[item.id];
            if (!translated) return;

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
      setStatus(status, '双语翻译完成');
      applyReadingMode(flux, 'bilingual');
    }).catch(function (err) {
      setStatus(status, err.message || '翻译失败', true);
    });
  }

  function summarizeArticle(flux) {
    var container = articleTextContainer(flux);
    var status = flux.querySelector('.ait-status');
    if (!container) return;

    var text = container.textContent.trim();
    if (!text) return;
    setStatus(status, '摘要生成中…');

    post(config().summaryEndpoint || '?c=AITranslator&a=summary', { text: text })
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
      .catch(function (err) {
        setStatus(status, err.message || '摘要失败', true);
      });
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
      translateArticle(flux);
      return;
    }
    if (event.target.closest('.ait-summary')) {
      summarizeArticle(flux);
      return;
    }
    var mode = event.target.closest('.ait-mode-btn');
    if (mode) {
      applyReadingMode(flux, mode.dataset.mode);
    }
  }

  function bind() {
    scanTitles(document);
    document.querySelectorAll('.flux').forEach(ensureToolbar);
    document.body.addEventListener('click', handleClick);

    var stream = document.getElementById('stream') || document.getElementById('global') || document.body;
    observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (!node || node.nodeType !== 1) return;
          scanTitles(node);
          if (node.matches && node.matches('.flux')) ensureToolbar(node);
          if (node.querySelectorAll) node.querySelectorAll('.flux').forEach(ensureToolbar);
        });
      });
    });
    observer.observe(stream, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
  document.addEventListener('freshrss:globalContextLoaded', function () {
    scanTitles(document);
    document.querySelectorAll('.flux').forEach(ensureToolbar);
  });
})();