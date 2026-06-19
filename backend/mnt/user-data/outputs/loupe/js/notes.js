// notes.js — Notes scanner  (calls Loupe backend → no API key in browser)

(function () {
  // ── config ─────────────────────────────────────────────────
  // Change this to your deployed backend URL before going live
  const API_BASE = (window.LOUPE_API_BASE || 'http://localhost:3001').replace(/\/$/, '');

  let currentStyle    = 'structured';
  let currentMarkdown = '';
  let history         = []; // { url, markdown, meta }
  let useStreaming     = true; // flip to false if your host doesn't support SSE

  // ── DOM refs ─────────────────────────────────────────────────
  const uploadZone     = document.getElementById('upload-zone');
  const notesLayout    = document.getElementById('notes-layout');
  const scanImg        = document.getElementById('scan-img');
  const scanLine       = document.getElementById('scan-line');
  const docPlaceholder = document.getElementById('doc-placeholder');
  const docContent     = document.getElementById('doc-content');
  const docOutput      = document.getElementById('doc-output');
  const exportStrip    = document.getElementById('export-strip');
  const wordCountEl    = document.getElementById('word-count');
  const docMeta        = document.getElementById('doc-meta');
  const historyStrip   = document.getElementById('history-strip');
  const scanAgainBtn   = document.getElementById('scan-again-btn');

  // ── style selector ────────────────────────────────────────────
  window.setStyle = function (btn) {
    currentStyle = btn.dataset.style;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('is-active'));
    btn.classList.add('is-active');
  };

  // ── drag & drop ───────────────────────────────────────────────
  window.handleNoteDragOver = function (e) {
    e.preventDefault();
    uploadZone.classList.add('is-dragover');
  };
  window.handleNoteDragLeave = function () {
    uploadZone.classList.remove('is-dragover');
  };
  window.handleNoteDrop = function (e) {
    e.preventDefault();
    uploadZone.classList.remove('is-dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleNoteFile(file);
  };

  window.handleNoteFile = function (file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    loadAndScan(file, url);
  };

  // ── main flow ─────────────────────────────────────────────────
  async function loadAndScan(file, url) {
    uploadZone.style.display   = 'none';
    notesLayout.style.display  = '';
    scanAgainBtn.style.display = '';

    scanImg.src = url;

    // reset doc panel
    docPlaceholder.style.display = '';
    docContent.style.display     = 'none';
    docContent.innerHTML         = '';
    exportStrip.style.display    = 'none';
    wordCountEl.classList.remove('is-visible');
    docOutput.classList.add('is-loading');
    scanLine.classList.add('is-active');

    try {
      if (useStreaming) {
        await scanStreaming(file);
      } else {
        await scanBatch(file);
      }
    } catch (err) {
      scanLine.classList.remove('is-active');
      docOutput.classList.remove('is-loading');
      docContent.innerHTML = `
        <p style="color:var(--loupe-red);font-family:var(--font-mono);font-size:0.85rem">
          ${err.message || 'Something went wrong. Check the backend is running.'}
        </p>`;
      docContent.style.display  = 'block';
      docPlaceholder.style.display = 'none';
    }
  }

  // ── non-streaming path ─────────────────────────────────────────
  async function scanBatch(file) {
    const form = new FormData();
    form.append('image', file);
    form.append('style',  currentStyle);

    const res = await fetch(`${API_BASE}/api/notes/scan`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

    finishScan(data.markdown, data.word_count, data.title, data.processing_ms);
    addHistory(URL.createObjectURL(file), data.markdown, data.word_count);
  }

  // ── streaming path (SSE) ───────────────────────────────────────
  async function scanStreaming(file) {
    const form = new FormData();
    form.append('image', file);
    form.append('style',  currentStyle);

    const res = await fetch(`${API_BASE}/api/notes/scan-stream`, { method: 'POST', body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server error ${res.status}`);
    }

    // show the doc panel early so tokens appear live
    docPlaceholder.style.display = 'none';
    docContent.innerHTML         = '<span class="typing-cursor"></span>';
    docContent.style.display     = 'block';

    let accumulated = '';
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        try {
          const ev = JSON.parse(line.slice(5).trim());
          if (ev.token) {
            accumulated += ev.token;
            // re-render incrementally as markdown
            docContent.innerHTML = mdToHtml(accumulated) + '<span class="typing-cursor"></span>';
          }
          if (ev.markdown !== undefined) {
            // 'done' event
            scanLine.classList.remove('is-active');
            docOutput.classList.remove('is-loading');
            finishScan(ev.markdown, ev.word_count, ev.title, null);
            addHistory(URL.createObjectURL(file), ev.markdown, ev.word_count);
          }
          if (ev.message) {
            throw new Error(ev.message);
          }
        } catch (parseErr) {
          if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
        }
      }
    }
  }

  // ── finalize render ────────────────────────────────────────────
  function finishScan(markdown, wordCount, title, ms) {
    currentMarkdown = markdown;

    scanLine.classList.remove('is-active');
    docOutput.classList.remove('is-loading');

    docContent.innerHTML         = mdToHtml(markdown);
    docContent.style.display     = 'block';
    docPlaceholder.style.display = 'none';

    wordCountEl.textContent = `${wordCount} words`;
    wordCountEl.classList.add('is-visible');

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    docMeta.textContent = ms
      ? `Scanned ${timeStr} · ${wordCount} words · ${ms}ms`
      : `Scanned ${timeStr} · ${wordCount} words`;

    exportStrip.style.display = '';
  }

  // ── history ────────────────────────────────────────────────────
  function addHistory(url, markdown, wordCount) {
    history.unshift({ url, markdown, meta: docMeta.textContent });
    if (history.length > 8) history.pop();
    renderHistory();
  }

  function renderHistory() {
    if (!history.length) return;
    historyStrip.innerHTML = history.map((h, i) => `
      <img class="history-thumb ${i === 0 ? 'is-active' : ''}"
           src="${h.url}" alt="Scan ${i + 1}"
           title="${h.meta}"
           onclick="loadFromHistory(${i})" />`).join('');
  }

  window.loadFromHistory = function (i) {
    const h = history[i];
    scanImg.src         = h.url;
    currentMarkdown     = h.markdown;
    docContent.innerHTML = mdToHtml(h.markdown);
    docContent.style.display  = 'block';
    docPlaceholder.style.display = 'none';
    exportStrip.style.display = '';
    docMeta.textContent       = h.meta;
    const wc = h.markdown.split(/\s+/).filter(Boolean).length;
    wordCountEl.textContent = `${wc} words`;
    wordCountEl.classList.add('is-visible');
    document.querySelectorAll('.history-thumb').forEach((el, j) => {
      el.classList.toggle('is-active', j === i);
    });
  };

  // ── reset ──────────────────────────────────────────────────────
  window.resetNotes = function () {
    uploadZone.style.display   = '';
    notesLayout.style.display  = 'none';
    scanAgainBtn.style.display = 'none';
    currentMarkdown = '';
  };

  // ── exports ────────────────────────────────────────────────────
  window.copyDoc = function () {
    if (!currentMarkdown) return;
    navigator.clipboard.writeText(currentMarkdown).then(() => {
      docMeta.textContent = '✓ Copied to clipboard';
      setTimeout(() => { if (docMeta) docMeta.textContent = 'Ready'; }, 2000);
    });
  };

  window.downloadMd = function () {
    if (!currentMarkdown) return;
    const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `loupe-notes-${Date.now()}.md`;
    a.click();
  };

  window.shareDoc = async function () {
    if (!currentMarkdown) return;
    if (navigator.share) {
      try { await navigator.share({ title: 'Scanned notes — Loupe', text: currentMarkdown }); return; }
      catch (_) { /* fall through */ }
    }
    copyDoc();
  };

  // ── markdown → html (no deps) ──────────────────────────────────
  function mdToHtml(md) {
    return md
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,     '<em>$1</em>')
      .replace(/`(.+?)`/g,       '<code>$1</code>')
      .split('\n\n')
      .map(block => {
        block = block.trim();
        if (!block) return '';
        if (/^<h[1-6]>/.test(block)) return block;
        if (/^- /.test(block)) {
          const items = block.split('\n').filter(l => l.startsWith('- '))
            .map(l => `<li>${l.slice(2)}</li>`).join('');
          return `<ul>${items}</ul>`;
        }
        if (/^\d+\. /.test(block)) {
          const items = block.split('\n').filter(l => /^\d+\. /.test(l))
            .map(l => `<li>${l.replace(/^\d+\. /, '')}</li>`).join('');
          return `<ol>${items}</ol>`;
        }
        return `<p>${block.replace(/\n/g, ' ')}</p>`;
      })
      .filter(Boolean)
      .join('\n');
  }

})();
