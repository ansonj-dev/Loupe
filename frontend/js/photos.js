// js/photos.js — Photo sort  (on-device metrics + optional backend AI scoring)

(function () {
  // ── config ─────────────────────────────────────────────────
  const API_BASE    = (window.LOUPE_API_BASE || 'http://localhost:3001').replace(/\/$/, '');
  const USE_BACKEND = false; // set false to run fully on-device (TEMP: API quota exceeded)

  // ── state ──────────────────────────────────────────────────
  let photos       = [];
  let mode         = 'auto';
  let activeFilter = 'all';
  let pendingFiles = [];
  let galleryAgent = null; // AI Agent instance

  // ── DOM refs ───────────────────────────────────────────────
  const dropzone        = document.getElementById('dropzone');
  const contactSheet    = document.getElementById('contact-sheet');
  const statsBar        = document.getElementById('stats-bar');
  const picksSection    = document.getElementById('picks-section');
  const picksStrip      = document.getElementById('picks-strip');
  const sheetAll        = document.getElementById('sheet-all');
  const sheetClusters   = document.getElementById('sheet-clusters');
  const clusterCont     = document.getElementById('cluster-container');
  const emptyState      = document.getElementById('empty-state');
  const scanProgress    = document.getElementById('scan-progress');
  const scanProgressBar = document.getElementById('scan-progress-bar');
  const shareTray       = document.getElementById('share-tray');
  const trayCount       = document.getElementById('tray-count');
  const scanIndicator   = document.getElementById('scan-indicator');
  const scanStatus      = document.getElementById('scan-status');
  const manualScanBtn   = document.getElementById('manual-scan-btn');

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
  // AI GALLERY AGENT (Desktop + Mobile)
  // ══════════════════════════════════════════════════════════════

  window.activateGalleryAgent = async function() {
    if (!window.DirectoryAgent && !window.MobileAgent) {
      alert('Agent library not loaded');
      return;
    }

    // Check if mobile
    const isMobile = window.MobileAgent && window.MobileAgent.isMobile();

    if (isMobile) {
      // Mobile mode: Use enhanced folder picker or camera
      try {
        galleryAgent = new window.MobileAgent({
          id: 'gallery-agent-mobile',
          fileTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
        });

        galleryAgent.on('fileAdded', async (data) => {
          console.log('📸 New photo detected (mobile):', data.name);
          updateAgentStatus('scanning', `Processing: ${data.name}`);
          await handleFiles([data.file]);
          updateAgentStatus('watching', `Mobile Agent: Ready`);
        });

        galleryAgent.on('statusChange', (data) => {
          console.log('Mobile agent status:', data);
          if (data.status === 'activated_mobile') {
            updateAgentStatus('watching', `Mobile Agent: ${data.mode === 'camera' ? 'Camera Ready' : 'Folder Ready'}`);
          }
        });

        // Show mobile options
        showMobileAgentOptions();

      } catch (err) {
        console.error('Failed to activate mobile agent:', err);
        updateAgentStatus('inactive', 'AI Agent: Failed to activate');
        alert('Failed to activate mobile agent: ' + err.message);
      }
    } else {
      // Desktop mode: Use File System Access API
      if (!window.DirectoryAgent.isSupported()) {
        alert('Automatic folder watching is not supported in this browser. Please use Chrome, Edge, or Opera on desktop.');
        return;
      }

      try {
        galleryAgent = new window.DirectoryAgent({
          id: 'gallery-agent',
          pollInterval: 5000,
          fileTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
        });

        // Set up event listeners
        galleryAgent.on('fileAdded', async (data) => {
          console.log('📸 New photo detected:', data.name);
          updateAgentStatus('scanning', `Processing: ${data.name}`);
          await handleFiles([data.file]);
          
          // Show statistics after processing
          const statsMsg = `Watching: ${data.path} (${data.stats.totalProcessed} processed, ${data.stats.skippedFiles} skipped)`;
          updateAgentStatus('watching', statsMsg);
        });

        galleryAgent.on('scanComplete', (data) => {
          console.log('📊 Scan complete:', data);
          if (data.newFiles > 0) {
            console.log(`✓ Found ${data.newFiles} new files, skipped ${data.skippedFiles} already processed`);
          }
        });

        galleryAgent.on('statusChange', (data) => {
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

        galleryAgent.on('error', (data) => {
          console.error('Agent error:', data.message);
          updateAgentStatus('inactive', 'AI Agent: Error - ' + data.message);
        });

        // Activate
        const result = await galleryAgent.activate();
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
            ? `✓ Agent is monitoring your gallery folder. ${result.processedCount} files already processed will be skipped.`
            : `✓ Agent is monitoring your gallery folder. New photos will be automatically processed.`;
          agentInfoText.textContent = infoMsg;
        }
      } catch (err) {
        console.error('Failed to activate agent:', err);
        updateAgentStatus('inactive', 'AI Agent: Failed to activate');
        if (err.name === 'AbortError') {
          // User cancelled the picker
          return;
        }
        alert('Failed to activate agent: ' + err.message);
      }
    }
  };

  function showMobileAgentOptions() {
    // Update UI to show mobile-specific options
    agentActivateBtn.style.display = 'none';
    agentRestoreBtn.style.display = 'none';
    agentDeactivateBtn.style.display = '';
    agentInfo.style.display = '';
    agentInfoText.innerHTML = `
      <p style="margin-bottom: var(--space-2);">📱 Mobile Agent Active - Choose upload method:</p>
      <div style="display: flex; flex-direction: column; gap: var(--space-2);">
        <input type="file" id="mobile-folder-input" webkitdirectory directory multiple accept="image/*" style="display: none;" onchange="handleFiles(this.files)" />
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('mobile-folder-input').click()">
          📁 Select Folder
        </button>
        <input type="file" id="mobile-camera-input" capture="environment" accept="image/*" style="display: none;" onchange="handleFiles(this.files)" />
        <button class="btn btn-sm btn-primary" onclick="document.getElementById('mobile-camera-input').click()">
          📸 Take Photo
        </button>
        <input type="file" id="mobile-multi-input" multiple accept="image/*" style="display: none;" onchange="handleFiles(this.files)" />
        <button class="btn btn-sm btn-ghost" onclick="document.getElementById('mobile-multi-input').click()">
          🖼️ Select Multiple
        </button>
      </div>
    `;

    // Set up the mobile agent with the inputs
    const folderInput = document.getElementById('mobile-folder-input');
    const cameraInput = document.getElementById('mobile-camera-input');
    const multiInput = document.getElementById('mobile-multi-input');

    if (galleryAgent && folderInput) {
      galleryAgent.activateWithFolderPicker(folderInput);
    }
    if (galleryAgent && cameraInput) {
      galleryAgent.activateWithCamera(cameraInput);
    }

    updateAgentStatus('watching', 'Mobile Agent: Ready');
  }

  window.restoreGalleryAgent = async function() {
    if (!galleryAgent) return;
    
    const savedData = await galleryAgent.storage.getDirectory('gallery-agent');
    if (savedData && savedData.handle) {
      updateAgentStatus('inactive', 'Requesting permission...');
      const result = await galleryAgent.requestPermission(savedData.handle);
      if (result.success) {
        agentActivateBtn.style.display = 'none';
        agentRestoreBtn.style.display = 'none';
        agentDeactivateBtn.style.display = '';
        agentClearHistoryBtn.style.display = '';
        agentInfo.style.display = '';
        
        const processedCount = galleryAgent.scanStats.totalProcessed;
        const infoMsg = processedCount > 0
          ? `✓ Agent restored. Monitoring folder. ${processedCount} files already processed will be skipped.`
          : `✓ Agent restored. Monitoring folder for new photos.`;
        agentInfoText.textContent = infoMsg;
      } else {
        updateAgentStatus('inactive', 'Permission denied');
      }
    }
  };

  window.deactivateGalleryAgent = async function() {
    if (!galleryAgent) return;
    
    await galleryAgent.deactivate();
    galleryAgent = null;
    
    updateAgentStatus('inactive', 'AI Agent: Inactive');
    agentActivateBtn.style.display = '';
    agentRestoreBtn.style.display = 'none';
    agentDeactivateBtn.style.display = 'none';
    agentClearHistoryBtn.style.display = 'none';
    agentInfo.style.display = 'none';
  };

  window.clearGalleryAgentHistory = async function() {
    if (!galleryAgent || !galleryAgent.folderPath) {
      alert('No active folder to clear history for');
      return;
    }

    if (!confirm(`Clear processing history for "${galleryAgent.folderPath}"?\n\nThis will allow the agent to re-scan all files in this folder.`)) {
      return;
    }

    try {
      await galleryAgent.clearHistory();
      alert(`History cleared for "${galleryAgent.folderPath}". All files will be re-scanned on next check.`);
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

    galleryAgent = new window.DirectoryAgent({
      id: 'gallery-agent',
      pollInterval: 5000
    });

    galleryAgent.on('fileAdded', async (data) => {
      console.log('📸 New photo detected:', data.name);
      updateAgentStatus('scanning', `Processing: ${data.name}`);
      await handleFiles([data.file]);
      
      const statsMsg = data.stats 
        ? `Watching: ${data.path} (${data.stats.totalProcessed} processed, ${data.stats.skippedFiles} skipped)`
        : `Watching: ${data.path}`;
      updateAgentStatus('watching', statsMsg);
    });

    galleryAgent.on('statusChange', (data) => {
      if (data.status === 'watching' || data.status === 'restored') {
        const statsMsg = data.processedCount > 0
          ? `Watching: ${data.path} (${data.processedCount} already processed)`
          : `Watching: ${data.path}`;
        updateAgentStatus('watching', statsMsg);
      }
    });

    const restoreResult = await galleryAgent.restore();
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
  // EXISTING PHOTO SORTING CODE
  // ══════════════════════════════════════════════════════════════

  // ── mode switching ─────────────────────────────────────────
  window.setMode = function (m) {
    mode = m;
    document.getElementById('mode-auto').classList.toggle('is-active', m === 'auto');
    document.getElementById('mode-manual').classList.toggle('is-active', m === 'manual');
    manualScanBtn.style.display = m === 'manual' ? '' : 'none';
    if (m === 'auto') {
      scanIndicator.classList.add('is-live');
      scanStatus.textContent = 'Watching for new photos';
    } else {
      scanIndicator.classList.remove('is-live');
      scanStatus.textContent = 'Manual mode — tap Scan now';
    }
  };

  window.runScan = function () {
    if (pendingFiles.length) processFiles(pendingFiles.splice(0));
  };

  // ── drag & drop ────────────────────────────────────────────
  window.handleDragOver  = e  => { e.preventDefault(); dropzone.classList.add('is-dragover'); };
  window.handleDragLeave = () => dropzone.classList.remove('is-dragover');
  window.handleDrop      = e  => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    const files = [...e.dataTransfer.files].filter(f => f.type.startsWith('image/'));
    handleFiles(files);
  };
  window.handleFiles = function (rawFiles) {
    const files = [...rawFiles];
    if (!files.length) return;
    if (mode === 'manual') {
      pendingFiles.push(...files);
      scanStatus.textContent = `${pendingFiles.length} photo${pendingFiles.length !== 1 ? 's' : ''} queued`;
    } else {
      processFiles(files);
    }
  };

  // ── on-device metrics (canvas) ─────────────────────────────
  function loadImage(file) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.src    = url;
    });
  }

  function getPixelData(img, maxDim = 200) {
    const canvas  = document.createElement('canvas');
    const scale   = Math.min(1, maxDim / Math.max(img.width, img.height));
    canvas.width  = Math.round(img.width  * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  }

  function measureSharpness(d) {
    const { data, width, height } = d;
    let sum = 0, sumSq = 0, n = 0;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const g   = 0.299*data[idx] + 0.587*data[idx+1] + 0.114*data[idx+2];
        const t   = 0.299*data[((y-1)*width+x)*4]   + 0.587*data[((y-1)*width+x)*4+1]   + 0.114*data[((y-1)*width+x)*4+2];
        const b   = 0.299*data[((y+1)*width+x)*4]   + 0.587*data[((y+1)*width+x)*4+1]   + 0.114*data[((y+1)*width+x)*4+2];
        const l   = 0.299*data[(y*width+(x-1))*4]   + 0.587*data[(y*width+(x-1))*4+1]   + 0.114*data[(y*width+(x-1))*4+2];
        const r   = 0.299*data[(y*width+(x+1))*4]   + 0.587*data[(y*width+(x+1))*4+1]   + 0.114*data[(y*width+(x+1))*4+2];
        const lap = t + b + l + r - 4*g;
        sum += lap; sumSq += lap*lap; n++;
      }
    }
    const mean = sum / n;
    return Math.sqrt(Math.max(0, sumSq/n - mean*mean));
  }

  function measureExposure(d) {
    let lum = 0;
    for (let i = 0; i < d.data.length; i += 4)
      lum += 0.299*d.data[i] + 0.587*d.data[i+1] + 0.114*d.data[i+2];
    return lum / (d.data.length / 4);
  }

  function avgHash(img) {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    c.getContext('2d').drawImage(img, 0, 0, 8, 8);
    const d   = c.getContext('2d').getImageData(0, 0, 8, 8).data;
    const g   = Array.from({ length: 64 }, (_, i) => 0.299*d[i*4] + 0.587*d[i*4+1] + 0.114*d[i*4+2]);
    const avg = g.reduce((a, b) => a + b, 0) / 64;
    return g.map(v => v >= avg ? 1 : 0);
  }

  function hammingDist(a, b) {
    return a.reduce((acc, v, i) => acc + (v !== b[i] ? 1 : 0), 0);
  }

  function localScore(sharpness, exposure) {
    const s = Math.min(1, sharpness / 40);
    const e = 1 - Math.abs(exposure - 128) / 128;
    return Math.round((0.65*s + 0.35*e) * 100);
  }

  // ── backend AI scoring ─────────────────────────────────────
  async function fetchAIScore(files) {
    const form = new FormData();
    files.forEach(f => form.append('images', f.file));
    const res = await fetch(`${API_BASE}/api/photos/analyze`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`Backend error ${res.status}`);
    return res.json();
  }

  // ── cluster similar shots ──────────────────────────────────
  function buildClusters(items) {
    const ids = items.map(() => null);
    let next = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        if (ids[j] !== null && ids[i] !== null) continue;
        if (hammingDist(items[i].hash, items[j].hash) <= 12) {
          if (ids[i] === null && ids[j] === null) { ids[i] = next; ids[j] = next; next++; }
          else if (ids[i] === null) ids[i] = ids[j];
          else if (ids[j] === null) ids[j] = ids[i];
        }
      }
    }
    return ids;
  }

  // ── process batch ──────────────────────────────────────────
  async function processFiles(files) {
    dropzone.style.display = 'none';
    scanProgress.classList.add('is-active');

    // Step 1: load images & compute on-device metrics
    const loaded = [];
    for (let i = 0; i < files.length; i++) {
      scanProgressBar.style.width = Math.round(((i + 0.5) / files.length) * 50) + '%';
      try {
        const { img, url } = await loadImage(files[i]);
        const pd = getPixelData(img, 180);
        loaded.push({
          id:         Date.now() + Math.random(),
          file:       files[i],
          url,
          hash:       avgHash(img),
          sharpness:  measureSharpness(pd),
          exposure:   measureExposure(pd),
          name:       files[i].name || `shot-${photos.length + loaded.length + 1}`,
          cluster:    null,
          issues:     [],
          highlights: [],
          reason:     '',
          aiScore:    null,
        });
      } catch (_) { /* skip unreadable files */ }
    }

    scanProgressBar.style.width = '50%';

    // Step 2: cluster on device (hashes are fast)
    const clusterIds = buildClusters(loaded);
    loaded.forEach((p, i) => { p.cluster = clusterIds[i]; });

    // Step 3: optionally send to backend for AI scoring
    if (USE_BACKEND) {
      try {
        const result = await fetchAIScore(loaded);
        result.photos.forEach((aiPhoto, i) => {
          if (!loaded[i]) return;
          loaded[i].aiScore    = aiPhoto.ai_score;
          loaded[i].score      = aiPhoto.score;
          loaded[i].keeper     = aiPhoto.keeper;
          loaded[i].issues     = aiPhoto.issues     || [];
          loaded[i].highlights = aiPhoto.highlights || [];
          loaded[i].reason     = aiPhoto.reason     || '';
          if (aiPhoto.cluster_id !== null) loaded[i].cluster = aiPhoto.cluster_id;
        });
      } catch (err) {
        console.warn('Backend AI scoring unavailable, falling back to on-device only:', err.message);
        loaded.forEach(p => {
          p.score  = localScore(p.sharpness, p.exposure);
          p.keeper = p.score >= 55;
        });
      }
    } else {
      loaded.forEach(p => {
        p.score  = localScore(p.sharpness, p.exposure);
        p.keeper = p.score >= 55;
      });
    }

    scanProgressBar.style.width = '100%';

    // Step 4: within each cluster, mark best
    const best = {};
    loaded.forEach(p => {
      if (p.cluster === null) return;
      if (!best[p.cluster] || p.score > best[p.cluster].score) best[p.cluster] = p;
    });
    loaded.forEach(p => {
      if (p.cluster !== null && best[p.cluster] !== p) p.keeper = false;
    });

    photos.push(...loaded);

    setTimeout(() => {
      scanProgress.classList.remove('is-active');
      scanProgressBar.style.width = '0%';
      render();
    }, 400);
  }

  // ── render ─────────────────────────────────────────────────
  function render() {
    const keepers  = photos.filter(p => p.keeper);
    const blurry   = photos.filter(p => p.issues.includes('blurry') || p.issues.includes('out_of_focus') || (p.score < 45 && !p.issues.length));
    const clusters = [...new Set(photos.map(p => p.cluster).filter(c => c !== null))];

    statsBar.style.display = photos.length ? '' : 'none';
    document.getElementById('stat-total').textContent    = photos.length;
    document.getElementById('stat-keepers').textContent  = keepers.length;
    document.getElementById('stat-blurry').textContent   = blurry.length;
    document.getElementById('stat-clusters').textContent = clusters.length;

    if (keepers.length) {
      picksSection.style.display = '';
      const top5 = [...keepers].sort((a, b) => b.score - a.score).slice(0, 5);
      picksStrip.innerHTML = top5.map((p, i) => `
        <div class="pick-thumb">
          <img src="${p.url}" alt="${p.name}" />
          <span class="pick-rank">#${i+1}</span>
          <span class="pick-score">${p.score}</span>
        </div>`).join('');
    } else {
      picksSection.style.display = 'none';
    }

    renderFilterView();
    updateShareTray();
  }

  function renderFilterView() {
    if (activeFilter === 'similar') { renderClusters(); return; }
    const visible = activeFilter === 'all'     ? photos
                  : activeFilter === 'keepers' ? photos.filter(p => p.keeper)
                  :                              photos.filter(p => !p.keeper);

    sheetAll.style.display      = visible.length ? '' : 'none';
    sheetClusters.style.display = 'none';
    emptyState.style.display    = (!visible.length && photos.length) ? '' : 'none';
    document.getElementById('count-all').textContent = `${visible.length} frame${visible.length !== 1 ? 's' : ''}`;
    contactSheet.innerHTML = visible.map(p => shotCard(p)).join('');
  }

  function renderClusters() {
    const grouped = {};
    photos.forEach(p => {
      if (p.cluster === null) return;
      (grouped[p.cluster] = grouped[p.cluster] || []).push(p);
    });
    const groups = Object.values(grouped);
    sheetAll.style.display      = 'none';
    sheetClusters.style.display = groups.length ? '' : 'none';
    emptyState.style.display    = !groups.length ? '' : 'none';
    document.getElementById('count-clusters').textContent = `${groups.length} group${groups.length !== 1 ? 's' : ''}`;
    clusterCont.innerHTML = groups.map((group, gi) => `
      <div class="cluster" style="margin-bottom:var(--space-4)">
        <span class="cluster-label">SIMILAR GROUP ${gi + 1} — ${group.length} shots</span>
        <div class="cluster-grid">${group.map(p => shotCard(p, true)).join('')}</div>
      </div>`).join('');
  }

  function shotCard(p, compact = false) {
    const flags = [];
    if (p.score >= 70)                        flags.push(`<span class="badge badge-good">sharp</span>`);
    else if (p.score < 45)                    flags.push(`<span class="badge badge-bad">blurry</span>`);
    if (p.issues.includes('underexposed'))    flags.push(`<span class="badge badge-bad">dark</span>`);
    if (p.issues.includes('overexposed'))     flags.push(`<span class="badge badge-soft">bright</span>`);
    if (p.cluster !== null)                   flags.push(`<span class="badge badge-neutral">G${p.cluster+1}</span>`);
    if (p.highlights && p.highlights[0])      flags.push(`<span class="badge badge-good">${p.highlights[0]}</span>`);

    return `<div class="shot ${p.keeper ? 'is-keeper' : ''} ${!p.keeper && p.score < 45 ? 'is-skipped' : ''}" data-id="${p.id}">
      <div class="shot-image-wrap">
        <img src="${p.url}" alt="${p.name}" loading="lazy" />
        <span class="score-pill">${p.score ?? '—'}</span>
        ${p.keeper ? `<svg class="circle-mark" viewBox="0 0 100 100" preserveAspectRatio="none">
          <path d="M 50 5 A 45 45 0 1 1 49.9 5" fill="none" stroke="#E14F3A" stroke-width="3.5" stroke-linecap="round"/>
        </svg>` : ''}
      </div>
      ${!compact ? `
      <div class="shot-meta">
        <div class="shot-meta-row"><span class="shot-badges">${flags.join('')}</span></div>
        ${p.reason ? `<div class="shot-meta-row"><span style="font-family:var(--font-mono);font-size:0.65rem;color:var(--ash)">${p.reason}</span></div>` : ''}
      </div>
      <div class="shot-actions">
        <button class="keep-btn" onclick="toggleKeep('${p.id}')">${p.keeper ? '✓ Kept' : '+ Keep'}</button>
        <button class="skip-btn" onclick="toggleSkip('${p.id}')">${!p.keeper ? '✕ Skip' : '— Skip'}</button>
      </div>` : ''}
    </div>`;
  }

  window.toggleKeep = id => { const p = photos.find(x => x.id == id); if (p) { p.keeper = true;  render(); } };
  window.toggleSkip = id => { const p = photos.find(x => x.id == id); if (p) { p.keeper = false; render(); } };

  function updateShareTray() {
    const keepers = photos.filter(p => p.keeper);
    shareTray.classList.toggle('is-visible', keepers.length > 0);
    trayCount.textContent = `${keepers.length} keeper${keepers.length !== 1 ? 's' : ''} ready`;
  }

  window.setFilter = function (filter, btn) {
    activeFilter = filter;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('is-active'));
    if (btn) btn.classList.add('is-active');
    if (photos.length) renderFilterView();
  };

  window.exportKeepers = async function (action) {
    const keepers = photos.filter(p => p.keeper);
    if (!keepers.length) return;
    if (action === 'share' && navigator.share && navigator.canShare) {
      try {
        const files = keepers.map(p => p.file);
        if (navigator.canShare({ files })) {
          await navigator.share({ files, title: 'My best shots — Loupe' });
          return;
        }
      } catch (_) { /* fall through */ }
    }
    keepers.forEach((p, i) => {
      const a = document.createElement('a');
      a.href = p.url; a.download = `loupe-keeper-${i + 1}.jpg`; a.click();
    });
  };

})();
