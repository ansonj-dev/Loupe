// js/notes.js — Notes scanner  (calls Loupe backend → Gemini vision, no API key in browser)

(function () {
  // ── config ─────────────────────────────────────────────────
  const API_BASE = (window.LOUPE_API_BASE || 'http://localhost:3001').replace(/\/$/, '');

  let currentStyle    = 'structured';
  let currentMarkdown = '';
  let history         = []; // { url, markdown, meta }
  let useStreaming     = true;
  let notesAgent = null; // AI Agent instance

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

  // AI Agent DOM refs
  const agentStatusDot = document.getElementById('agent-status-dot');
  const agentStatusText = document.getElementById('agent-status-text');
  const agentActivateBtn = document.getElementById('agent-activate-btn');
  const agentRestoreBtn = document.getElementById('agent-restore-btn');
  const agentDeactivateBtn = document.getElementById('agent-deactivate-btn');
  const agentClearHistoryBtn = document.getElementById('agent-clear-history-btn');
  const agentInfo = document.getElementById('agent-info');
  const agentInfoText = document.getElementById('agent-info-text');

  // ══════════════════════════════════════════════════════════════
  // AI NOTES AGENT (Desktop + Mobile)
  // ══════════════════════════════════════════════════════════════

  window.activateNotesAgent = async function() {
    if (!window.DirectoryAgent && !window.MobileAgent) {
      alert('Agent library not loaded');
      return;
    }

    // Check if mobile
    const isMobile = window.MobileAgent && window.MobileAgent.isMobile();

    if (isMobile) {
      // Mobile mode
      try {
        notesAgent = new window.MobileAgent({
          id: 'notes-agent-mobile',
          fileTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
        });

        notesAgent.on('fileAdded', async (data) => {
          console.log('📝 New note detected (mobile):', data.name);
          updateAgentStatus('scanning', `Processing: ${data.name}`);
          await handleNoteFile(data.file);
          updateAgentStatus('watching', `Mobile Agent: Ready`);
        });

        notesAgent.on('statusChange', (data) => {
          console.log('Mobile agent status:', data);
          if (data.status === 'activated_mobile') {
            updateAgentStatus('watching', `Mobile Agent: ${data.mode === 'camera' ? 'Camera Ready' : 'Ready'}`);
          }
        });

        // Show mobile options
        showMobileNotesOptions();

      } catch (err) {
        console.error('Failed to activate mobile agent:', err);
        updateAgentStatus('inactive', 'AI Agent: Failed to activate');
        alert('Failed to activate mobile agent: ' + err.message);
      }
    } else {
      // Desktop mode
      if (!window.DirectoryAgent.isSupported()) {
        alert('Automatic folder watching is not supported in this browser. Please use Chrome, Edge, or Opera on desktop.');
        return;
      }

      try {
        notesAgent = new window.DirectoryAgent({
          id: 'notes-agent',
          pollInterval: 5000,
          fileTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
        });

        // Set up event listeners
        notesAgent.on('fileAdded', async (data) => {
          console.log('📝 New note detected:', data.name);
          updateAgentStatus('scanning', `Processing: ${data.name}`);
          await handleNoteFile(data.file);
          
          const statsMsg = data.stats 
            ? `Watching: ${data.path} (${data.stats.totalProcessed} processed, ${data.stats.skippedFiles} skipped)`
            : `Watching: ${data.path}`;
          updateAgentStatus('watching', statsMsg);
        });

        notesAgent.on('scanComplete', (data) => {
          console.log('📊 Scan complete:', data);
          if (data.newFiles > 0) {
            console.log(`✓ Found ${data.newFiles} new files, skipped ${data.skippedFiles} already processed`);
          }
        });

        notesAgent.on('statusChange', (data) => {
          console.log('Agent status:', data);
          if (data.status === 'activated' || data.status === 'restored' || data.status === 'watching') {
            const statsMsg = data.processedCount > 0 
              ? `Watching: ${data.path} (${data.processedCount} files already processed)`
              : `Watching: ${data.path}`;
            updateAgentStatus('watching', statsMsg);
          } else if (data.status === 'history_cleared') {
            updateAgentStatus('watching', `History cleared for ${data.path}. All files will be re-scanned.`);
            agentInfoText.textContent = `✓ History cleared. The agent will now process all files in the folder.`;
          }
        });

        notesAgent.on('error', (data) => {
          console.error('Agent error:', data.message);
          updateAgentStatus('inactive', 'AI Agent: Error - ' + data.message);
        });

        // Activate
        const result = await notesAgent.activate();
        if (result.success) {
          const statsMsg = result.processedCount > 0
            ? `Watching: ${result.path} (${result.processedCount} files already processed)`
            : `Watching: ${result.path}`;
          updateAgentStatus('watching', statsMsg);
          agentActivateBtn.style.display = 'none';
          agentRestoreBtn.style.display = 'none';
          agentDeactivateBtn.style.display = '';
          agentClearHistoryBtn.style.display = '';
          agentInfo.style.display = '';
          
          const infoMsg = result.processedCount > 0
            ? `✓ Agent is monitoring your notes folder. ${result.processedCount} files already processed will be skipped.`
            : `✓ Agent is monitoring your notes folder. New note images will be automatically scanned.`;
          agentInfoText.textContent = infoMsg;

          if (typeof pendo !== 'undefined') {
            pendo.track('notes_agent_activated', {
              platform: 'desktop',
              folderPath: result.path,
              previouslyProcessedCount: result.processedCount
            });
          }
        }
      } catch (err) {
        console.error('Failed to activate agent:', err);
        updateAgentStatus('inactive', 'AI Agent: Failed to activate');
        if (err.name === 'AbortError') {
          return;
        }
        alert('Failed to activate agent: ' + err.message);
      }
    }
  };

  function showMobileNotesOptions() {
    // Update UI to show mobile-specific options
    agentActivateBtn.style.display = 'none';
    agentRestoreBtn.style.display = 'none';
    agentDeactivateBtn.style.display = '';
    agentInfo.style.display = '';
    agentInfoText.innerHTML = `
      <p style="margin-bottom: var(--space-2);">📱 Mobile Agent Active - Choose upload method:</p>
      <div style="display: flex; flex-direction: column; gap: var(--space-2);">
        <input type="file" id="mobile-notes-folder-input" webkitdirectory directory multiple accept="image/*" style="display: none;" onchange="if(this.files[0]) handleNoteFile(this.files[0])" />
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('mobile-notes-folder-input').click()">
          📁 Select Folder
        </button>
        <input type="file" id="mobile-notes-camera-input" capture="environment" accept="image/*" style="display: none;" onchange="if(this.files[0]) handleNoteFile(this.files[0])" />
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('mobile-notes-camera-input').click()">
          📸 Take Photo of Notes
        </button>
        <input type="file" id="mobile-notes-multi-input" accept="image/*" style="display: none;" onchange="if(this.files[0]) handleNoteFile(this.files[0])" />
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('mobile-notes-multi-input').click()">
          🖼️ Select Image
        </button>
      </div>
    `;

    // Set up the mobile agent with the inputs
    const folderInput = document.getElementById('mobile-notes-folder-input');
    const cameraInput = document.getElementById('mobile-notes-camera-input');

    if (notesAgent && folderInput) {
      notesAgent.activateWithFolderPicker(folderInput);
    }
    if (notesAgent && cameraInput) {
      notesAgent.activateWithCamera(cameraInput);
    }

    updateAgentStatus('watching', 'Mobile Agent: Ready');
  }

  window.restoreNotesAgent = async function() {
    if (!notesAgent) return;
    
    const savedData = await notesAgent.storage.getDirectory('notes-agent');
    if (savedData && savedData.handle) {
      updateAgentStatus('inactive', 'Requesting permission...');
      const result = await notesAgent.requestPermission(savedData.handle);
      if (result.success) {
        agentActivateBtn.style.display = 'none';
        agentRestoreBtn.style.display = 'none';
        agentDeactivateBtn.style.display = '';
        agentClearHistoryBtn.style.display = '';
        agentInfo.style.display = '';
        
        const processedCount = notesAgent.scanStats.totalProcessed;
        const infoMsg = processedCount > 0
          ? `✓ Agent restored. Monitoring folder. ${processedCount} files already processed will be skipped.`
          : `✓ Agent restored. Monitoring folder for new notes.`;
        agentInfoText.textContent = infoMsg;
      } else {
        updateAgentStatus('inactive', 'Permission denied');
      }
    }
  };

  window.deactivateNotesAgent = async function() {
    if (!notesAgent) return;
    
    await notesAgent.deactivate();
    notesAgent = null;

    if (typeof pendo !== 'undefined') {
      pendo.track('notes_agent_deactivated', {
        platform: (window.MobileAgent && window.MobileAgent.isMobile()) ? 'mobile' : 'desktop'
      });
    }
    
    updateAgentStatus('inactive', 'AI Agent: Inactive');
    agentActivateBtn.style.display = '';
    agentRestoreBtn.style.display = 'none';
    agentDeactivateBtn.style.display = 'none';
    agentClearHistoryBtn.style.display = 'none';
    agentInfo.style.display = 'none';
  };

  window.clearNotesAgentHistory = async function() {
    if (!notesAgent || !notesAgent.folderPath) {
      alert('No active folder to clear history for');
      return;
    }

    if (!confirm(`Clear processing history for "${notesAgent.folderPath}"?\n\nThis will allow the agent to re-scan all files in this folder.`)) {
      return;
    }

    try {
      await notesAgent.clearHistory();
      alert(`History cleared for "${notesAgent.folderPath}". All files will be re-scanned on next check.`);
    } catch (err) {
      alert('Failed to clear history: ' + err.message);
    }
  };

  function updateAgentStatus(status, text) {
    agentStatusText.textContent = text || 'AI Agent: Inactive';
    agentStatusDot.className = 'agent-status-dot';
    
    if (status === 'watching') {
      agentStatusDot.classList.add('is-active');
    } else if (status === 'scanning') {
      agentStatusDot.classList.add('is-scanning');
    }
  }

  // Try to restore agent on page load
  (async function initAgent() {
    const isMobile = window.MobileAgent && window.MobileAgent.isMobile();
    
    if (isMobile) {
      // Mobile: Always show activate button, no restore needed
      updateAgentStatus('inactive', 'AI Agent: Tap to activate');
      agentActivateBtn.textContent = '📱 Activate Mobile Agent';
      return;
    }

    if (!window.DirectoryAgent || !window.DirectoryAgent.isSupported()) {
      return;
    }

    notesAgent = new window.DirectoryAgent({
      id: 'notes-agent',
      pollInterval: 5000
    });

    notesAgent.on('fileAdded', async (data) => {
      console.log('📝 New note detected:', data.name);
      updateAgentStatus('scanning', `Processing: ${data.name}`);
      await handleNoteFile(data.file);
      
      const statsMsg = data.stats 
        ? `Watching: ${data.path} (${data.stats.totalProcessed} processed, ${data.stats.skippedFiles} skipped)`
        : `Watching: ${data.path}`;
      updateAgentStatus('watching', statsMsg);
    });

    notesAgent.on('statusChange', (data) => {
      if (data.status === 'watching' || data.status === 'restored') {
        const statsMsg = data.processedCount > 0
          ? `Watching: ${data.path} (${data.processedCount} already processed)`
          : `Watching: ${data.path}`;
        updateAgentStatus('watching', statsMsg);
      }
    });

    const restoreResult = await notesAgent.restore();
    if (restoreResult.success) {
      agentActivateBtn.style.display = 'none';
      agentRestoreBtn.style.display = 'none';
      agentDeactivateBtn.style.display = '';
      agentClearHistoryBtn.style.display = '';
      agentInfo.style.display = '';
      
      const infoMsg = restoreResult.processedCount > 0
        ? `✓ Agent restored from previous session. ${restoreResult.processedCount} files already processed will be skipped.`
        : `✓ Agent restored from previous session. Monitoring folder.`;
      agentInfoText.textContent = infoMsg;
    } else if (restoreResult.reason === 'permission_required') {
      agentActivateBtn.style.display = 'none';
      agentRestoreBtn.style.display = '';
      agentDeactivateBtn.style.display = 'none';
      agentClearHistoryBtn.style.display = 'none';
      updateAgentStatus('inactive', 'AI Agent: Permission needed');
      agentInfo.style.display = '';
      agentInfoText.textContent = `ℹ Previously used folder found. Click "Restore Access" to reconnect.`;
    }
  })();

  // ══════════════════════════════════════════════════════════════
  // EXISTING NOTES SCANNER CODE
  // ══════════════════════════════════════════════════════════════

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
          ⚠ ${err.message || 'Something went wrong. Is the backend running on localhost:3001?'}
        </p>`;
      docContent.style.display     = 'block';
      docPlaceholder.style.display = 'none';
    }
  }

  // ── non-streaming path ─────────────────────────────────────────
  async function scanBatch(file) {
    const form = new FormData();
    form.append('image', file);
    form.append('style', currentStyle);

    const res  = await fetch(`${API_BASE}/api/notes/scan`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);

    finishScan(data.markdown, data.word_count, data.title, data.processing_ms);
    addHistory(URL.createObjectURL(file), data.markdown, data.word_count);
  }

  // ── streaming path (SSE) ───────────────────────────────────────
  async function scanStreaming(file) {
    const form = new FormData();
    form.append('image', file);
    form.append('style', currentStyle);

    const res = await fetch(`${API_BASE}/api/notes/scan-stream`, { method: 'POST', body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server error ${res.status}`);
    }

    // show doc panel early so tokens appear live
    docPlaceholder.style.display = 'none';
    docContent.innerHTML         = '<span class="typing-cursor"></span>';
    docContent.style.display     = 'block';

    let accumulated = '';
    const reader    = res.body.getReader();
    const decoder   = new TextDecoder();
    let buffer      = '';

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
            docContent.innerHTML = mdToHtml(accumulated) + '<span class="typing-cursor"></span>';
            docOutput.scrollTop  = docOutput.scrollHeight;
          }
          if (ev.markdown !== undefined) {
            // 'done' event — markdown is the full completed text
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

    const now     = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    docMeta.textContent = ms
      ? `Scanned ${timeStr} · ${wordCount} words · ${ms}ms`
      : `Scanned ${timeStr} · ${wordCount} words`;

    exportStrip.style.display = '';

    if (typeof pendo !== 'undefined') {
      pendo.track('note_scan_completed', {
        outputStyle: currentStyle,
        wordCount: wordCount,
        processingMs: ms || null,
        streamingUsed: useStreaming
      });
    }
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
    scanImg.src           = h.url;
    currentMarkdown       = h.markdown;
    docContent.innerHTML  = mdToHtml(h.markdown);
    docContent.style.display     = 'block';
    docPlaceholder.style.display = 'none';
    exportStrip.style.display    = '';
    docMeta.textContent          = h.meta;
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
      const prev = docMeta.textContent;
      docMeta.textContent = '✓ Copied to clipboard';
      setTimeout(() => { if (docMeta) docMeta.textContent = prev; }, 2000);

      if (typeof pendo !== 'undefined') {
        pendo.track('note_exported', {
          exportType: 'copy',
          wordCount: currentMarkdown.split(/\s+/).filter(Boolean).length,
          outputStyle: currentStyle
        });
      }
    });
  };

  window.downloadMd = function () {
    if (!currentMarkdown) return;
    const blob = new Blob([currentMarkdown], { type: 'text/markdown' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `loupe-notes-${Date.now()}.md`;
    a.click();

    if (typeof pendo !== 'undefined') {
      pendo.track('note_exported', {
        exportType: 'download',
        wordCount: currentMarkdown.split(/\s+/).filter(Boolean).length,
        outputStyle: currentStyle
      });
    }
  };

  window.shareDoc = async function () {
    if (!currentMarkdown) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Scanned notes — Loupe', text: currentMarkdown });
        if (typeof pendo !== 'undefined') {
          pendo.track('note_exported', {
            exportType: 'share',
            wordCount: currentMarkdown.split(/\s+/).filter(Boolean).length,
            outputStyle: currentStyle
          });
        }
        return;
      }
      catch (_) { /* fall through */ }
    }
    copyDoc();
  };

  // ── markdown → html (zero deps) ───────────────────────────────
  function mdToHtml(md) {
    return md
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm,  '<h2>$1</h2>')
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
