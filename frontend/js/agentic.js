// js/agentic.js — AI Agent for automatic folder watching and processing

(function (window) {
  'use strict';

  // ══════════════════════════════════════════════════════════════
  // IndexedDB Manager — persist directory handles & folder-specific file tracking
  // ══════════════════════════════════════════════════════════════
  class StorageManager {
    constructor(dbName = 'LoupeAgentDB', version = 2) {
      this.dbName = dbName;
      this.version = version;
      this.db = null;
    }

    async init() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(this.dbName, this.version);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };
        
        request.onupgradeneeded = (e) => {
          const db = e.target.result;
          
          // Directories store
          if (!db.objectStoreNames.contains('directories')) {
            db.createObjectStore('directories', { keyPath: 'id' });
          }
          
          // Processed files store - NOW WITH FOLDER PATH
          // Schema: { key: 'folderPath:fileName_size_timestamp', folderPath, fileName, timestamp }
          if (!db.objectStoreNames.contains('processedFiles')) {
            const store = db.createObjectStore('processedFiles', { keyPath: 'key' });
            store.createIndex('folderPath', 'folderPath', { unique: false });
            store.createIndex('timestamp', 'timestamp', { unique: false });
          } else if (e.oldVersion < 2) {
            // Migration: add indexes if upgrading from v1
            const tx = e.target.transaction;
            const store = tx.objectStore('processedFiles');
            if (!store.indexNames.contains('folderPath')) {
              store.createIndex('folderPath', 'folderPath', { unique: false });
            }
            if (!store.indexNames.contains('timestamp')) {
              store.createIndex('timestamp', 'timestamp', { unique: false });
            }
          }
        };
      });
    }

    async saveDirectory(id, handle, folderPath) {
      if (!this.db) await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['directories'], 'readwrite');
        const store = tx.objectStore('directories');
        const request = store.put({ id, handle, folderPath, savedAt: Date.now() });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    async getDirectory(id) {
      if (!this.db) await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['directories'], 'readonly');
        const store = tx.objectStore('directories');
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    async clearDirectory(id) {
      if (!this.db) await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['directories'], 'readwrite');
        const store = tx.objectStore('directories');
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    // Mark file as processed WITH folder context
    async markFileProcessed(fileKey, folderPath, fileName) {
      if (!this.db) await this.init();
      const compositeKey = `${folderPath}:${fileKey}`;
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['processedFiles'], 'readwrite');
        const store = tx.objectStore('processedFiles');
        const request = store.put({ 
          key: compositeKey, 
          folderPath, 
          fileName, 
          fileKey,
          timestamp: Date.now() 
        });
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    // Check if file is processed in THIS folder
    async isFileProcessed(fileKey, folderPath) {
      if (!this.db) await this.init();
      const compositeKey = `${folderPath}:${fileKey}`;
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['processedFiles'], 'readonly');
        const store = tx.objectStore('processedFiles');
        const request = store.get(compositeKey);
        request.onsuccess = () => resolve(!!request.result);
        request.onerror = () => reject(request.error);
      });
    }

    // Get count of processed files for a folder
    async getProcessedCount(folderPath) {
      if (!this.db) await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['processedFiles'], 'readonly');
        const store = tx.objectStore('processedFiles');
        const index = store.index('folderPath');
        const request = index.count(folderPath);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    // Clear processed files for specific folder only
    async clearProcessedFilesForFolder(folderPath) {
      if (!this.db) await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['processedFiles'], 'readwrite');
        const store = tx.objectStore('processedFiles');
        const index = store.index('folderPath');
        const request = index.openCursor(IDBKeyRange.only(folderPath));
        
        request.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    }

    // Clear ALL processed files (use sparingly)
    async clearAllProcessedFiles() {
      if (!this.db) await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['processedFiles'], 'readwrite');
        const store = tx.objectStore('processedFiles');
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }

    // Get statistics for debugging
    async getStats() {
      if (!this.db) await this.init();
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['processedFiles'], 'readonly');
        const store = tx.objectStore('processedFiles');
        const countRequest = store.count();
        
        countRequest.onsuccess = () => {
          resolve({ totalProcessedFiles: countRequest.result });
        };
        countRequest.onerror = () => reject(countRequest.error);
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Directory Agent — watch folder and emit events for new files
  // ══════════════════════════════════════════════════════════════
  class DirectoryAgent {
    constructor(options = {}) {
      this.id = options.id || 'default-agent';
      this.pollInterval = options.pollInterval || 5000; // 5 seconds
      this.fileTypes = options.fileTypes || ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
      this.storage = new StorageManager();
      
      this.directoryHandle = null;
      this.folderPath = null; // Store folder identifier for tracking
      this.isWatching = false;
      this.pollTimer = null;
      this.scanStats = { newFiles: 0, skippedFiles: 0, totalProcessed: 0 }; // Track statistics
      this.listeners = {
        fileAdded: [],
        statusChange: [],
        error: [],
        scanComplete: [] // New event for scan statistics
      };
    }

    // ── Events ─────────────────────────────────────────────────
    on(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event].push(callback);
      }
    }

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => cb(data));
      }
    }

    // ── Check browser support ──────────────────────────────────
    static isSupported() {
      return 'showDirectoryPicker' in window;
    }

    // ── Activate agent: pick directory ────────────────────────
    async activate() {
      try {
        if (!DirectoryAgent.isSupported()) {
          throw new Error('File System Access API not supported in this browser');
        }

        this.directoryHandle = await window.showDirectoryPicker({
          mode: 'read',
          startIn: 'pictures'
        });

        // Use folder name as identifier for tracking
        this.folderPath = this.directoryHandle.name;

        // Save handle to IndexedDB with folder path
        await this.storage.saveDirectory(this.id, this.directoryHandle, this.folderPath);
        
        // Get count of already processed files
        this.scanStats.totalProcessed = await this.storage.getProcessedCount(this.folderPath);
        
        this.emit('statusChange', {
          status: 'activated',
          path: this.folderPath,
          processedCount: this.scanStats.totalProcessed
        });

        // Start watching
        await this.startWatching();
        
        return { 
          success: true, 
          path: this.folderPath,
          processedCount: this.scanStats.totalProcessed
        };
      } catch (err) {
        this.emit('error', { message: err.message });
        throw err;
      }
    }

    // ── Restore from saved handle ──────────────────────────────
    async restore() {
      try {
        const savedData = await this.storage.getDirectory(this.id);
        if (!savedData || !savedData.handle) {
          return { success: false, reason: 'no_saved_handle' };
        }

        const savedHandle = savedData.handle;
        this.folderPath = savedData.folderPath || savedHandle.name;

        // Request permission again (required by browser security)
        const permission = await savedHandle.queryPermission({ mode: 'read' });
        if (permission === 'granted') {
          this.directoryHandle = savedHandle;
          this.scanStats.totalProcessed = await this.storage.getProcessedCount(this.folderPath);
          
          this.emit('statusChange', {
            status: 'restored',
            path: this.folderPath,
            processedCount: this.scanStats.totalProcessed
          });
          await this.startWatching();
          return { 
            success: true, 
            path: this.folderPath,
            processedCount: this.scanStats.totalProcessed
          };
        }

        // Permission not granted, need user action
        return { success: false, reason: 'permission_required', handle: savedHandle };
      } catch (err) {
        this.emit('error', { message: err.message });
        return { success: false, reason: 'error', error: err.message };
      }
    }

    // ── Request permission for saved handle ────────────────────
    async requestPermission(handle) {
      try {
        const permission = await handle.requestPermission({ mode: 'read' });
        if (permission === 'granted') {
          this.directoryHandle = handle;
          this.folderPath = handle.name;
          this.scanStats.totalProcessed = await this.storage.getProcessedCount(this.folderPath);
          
          this.emit('statusChange', {
            status: 'permission_granted',
            path: this.folderPath,
            processedCount: this.scanStats.totalProcessed
          });
          await this.startWatching();
          return { success: true };
        }
        return { success: false, reason: 'permission_denied' };
      } catch (err) {
        this.emit('error', { message: err.message });
        return { success: false, error: err.message };
      }
    }

    // ── Start watching folder ──────────────────────────────────
    async startWatching() {
      if (this.isWatching) return;
      if (!this.directoryHandle) {
        throw new Error('No directory handle available');
      }

      this.isWatching = true;
      this.emit('statusChange', { 
        status: 'watching', 
        path: this.folderPath,
        processedCount: this.scanStats.totalProcessed
      });

      // Initial scan
      await this.scanDirectory();

      // Start polling
      this.pollTimer = setInterval(() => {
        this.scanDirectory();
      }, this.pollInterval);
    }

    // ── Stop watching ──────────────────────────────────────────
    stopWatching() {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
        this.pollTimer = null;
      }
      this.isWatching = false;
      this.emit('statusChange', { status: 'stopped' });
    }

    // ── Scan directory for new files ───────────────────────────
    async scanDirectory() {
      if (!this.directoryHandle) return;

      try {
        const newFiles = [];
        let skippedCount = 0;
        let totalFound = 0;
        
        // Iterate through directory entries
        for await (const entry of this.directoryHandle.values()) {
          if (entry.kind === 'file') {
            const file = await entry.getFile();
            
            // Check if it's an image
            if (this.fileTypes.some(type => file.type.startsWith(type.split('/')[0]))) {
              totalFound++;
              const fileKey = this.generateFileKey(file);
              
              // Check if already processed IN THIS FOLDER
              const isProcessed = await this.storage.isFileProcessed(fileKey, this.folderPath);
              if (!isProcessed) {
                newFiles.push({ file, fileKey, entry });
              } else {
                skippedCount++;
              }
            }
          }
        }

        // Update stats
        this.scanStats.newFiles = newFiles.length;
        this.scanStats.skippedFiles = skippedCount;

        // Emit scan complete event with statistics
        this.emit('scanComplete', {
          newFiles: newFiles.length,
          skippedFiles: skippedCount,
          totalFound: totalFound,
          totalProcessed: this.scanStats.totalProcessed
        });

        // Emit events for new files and mark them as processed
        for (const { file, fileKey, entry } of newFiles) {
          await this.storage.markFileProcessed(fileKey, this.folderPath, entry.name);
          this.scanStats.totalProcessed++;
          this.emit('fileAdded', { 
            file, 
            name: entry.name, 
            path: this.folderPath,
            stats: {
              newFiles: this.scanStats.newFiles,
              skippedFiles: this.scanStats.skippedFiles,
              totalProcessed: this.scanStats.totalProcessed
            }
          });
        }

      } catch (err) {
        this.emit('error', { message: `Scan error: ${err.message}` });
      }
    }

    // ── Generate unique file key ───────────────────────────────
    generateFileKey(file) {
      return `${file.name}_${file.size}_${file.lastModified}`;
    }

    // ── Deactivate agent ───────────────────────────────────────
    async deactivate() {
      this.stopWatching();
      await this.storage.clearDirectory(this.id);
      // DO NOT clear processed files - keep history across sessions
      this.directoryHandle = null;
      this.folderPath = null;
      this.emit('statusChange', { status: 'deactivated' });
    }

    // ── Clear history for current folder ───────────────────────
    async clearHistory() {
      if (!this.folderPath) {
        throw new Error('No active folder to clear history for');
      }
      await this.storage.clearProcessedFilesForFolder(this.folderPath);
      this.scanStats.totalProcessed = 0;
      this.emit('statusChange', { 
        status: 'history_cleared', 
        path: this.folderPath,
        processedCount: 0
      });
    }

    // ── Get current status ─────────────────────────────────────
    getStatus() {
      return {
        isActive: !!this.directoryHandle,
        isWatching: this.isWatching,
        path: this.folderPath || null,
        stats: this.scanStats
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Mobile Agent - Uses alternative approaches for mobile devices
  // ══════════════════════════════════════════════════════════════
  class MobileAgent {
    constructor(options = {}) {
      this.id = options.id || 'mobile-agent';
      this.fileTypes = options.fileTypes || ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
      this.listeners = {
        fileAdded: [],
        statusChange: [],
        error: []
      };
      this.isActive = false;
      this.processedFiles = new Set();
    }

    on(event, callback) {
      if (this.listeners[event]) {
        this.listeners[event].push(callback);
      }
    }

    emit(event, data) {
      if (this.listeners[event]) {
        this.listeners[event].forEach(cb => cb(data));
      }
    }

    static isMobile() {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }

    // Activate with folder picker (works on mobile Chrome)
    async activateWithFolderPicker(inputElement) {
      this.isActive = true;
      this.emit('statusChange', { status: 'activated_mobile', mode: 'folder_picker' });
      
      inputElement.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
          if (this.isValidFileType(file)) {
            const fileKey = this.generateFileKey(file);
            if (!this.processedFiles.has(fileKey)) {
              this.processedFiles.add(fileKey);
              this.emit('fileAdded', { file, name: file.name, path: 'Mobile Upload' });
            }
          }
        }
      });

      return { success: true, mode: 'folder_picker' };
    }

    // Activate with camera integration (mobile camera access)
    async activateWithCamera(inputElement) {
      this.isActive = true;
      this.emit('statusChange', { status: 'activated_mobile', mode: 'camera' });
      
      inputElement.setAttribute('capture', 'environment'); // Use back camera
      inputElement.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file && this.isValidFileType(file)) {
          const fileKey = this.generateFileKey(file);
          if (!this.processedFiles.has(fileKey)) {
            this.processedFiles.add(fileKey);
            this.emit('fileAdded', { file, name: file.name, path: 'Camera' });
          }
        }
      });

      return { success: true, mode: 'camera' };
    }

    // Activate with share target (PWA feature)
    async activateWithShareTarget() {
      this.isActive = true;
      this.emit('statusChange', { status: 'activated_mobile', mode: 'share_target' });
      
      // Listen for shared files (requires PWA manifest configuration)
      if ('launchQueue' in window) {
        window.launchQueue.setConsumer(async (launchParams) => {
          if (launchParams.files && launchParams.files.length > 0) {
            for (const fileHandle of launchParams.files) {
              const file = await fileHandle.getFile();
              if (this.isValidFileType(file)) {
                const fileKey = this.generateFileKey(file);
                if (!this.processedFiles.has(fileKey)) {
                  this.processedFiles.add(fileKey);
                  this.emit('fileAdded', { file, name: file.name, path: 'Shared' });
                }
              }
            }
          }
        });
      }

      return { success: true, mode: 'share_target' };
    }

    isValidFileType(file) {
      return this.fileTypes.some(type => {
        if (type.includes('*')) {
          return file.type.startsWith(type.split('/')[0]);
        }
        return file.type === type;
      });
    }

    generateFileKey(file) {
      return `${file.name}_${file.size}_${file.lastModified}`;
    }

    deactivate() {
      this.isActive = false;
      this.processedFiles.clear();
      this.emit('statusChange', { status: 'deactivated' });
    }

    getStatus() {
      return {
        isActive: this.isActive,
        platform: 'mobile'
      };
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Fallback UI Helper
  // ══════════════════════════════════════════════════════════════
  class FallbackAgent {
    static showFallbackUI(containerId) {
      const container = document.getElementById(containerId);
      if (!container) return;

      const isMobile = MobileAgent.isMobile();
      
      if (isMobile) {
        container.innerHTML = `
          <div style="padding: var(--space-4); background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--radius-md);">
            <p style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--good); margin-bottom: var(--space-3);">
              📱 Mobile-optimized upload available!
            </p>
            <p style="font-size: 0.9rem; margin-bottom: var(--space-3);">
              Choose how you want to add photos:
            </p>
            <div style="display: flex; flex-direction: column; gap: var(--space-2);">
              <input type="file" id="fallback-folder-input" webkitdirectory directory multiple accept="image/*" style="display: none;" />
              <button class="btn btn-primary" onclick="document.getElementById('fallback-folder-input').click()">
                📁 Select Folder
              </button>
              <input type="file" id="fallback-camera-input" capture="environment" accept="image/*" style="display: none;" />
              <button class="btn btn-primary" onclick="document.getElementById('fallback-camera-input').click()">
                📸 Take Photo
              </button>
              <input type="file" id="fallback-multi-input" multiple accept="image/*" style="display: none;" />
              <button class="btn btn-ghost" onclick="document.getElementById('fallback-multi-input').click()">
                🖼️ Select Multiple Files
              </button>
            </div>
          </div>
        `;
      } else {
        container.innerHTML = `
          <div style="padding: var(--space-4); background: var(--paper-raised); border: 1px solid var(--line); border-radius: var(--radius-md);">
            <p style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--ash); margin-bottom: var(--space-3);">
              ℹ️ Automatic folder watching requires Chrome/Edge on desktop.
            </p>
            <p style="font-size: 0.9rem; margin-bottom: var(--space-3);">
              You can still upload files manually:
            </p>
            <input type="file" id="fallback-folder-input" webkitdirectory directory multiple accept="image/*" style="display: none;" />
            <button class="btn btn-primary" onclick="document.getElementById('fallback-folder-input').click()">
              📁 Select Folder
              </button>
          </div>
        `;
      }
    }
  }

  // ══════════════════════════════════════════════════════════════
  // Export to global scope
  // ══════════════════════════════════════════════════════════════
  window.DirectoryAgent = DirectoryAgent;
  window.MobileAgent = MobileAgent;
  window.FallbackAgent = FallbackAgent;
  window.AgentStorage = StorageManager;

})(window);
