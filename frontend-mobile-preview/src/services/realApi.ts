import { Album, AlbumFolder, ExtractionJob, ImageItem, DomainPattern, VideoItem, VideoFolder, TrashItem, TrashStats, ScanPageVideosResponse, OllamaHealthStatus, OllamaModelInfo, MultiAlbumPreviewImage } from '../types';
import { colorPaletteCache } from './colorExtractor';
import { cacheAlbumVideoTransport, getAlbumMediaSummary, getMediaCategory, inferMediaFormat, isVideoMedia, normalizeAlbumMediaTags, unwrapMediaSource } from '../utils/mediaClassification';

export class BackendApiClient {
  private inFlight = new Map<string, Promise<any>>();
  private jobsEtag: string | null = null;
  private previousJobs: any[] | null = null;

  private coalesce<T>(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);
    if (existing) return existing;
    const request = load().finally(() => { if (this.inFlight.get(key) === request) this.inFlight.delete(key); });
    this.inFlight.set(key, request);
    return request;
  }

  /**
   * Checks if the Python FastAPI backend is live and reachable.
   */
  async checkBackendHealth(): Promise<boolean> {
    try {
      const res = await fetch('/api/health', { method: 'GET', cache: 'no-store' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetches all real albums saved in data/albums/ on disk.
   */
  async fetchRealAlbums(): Promise<Album[]> {
    return this.coalesce('albums', async () => {
      // Keep full-record consumers (Shorts, export, duplicates) compatible, but
      // parse/map bounded pages and yield between chunks so input stays usable.
      for (let attempt = 0; attempt < 2; attempt++) {
        const albums: Album[] = [];
        let after: string | undefined;
        let restart = false;
        while (true) {
          const params = new URLSearchParams({ limit: '24' });
          if (after) params.set('after', after);
          const res = await fetch(`/api/albums?${params}`, { cache: 'no-store' });
          if (res.status === 409 && attempt === 0) { restart = true; break; }
          if (!res.ok) throw new Error(`Albums request failed: ${res.status}`);
          const page = await res.json();
          if (!Array.isArray(page)) throw new Error('Invalid album response');
          let sliceStarted = performance.now();
          for (const item of page) {
            albums.push(this.mapBackendAlbumToFrontend(item));
            if (performance.now() - sliceStarted >= 8) {
              await new Promise<void>(resolve => setTimeout(resolve, 0));
              sliceStarted = performance.now();
            }
          }
          // Older backends ignore paging; accept their complete list once.
          if (res.headers?.get('X-Library-Paging') !== 'cursor' || page.length < 24) break;
          const cursor = page[page.length - 1]?.session_id || page[page.length - 1]?.album_id;
          if (!cursor || cursor === after) throw new Error('Invalid album page cursor');
          after = cursor;
        }
        if (!restart) return albums;
      }
      throw new Error('Library changed during synchronization');
    });
  }

  /**
   * Fetches full probed details for a specific album from the backend.
   */
  async fetchAlbumDetails(sessionId: string): Promise<Album | null> {
    try {
      const res = await fetch(`/api/albums/${encodeURIComponent(sessionId)}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      const rawAlbum = data.album || data;
      const mapped = this.mapBackendAlbumToFrontend(rawAlbum);
      if (data.sync_stats || data.stats) mapped.syncStats = data.sync_stats || data.stats;
      if (data.sync_message || data.message) mapped.syncMessage = data.sync_message || data.message;
      return mapped;
    } catch {
      return null;
    }
  }

  /**
   * Fetches available Ollama local models from the backend.
   */
  async fetchAvailableModels(): Promise<string[]> {
    try {
      const res = await fetch('/api/models', { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      
      let models: string[] = [];
      if (Array.isArray(data)) {
        models = data;
      } else {
        if (data.models && Array.isArray(data.models)) {
          models = [...models, ...data.models.map((m: any) => m.name || m)];
        }
        if (data.gemini_models && Array.isArray(data.gemini_models)) {
          models = [...models, ...data.gemini_models.map((m: any) => m.name || m)];
        }
      }
      return models;
    } catch {
      return [];
    }
  }

  /**
   * Fetches all persistent jobs from the Python backend (data/jobs.json).
   */
  async fetchAllJobs(): Promise<any[]> {
    return this.coalesce('jobs', async () => {
      const headers: Record<string, string> = {};
      if (this.jobsEtag && this.previousJobs) headers['If-None-Match'] = this.jobsEtag;
      const res = await fetch('/api/jobs', { cache: 'no-store', headers });
      if (res.status === 304 && this.previousJobs) return this.previousJobs;
      if (!res.ok) throw new Error(`Jobs request failed: ${res.status}`);
      const jobs = await res.json();
      if (!Array.isArray(jobs)) throw new Error('Invalid jobs response');
      this.jobsEtag = res.headers?.get('ETag') || null;
      this.previousJobs = jobs;
      return jobs;
    });
  }

  /**
   * Deletes a persistent job record from the backend.
   */
  async deleteJob(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/jobs/${sessionId}`, { method: 'DELETE' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetches all active and running jobs from the Python backend for cross-device recovery.
   */
  async fetchActiveJobs(): Promise<any[]> {
    try {
      const res = await fetch('/api/jobs/active', { cache: 'no-store' });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  /**
   * Starts a real autonomous extraction job on the Python backend.
   */
  async startExtraction(
    url: string,
    engineType: string = 'ai_react',
    modelName: string = 'qwen2.5:32b',
    geminiModel: string = 'gemini-3.7-flash',
    reasoningBudget: number = 3,
    maxConcurrency: number = 3,
    antiBotDelayMs: number = 500,
    mediaTypeFilter: string = 'all',
    folder: string = 'Geral',
    downloadLocally: boolean = false
  ): Promise<{ session_id: string } | null> {
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          engine_type: engineType,
          model_name: modelName,
          gemini_model: geminiModel,
          reasoning_budget: reasoningBudget,
          max_concurrency: maxConcurrency,
          anti_bot_delay_ms: antiBotDelayMs,
          headless: true,
          media_type_filter: mediaTypeFilter,
          folder: folder || 'Geral',
          download_locally: downloadLocally
        })
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      console.error('Failed to trigger real extraction:', err);
      return null;
    }
  }

  /**
   * Starts a real autonomous batch extraction job on the Python backend.
   */
  async startBatchExtraction(
    urls: string[],
    engineType: string = 'ai_react',
    modelName: string = 'qwen2.5:32b',
    geminiModel: string = 'gemini-3.7-flash',
    reasoningBudget: number = 3,
    maxConcurrency: number = 3,
    antiBotDelayMs: number = 500,
    mediaTypeFilter: string = 'all',
    folder: string = 'Geral',
    priority: 'high' | 'medium' | 'low' = 'medium',
    downloadLocally: boolean = false
  ): Promise<any[] | null> {
    try {
      const res = await fetch('/api/batch-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls,
          engine_type: engineType,
          model_name: modelName,
          gemini_model: geminiModel,
          reasoning_budget: reasoningBudget,
          max_concurrency: maxConcurrency,
          anti_bot_delay_ms: antiBotDelayMs,
          headless: true,
          media_type_filter: mediaTypeFilter,
          folder: folder || 'Geral',
          priority,
          download_locally: downloadLocally
        })
      });
      if (res.ok) {
        const data = await res.json();
        return data.jobs || null;
      }
      return null;
    } catch (e) {
      console.warn('Batch extraction failed to start', e);
      return null;
    }
  }

  /**
   * Submits a copilot response to a blocked job on the Python backend.
   */
  async submitCopilotResponse(sessionId: string, optionId: string, textResponse?: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/copilot/${sessionId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_option: optionId, text_input: textResponse })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sends a message to the real AI chat endpoint on the backend.
   */
  async sendChatMessage(
    message: string,
    options?: {
      provider?: 'gemini' | 'ollama';
      model?: string;
      ollamaUrl?: string;
      conversationHistory?: Array<{ role: string; content: string }>;
      context?: Record<string, any>;
    }
  ): Promise<{
    reply: string;
    provider?: 'gemini' | 'ollama';
    model?: string;
    error_type?: string;
    can_fallback?: boolean;
    media_items?: any[];
    executed_tools?: any[];
    thought_chain?: string[];
    client_action?: any;
  } | null> {
    try {
      const payload: any = { message };
      if (options?.provider) payload.provider = options.provider;
      if (options?.model) payload.model = options.model;
      if (options?.ollamaUrl) payload.ollama_url = options.ollamaUrl;
      if (options?.conversationHistory) payload.conversation_history = options.conversationHistory;
      if (options?.context) payload.context = options.context;

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        return {
          reply: `Server error (HTTP ${res.status}). Ensure backend is active.`,
          error_type: 'http_error',
          can_fallback: true
        };
      }
      const data = await res.json();
      return {
        reply: data.reply || data.response || '',
        provider: data.provider,
        model: data.model,
        error_type: data.error_type,
        can_fallback: data.can_fallback,
        media_items: data.media_items || [],
        executed_tools: data.executed_tools || [],
        thought_chain: data.thought_chain || [],
        client_action: data.client_action || null
      };
    } catch (e: any) {
      return {
        reply: `Connection error with backend server: ${e?.message || e}`,
        error_type: 'network_error',
        can_fallback: true
      };
    }
  }

  /**
   * Probes Ollama connectivity, returns version, latency and installed models.
   */
  async getOllamaStatus(url?: string): Promise<OllamaHealthStatus | null> {
    try {
      const param = url ? `?url=${encodeURIComponent(url)}` : '';
      const res = await fetch(`/api/ai/ollama/status${param}`);
      if (!res.ok) return null;
      const data = await res.json();
      return {
        isAvailable: Boolean(data.is_available),
        version: data.version,
        endpoint: data.endpoint || url || 'http://localhost:11434',
        installedModels: data.installed_models || [],
        latencyMs: data.latency_ms,
        lastChecked: Date.now(),
        error: data.error
      };
    } catch (e: any) {
      return {
        isAvailable: false,
        endpoint: url || 'http://localhost:11434',
        installedModels: [],
        lastChecked: Date.now(),
        error: e?.message || 'Connection failed'
      };
    }
  }

  /**
   * Lists local Ollama models installed with detailed metadata and sizes.
   */
  async getOllamaModels(url?: string): Promise<OllamaModelInfo[]> {
    try {
      const param = url ? `?url=${encodeURIComponent(url)}` : '';
      const res = await fetch(`/api/ai/ollama/models${param}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.models || [];
    } catch {
      return [];
    }
  }

  /**
   * Connects to the real-time SSE stream for a running extraction session.
   */
  subscribeToSessionEvents(
    sessionId: string,
    onEvent: (event: any) => void,
    onCompleted: (album: Album) => void,
    onError: (error: string) => void
  ): () => void {
    const eventSource = new EventSource(`/api/events/${sessionId}`);

    eventSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        onEvent(data);

        // Fix: Server sends "album_complete" instead of just "completed"
        if ((data.type === 'completed' || data.type === 'album_complete') && data.album) {
          const mappedAlbum = this.mapBackendAlbumToFrontend(data.album);
          onCompleted(mappedAlbum);
          eventSource.close();
        } else if (data.type === 'error') {
          onError(data.error || 'Extraction error');
          eventSource.close();
        }
      } catch (err) {
        console.warn('Error parsing SSE event:', err);
      }
    };

    eventSource.onerror = (err) => {
      console.warn('SSE connection error:', err);
    };

    return () => {
      eventSource.close();
    };
  }

  /**
   * Deletes an album from the Python backend and disk.
   */
  async deleteAlbum(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/albums/${sessionId}`, { method: 'DELETE' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Deletes specific images from an album in backend memory and on disk.
   */
  async deleteAlbumImages(sessionId: string, imageIds: string[]): Promise<boolean> {
    try {
      const res = await fetch(`/api/albums/${sessionId}/delete-images`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_ids: imageIds })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Cancels a running extraction job on the Python backend.
   */
  async cancelJob(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/jobs/${sessionId}/cancel`, { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Pauses an active background job on the Python backend.
   */
  async pauseJob(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/jobs/${sessionId}/pause`, { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resumes a paused background job on the Python backend.
   */
  async resumeJob(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/jobs/${sessionId}/resume`, { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Pauses all running extraction jobs in batch on the backend.
   */
  async pauseAllJobs(): Promise<boolean> {
    try {
      const res = await fetch('/api/jobs/pause-all', { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Resumes all paused extraction jobs in batch on the backend.
   */
  async resumeAllJobs(): Promise<boolean> {
    try {
      const res = await fetch('/api/jobs/resume-all', { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Retries all failed, error, or cancelled extraction jobs in batch on the backend.
   */
  async retryAllFailedJobs(): Promise<boolean> {
    try {
      const res = await fetch('/api/jobs/retry-failed', { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Clears all completed, failed, and cancelled jobs from persistent ledger on disk.
   */
  async clearFinishedJobs(): Promise<boolean> {
    try {
      const res = await fetch('/api/jobs/clear-finished', { method: 'POST' });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Renames an album on the Python backend.
   */
  async renameAlbum(sessionId: string, newTitle: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/albums/${sessionId}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Renames an individual image or video inside an album on the backend.
   */
  async renameAlbumImage(sessionId: string, imageIdentifier: string, newTitle: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/albums/${encodeURIComponent(sessionId)}/images/${encodeURIComponent(imageIdentifier)}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Updates an album's cover thumbnail on backend and disk.
   */
  async setAlbumCover(sessionId: string, coverImageUrl: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/albums/${sessionId}/set-cover`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_image_url: coverImageUrl })
      });
      return res.ok;
    } catch (err) {
      console.error('Failed to set album cover:', err);
      return false;
    }
  }

  /**
   * Solicita renovação de URLs de stream expiradas para vídeos no album.
   */
  async refreshAlbumStreams(sessionId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/albums/${encodeURIComponent(sessionId)}/refresh-streams`, {
        method: 'POST',
      });
      if (!res.ok) return false;
      const data = await res.json();
      return data.success === true;
    } catch {
      return false;
    }
  }

  /**
   * Solicita renovação de URLs de stream expiradas para vídeos da Galeria de Vídeos.
   */
  async renewVideoStreams(videoIds?: string[], folder?: string): Promise<{ success: boolean; refreshed: number; failed: number; deletedOnSource?: number }> {
    try {
      const res = await fetch('/api/videos/renew-streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_ids: videoIds, folder })
      });
      if (!res.ok) return { success: false, refreshed: 0, failed: videoIds ? videoIds.length : 0, deletedOnSource: 0 };
      const data = await res.json();
      return {
        success: data.success === true,
        refreshed: data.refreshed || 0,
        failed: data.failed || 0,
        deletedOnSource: data.deleted_on_source || 0
      };
    } catch {
      return { success: false, refreshed: 0, failed: videoIds ? videoIds.length : 0, deletedOnSource: 0 };
    }
  }

  /**
   * Sincroniza metadados reais (tamanhos de arquivo e resoluções) das imagens e vídeos de um álbum.
   */
  async syncAlbumMetadata(sessionId: string): Promise<Album | null> {
    try {
      const res = await fetch(`/api/albums/${encodeURIComponent(sessionId)}/sync-metadata`, {
        method: 'POST',
      });
      if (!res.ok) return null;
      const data = await res.json();
      return this.mapBackendAlbumToFrontend(data);
    } catch {
      return null;
    }
  }


  /**
   * Renova a URL de stream de um vídeo específico pelo candidate_id.
   * Retorna a nova URL ou null em caso de falha.
   */
  async refreshSingleStream(sessionId: string, candidateId: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/albums/${sessionId}/refresh-stream/${encodeURIComponent(candidateId)}`, {
        method: 'POST',
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.new_url || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetches all learned domain rules & inductive patterns from data/knowledge/.
   */
  async fetchDomainPatterns(): Promise<DomainPattern[]> {
    try {
      const res = await fetch('/api/patterns', { cache: 'no-store' });
      if (!res.ok) return [];
      return await res.json();
    } catch {
      return [];
    }
  }

  /**
   * Deletes a domain knowledge pattern from disk.
   */
  async deleteDomainPattern(domain: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/patterns/${encodeURIComponent(domain)}`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fetches all videos and folders from data/videos/ on disk.
   */
  async fetchVideos(healThumbnails: boolean = false): Promise<{ videos: VideoItem[]; folders: VideoFolder[] }> {
    return this.coalesce(`videos:${healThumbnails}`, async () => {
      try {
        const url = healThumbnails ? '/api/videos?heal=true' : '/api/videos';
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) return { videos: [], folders: [] };
        const data = await res.json();
        return {
          videos: (data.videos || []).map((v: any) => {
            const effFolder = (v.folder || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
            const isWeb = Boolean(
              v.source_origin === 'web' ||
              (v.source_origin !== 'pc' && (
                (v.source_url && (v.source_url.startsWith('http://') || v.source_url.startsWith('https://'))) ||
                v.source_id ||
                v.custom_stream_url ||
                effFolder.startsWith('extra') ||
                v.storage_location === 'stream_url'
              ))
            );
            const resolvedOrigin = v.source_origin ? v.source_origin : (isWeb ? 'web' : 'pc');
            return {
              id: v.id,
              title: v.title,
              filename: v.filename,
              folder: v.folder,
              fileSizeBytes: v.file_size_bytes || 0,
              format: v.format || 'MP4',
              isFavorite: v.is_favorite || false,
              createdAt: v.created_at || '',
              relPath: v.rel_path,
              storageLocation: (v.storage_location === 'render_local' ? 'local' : (v.storage_location || 'local')),
              sourceOrigin: resolvedOrigin,
              cloudUrl: v.cloud_url,
              sourceUrl: v.source_url || v.sourceUrl || v.url,
              sourceId: v.source_id,
              url: v.url || v.source_url,
              streamUrl: v.stream_url,
              downloadUrl: v.download_url,
              thumbnailUrl: v.thumbnail_url || `/api/videos/${v.id}/thumbnail`,
              width: v.width || 0,
              height: v.height || 0,
              fps: v.fps || 0,
              durationSeconds: v.duration_seconds || 0,
              introEnd: v.intro_end || 0,
              highlightStart: v.highlight_start || 0,
              highlightEnd: v.highlight_end || 0,
              highlightScore: v.highlight_score || 0,
              highlights: v.highlights || [],
              streamStatus: v.stream_status,
              streamError: v.stream_error
            };
          }),
          folders: (data.folders || []).map((f: any) => ({
            id: f.id,
            name: f.name,
            videoCount: f.video_count || 0,
            totalSizeBytes: f.total_size_bytes || 0
          }))
        };
      } catch (err) {
        console.warn('Backend API not available for videos:', err);
        return { videos: [], folders: [] };
      }
    });
  }

  async uploadVideo(
    file: File,
    folder: string = 'Geral',
    onProgress?: (percent: number, loaded: number, total: number, speed: number) => void
  ): Promise<VideoItem | null> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', folder);

      const startTime = Date.now();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && onProgress) {
          const percent = Math.round((event.loaded / event.total) * 100);
          const elapsedSeconds = (Date.now() - startTime) / 1000;
          const speed = elapsedSeconds > 0 ? event.loaded / elapsedSeconds : 0;
          onProgress(percent, event.loaded, event.total, speed);
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const v = JSON.parse(xhr.responseText);
            resolve({
              id: v.id,
              title: v.title,
              filename: v.filename,
              folder: v.folder,
              fileSizeBytes: v.file_size_bytes || 0,
              format: v.format || 'MP4',
              isFavorite: v.is_favorite || false,
              createdAt: v.created_at || '',
              relPath: v.rel_path,
              storageLocation: v.storage_location || 'render_local',
              sourceOrigin: v.source_origin || 'pc',
              streamUrl: v.stream_url,
              downloadUrl: v.download_url,
              thumbnailUrl: v.thumbnail_url || `/api/videos/${v.id}/thumbnail`
            });
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };

      xhr.onerror = () => resolve(null);
      xhr.ontimeout = () => resolve(null);

      xhr.open('POST', '/api/videos/upload');
      xhr.send(formData);
    });
  }

  async importLocalPath(path: string, folder: string = 'Geral', mode: 'copy' | 'move' = 'copy'): Promise<{ success: boolean; count: number; imported: VideoItem[]; error?: string }> {
    try {
      const res = await fetch('/api/videos/import-local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, folder, mode })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Erro ao importar caminho local' }));
        return { success: false, count: 0, imported: [], error: err.detail };
      }
      const data = await res.json();
      return {
        success: true,
        count: data.count,
        imported: (data.imported || []).map((v: any) => ({
          id: v.id,
          title: v.title,
          filename: v.filename,
          folder: v.folder,
          fileSizeBytes: v.file_size_bytes || 0,
          format: v.format || 'MP4',
          isFavorite: v.is_favorite || false,
          createdAt: v.created_at || '',
          relPath: v.rel_path,
          storageLocation: v.storage_location || 'render_local',
          sourceOrigin: v.source_origin || 'pc',
          streamUrl: v.stream_url,
          downloadUrl: v.download_url,
          thumbnailUrl: v.thumbnail_url || `/api/videos/${v.id}/thumbnail`
        }))
      };
    } catch (err: any) {
      return { success: false, count: 0, imported: [], error: err.message };
    }
  }

  async openVideosFolder(folder: string = 'Geral'): Promise<{ success: boolean; folder?: string }> {
    try {
      const res = await fetch('/api/videos/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder })
      });
      return await res.json();
    } catch {
      return { success: false };
    }
  }

  async addVideoUrl(url: string, folder: string = 'Geral', title?: string, streamOnly: boolean = true): Promise<VideoItem | null> {
    try {
      const res = await fetch('/api/videos/add-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, folder, title, stream_only: streamOnly })
      });
      if (!res.ok) return null;
      const v = await res.json();
      return {
        id: v.id,
        title: v.title,
        filename: v.filename,
        folder: v.folder,
        fileSizeBytes: v.file_size_bytes || 0,
        format: v.format || 'MP4',
        isFavorite: v.is_favorite || false,
        createdAt: v.created_at || '',
        relPath: v.rel_path,
        storageLocation: v.storage_location || (streamOnly ? 'stream_url' : 'render_local'),
        sourceOrigin: v.source_origin || 'web',
        cloudUrl: v.cloud_url,
        streamUrl: v.stream_url,
        downloadUrl: v.download_url,
        thumbnailUrl: v.thumbnail_url || `/api/videos/${v.id}/thumbnail`
      };
    } catch {
      return null;
    }
  }

  async fetchStorageAnalytics(): Promise<any> {
    try {
      const res = await fetch('/api/storage/analytics', { cache: 'no-store' });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  async uploadPhotoAlbum(title: string, files: File[], folder: string = 'Geral'): Promise<any> {
    try {
      const formData = new FormData();
      formData.append('title', title);
      formData.append('folder', folder || 'Geral');
      files.forEach((f) => formData.append('files', f));

      const res = await fetch('/api/albums/upload', {
        method: 'POST',
        body: formData
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Falha no upload' }));
        return { success: false, error: err.detail };
      }
      return await res.json();
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  async createVideoFolder(name: string): Promise<boolean> {
    try {
      const res = await fetch('/api/videos/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async renameVideoFolder(folderName: string, newName: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/videos/folders/${encodeURIComponent(folderName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_name: newName })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async deleteVideoFolder(folderName: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/videos/folders/${encodeURIComponent(folderName)}`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async renameVideo(videoId: string, title: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/videos/${videoId}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async moveVideo(videoId: string, targetFolder: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/videos/${videoId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_folder: targetFolder })
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async toggleVideoFavorite(videoId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/videos/${videoId}/favorite`, {
        method: 'POST'
      });
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.is_favorite;
    } catch {
      return false;
    }
  }

  async toggleAlbumFavorite(albumId: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/albums/${albumId}/favorite`, {
        method: 'POST'
      });
      if (!res.ok) return false;
      const data = await res.json();
      return !!data.is_favorite;
    } catch {
      return false;
    }
  }

  async deleteVideo(videoId: string): Promise<boolean> {

    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: 'DELETE'
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async batchDeleteVideos(videoIds: string[]): Promise<string[]> {
    try {
      const res = await fetch('/api/videos/batch-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_ids: videoIds })
      });
      if (res.ok) {
        const data = await res.json();
        return data.deleted_ids || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  async batchMoveVideos(videoIds: string[], targetFolder: string): Promise<string[]> {
    try {
      const res = await fetch('/api/videos/batch-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_ids: videoIds, target_folder: targetFolder })
      });
      if (res.ok) {
        const data = await res.json();
        return data.moved_ids || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  async uploadVideoToHf(videoId: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/upload-hf`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Erro ao enviar para Hugging Face');
      }
      return data;
    } catch (err: any) {
      return { success: false, message: err?.message || 'Falha na conexão com o servidor' };
    }
  }

  async syncAllVideosToHf(): Promise<{ success: boolean; message: string }> {
    try {
      const res = await fetch('/api/videos/sync-all-to-hf', {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.message || 'Erro ao sincronizar com Hugging Face');
      }
      return data;
    } catch (err: any) {
      return { success: false, message: err?.message || 'Falha na conexão com o servidor' };
    }
  }

  /**
   * Fetches all items stored in the Trash Bin and summary statistics.
   */
  async getTrash(): Promise<{ items: TrashItem[]; stats: TrashStats }> {
    try {
      const res = await fetch('/api/trash', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        return {
          items: data.items || [],
          stats: data.stats || {
            total_items: 0,
            photos_count: 0,
            videos_count: 0,
            albums_count: 0,
            total_size_bytes: 0
          }
        };
      }
    } catch (err) {
      console.error('Failed to fetch trash items:', err);
    }
    return {
      items: [],
      stats: {
        total_items: 0,
        photos_count: 0,
        videos_count: 0,
        albums_count: 0,
        total_size_bytes: 0
      }
    };
  }

  /**
   * Restores selected items from the trash.
   */
  async restoreTrash(trashIds: string[]): Promise<string[]> {
    try {
      const res = await fetch('/api/trash/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trash_ids: trashIds })
      });
      if (res.ok) {
        const data = await res.json();
        return data.restored_ids || [];
      }
      return [];
    } catch (err) {
      console.error('Failed to restore trash items:', err);
      return [];
    }
  }

  /**
   * Permanently deletes selected items from the trash and disk.
   */
  async permanentDeleteTrash(trashIds: string[]): Promise<string[]> {
    try {
      const res = await fetch('/api/trash/permanent-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trash_ids: trashIds })
      });
      if (res.ok) {
        const data = await res.json();
        return data.deleted_ids || [];
      }
      return [];
    } catch (err) {
      console.error('Failed to permanently delete trash items:', err);
      return [];
    }
  }

  /**
   * Completely empties all items from the Trash Bin.
   */
  async emptyTrash(): Promise<boolean> {
    try {
      const res = await fetch('/api/trash/empty', { method: 'POST' });
      return res.ok;
    } catch (err) {
      console.error('Failed to empty trash:', err);
      return false;
    }
  }

  /**
   * Maps Python backend Album schema to Frontend Album model.
   */
  private mapBackendAlbumToFrontend(raw: any): Album {
    const sourceDomain = raw.source_page
      ? raw.source_page.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0]
      : 'web-source';

    const getSafeUrl = (url: string, width?: number) => {
      if (!url || !url.startsWith('http')) return url;
      if (url.includes('unsplash.com')) return url;
      // Imagens públicas genéricas externas (ex: placeholders unsplash) não precisam de proxy
      // Toda e qualquer imagem da web de qualquer site passa pelo proxy para evitar CORS, hotlink e garantir cache SSD
      const wParam = width ? `&w=${width}` : '';
      return `/api/proxy-image?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(raw.source_page || url)}${wParam}`;
    };

    const getSafeVideoUrl = (url?: string) => {
      if (!url || !url.startsWith('http')) return url;
      let defaultRef = '';
      try {
        defaultRef = new URL(raw.source_page || (raw as any).url || url).origin;
      } catch {
        defaultRef = '';
      }
      const ref = raw.source_page || (raw as any).url || defaultRef;
      return `/api/proxy-video-stream?url=${encodeURIComponent(url)}&referer=${encodeURIComponent(ref)}`;
    };

    let hasVideoTransport = false;
    const images: ImageItem[] = (raw.images || []).map((img: any, idx: number) => {
      let orig = img.original_url || img.src || img.thumbnail_url;
      let thumb = img.thumbnail_url || img.src || img.original_url;

      // Se a thumbnail for o pixel falso de lazy-load (ex: 1px.png), usa a imagem original
      if (thumb && (thumb.includes('1px.png') || thumb.includes('1px.gif') || thumb.includes('blank.gif'))) {
        thumb = orig || thumb;
      }

      let w = img.width || 0;
      let h = img.height || 0;

      // Se a resolução for 0x0, tenta inferir de caminhos conhecidos como /1280/ ou /1920/
      if (w === 0 || h === 0) {
        const checkUrl = orig || thumb || '';
        if (checkUrl.includes('/1280/') || checkUrl.includes('1280')) {
          w = 1280;
          h = 1920; // Proporção padrão vertical de ensaio fotográfico
        } else if (checkUrl.includes('/1920/') || checkUrl.includes('1920')) {
          w = 1920;
          h = 1080;
        } else if (checkUrl.includes('/1080/') || checkUrl.includes('1080')) {
          w = 1080;
          h = 1920;
        }
      }

      const aspect = (w > 0 && h > 0) ? (w > h ? '16:9' : w < h ? '2:3' : '1:1') : '2:3';
      const inferredExtension = inferMediaFormat(orig);
      const formats: ImageItem['format'][] = ['jpeg', 'png', 'apng', 'webp', 'avif', 'gif', 'mp4', 'webm', 'mov', 'mkv', 'm4v', 'm3u8', 'avi'];
      const normalizedExtension = inferredExtension === 'jpg' ? 'jpeg' : inferredExtension;
      const inferredFormat = formats.includes(normalizedExtension as ImageItem['format']) ? normalizedExtension : undefined;
      const declaredFormat = (img.format || '').toLowerCase().split('/').pop();
      const fmt = (!img.animation_checked && inferredFormat) || declaredFormat || inferredFormat || 'jpeg';
      const validFormat: ImageItem['format'] = formats.includes(fmt as ImageItem['format']) ? fmt as ImageItem['format'] : 'jpeg';

      const isResolved = !!(img.original_url && img.resolution_method && img.resolution_method !== 'none' && img.validation_status !== 'UNRESOLVED');
      const methodLabel = img.resolution_method === 'individual_page'
        ? 'Individual Page (HD)'
        : img.resolution_method === 'verified_cdn_candidate'
        ? 'CDN Original Nativo'
        : img.resolution_method === 'speculative_probe'
        ? 'Neural Induction'
        : isResolved
        ? 'Original HD'
        : 'Miniatura DOM';

      // Authentic pixel sampling: eradicated artificial palettePool completely
      let assignedPalette: string[] = [];
      if (img.color_palette && Array.isArray(img.color_palette) && img.color_palette.length > 0) {
        assignedPalette = img.color_palette;
        if (orig) colorPaletteCache.set(orig, assignedPalette);
        if (thumb) colorPaletteCache.set(thumb, assignedPalette);
      } else if (orig && colorPaletteCache.has(orig)) {
        assignedPalette = colorPaletteCache.get(orig)!;
      } else if (thumb && colorPaletteCache.has(thumb)) {
        assignedPalette = colorPaletteCache.get(thumb)!;
      }

      // Media type resolution
      const mediaHints = {
        mediaType: img.media_type as ImageItem['mediaType'],
        isAnimated: !!img.is_animated,
        animationChecked: !!img.animation_checked,
        format: validFormat,
        rawOriginalUrl: orig,
        videoStreamUrl: img.video_stream_url
      };
      const transportIsVideo = isVideoMedia(mediaHints);
      hasVideoTransport ||= transportIsVideo;
      const category = getMediaCategory(mediaHints);
      const mediaType: 'image' | 'video' | 'gif' = transportIsVideo ? 'video' : category === 'gif' ? 'gif' : 'image';
      const isAnimated = category === 'gif';
      const rawStream = img.video_stream_url || (transportIsVideo ? unwrapMediaSource(orig) : undefined);
      const videoUrl = rawStream ? getSafeVideoUrl(unwrapMediaSource(rawStream)) : undefined;
      const posterUrl = img.poster_url ? getSafeUrl(img.poster_url) : (thumb && mediaType === 'video' ? getSafeUrl(thumb) : undefined);
      const durationSecs = img.duration_seconds || undefined;

      const safeOrigUrl = mediaType === 'video' ? (videoUrl || orig) : getSafeUrl(orig);
      const safePreviewUrl = mediaType === 'video' ? (posterUrl || getSafeUrl(thumb)) : getSafeUrl(orig);

      // Clean page/album title for clean fallbacks
      const baseCleanTitle = (raw.title || raw.original_title || '')
        .replace(/\s*[-–|•]\s*(?:watch online.*|[a-zA-Z0-9_-]+\s+video\s+search|[a-zA-Z0-9_-]+\.[a-zA-Z]{2,}).*$/i, '')
        .trim() || raw.title || 'Media';

      let resolvedTitle = '';
      if (img.title && !/^(vídeo|video|foto|photo|imagem|image|gif)\s*#?\d+$/i.test(img.title.trim())) {
        resolvedTitle = img.title.trim();
      } else {
        const qualitySuffix = (w >= 3840 || h >= 2160) ? '4K UHD' :
          (w >= 2560 || h >= 1440) ? '1440p' :
          (w >= 1920 || h >= 1080) ? '1080p FHD' :
          (w >= 1280 || h >= 720) ? '720p HD' :
          (h >= 480) ? '480p' : '';

        if (mediaType === 'video') {
          const partLabel = (raw.images && raw.images.length > 1) ? ` - #${idx + 1}` : '';
          const qLabel = qualitySuffix ? ` (${qualitySuffix})` : '';
          resolvedTitle = `${baseCleanTitle}${partLabel}${qLabel}`;
        } else if (mediaType === 'gif') {
          resolvedTitle = `${baseCleanTitle} (GIF #${idx + 1})`;
        } else {
          resolvedTitle = `${baseCleanTitle} - #${idx + 1}`;
        }
      }

      return {
        id: `real-img-${raw.session_id || 'album'}-${idx}`,
        title: resolvedTitle,
        originalUrl: safeOrigUrl,
        thumbnailUrl: getSafeUrl(thumb, 360),
        previewUrl: safePreviewUrl,
        rawOriginalUrl: orig,
        rawThumbnailUrl: thumb,
        width: w,
        height: h,
        aspectRatio: aspect,
        megapixels: (w > 0 && h > 0) ? Math.round(((w * h) / 1000000) * 10) / 10 : 0,
        fileSizeBytes: img.file_size || 0,
        format: validFormat,
        isResolvedOriginal: isResolved,
        status: isResolved ? 'resolved' : 'unresolved',
        aestheticScore: Math.round((8.0 + (idx % 19) * 0.1) * 10) / 10,
        sharpnessScore: isResolved ? 95 : 60,
        colorPalette: assignedPalette,
        tags: [methodLabel, sourceDomain.split('.')[0] || 'Web'],
        mediaType,
        isAnimated,
        animationChecked: !!img.animation_checked,
        videoUrl,
        posterUrl,
        durationSeconds: durationSecs,
        candidateId: img.candidate_id || undefined,
        sourcePage: (img as any).source_page || raw.source_page || (raw as any).url || undefined,
        videoStreamUrl: (img as any).video_stream_url || (mediaType === 'video' ? orig : undefined),
      };
    });

    const cover = images[0]?.thumbnailUrl || 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800';
    const deterministicFallback = raw.file_mtime ? new Date(raw.file_mtime * 1000).toISOString() : '2026-01-01T00:00:00.000Z';
    const createdAt = raw.created_at || raw.metadata?.created_at || raw.metadata?.saved_at || raw.started_at || raw.timestamp || deterministicFallback;
    const updatedAt = raw.updated_at || raw.metadata?.updated_at || raw.metadata?.saved_at || createdAt;


    cacheAlbumVideoTransport(images, hasVideoTransport);
    const mediaSummary = getAlbumMediaSummary({ images });

    const isLocalOrigin = raw.source_origin === 'local' ||
      raw.source_page === 'Upload Local' ||
      (raw.source_page && raw.source_page.startsWith('local://')) ||
      (raw.session_id && (raw.session_id.startsWith('manual-') || raw.session_id.startsWith('local-')));

    const isPlaceholder = (u?: string) => {
      if (!u) return true;
      const lower = u.toLowerCase();
      return lower.includes('1px.png') || lower.includes('1px.gif') || lower.includes('blank.gif') || lower.includes('spacer.gif');
    };

    // Find the first genuine media item that isn't a 1px transparent placeholder
    const validFirstImage = images.find(img => !isPlaceholder(img.originalUrl) || !isPlaceholder(img.thumbnailUrl));
    const fallbackCoverUrl = validFirstImage ? (
      !isPlaceholder(validFirstImage.rawOriginalUrl) ? validFirstImage.rawOriginalUrl :
      !isPlaceholder(validFirstImage.originalUrl) ? validFirstImage.originalUrl :
      !isPlaceholder(validFirstImage.rawThumbnailUrl) ? validFirstImage.rawThumbnailUrl :
      validFirstImage.thumbnailUrl
    ) : '';

    const effectiveCoverUrl = (!isPlaceholder(raw.cover_image_url) ? raw.cover_image_url : fallbackCoverUrl) || '';

    return {
      id: raw.session_id || raw.album_id || `album-${Date.now()}`,
      title: raw.title || raw.original_title || 'Extracted Album',
      sourceUrl: raw.source_page || '',
      sourceDomain: sourceDomain,
      createdAt: createdAt,
      updatedAt: updatedAt,
      coverImage: getSafeUrl(effectiveCoverUrl, 360),
      rawCoverImage: effectiveCoverUrl || undefined,
      coverColorPalette: (raw.cover_color_palette && Array.isArray(raw.cover_color_palette) && raw.cover_color_palette.length > 0)
        ? raw.cover_color_palette
        : (images[0]?.colorPalette?.length ? images[0].colorPalette : undefined),
      imageCount: raw.total_images || images.length || 0,
      resolvedOriginalCount: images.length,
      totalSizeBytes: images.reduce((acc, i) => acc + i.fileSizeBytes, 0),
      aiModel: raw.metadata?.model_used || 'Qwen 2.5:32b',
      tags: Array.from(new Set([
        'Original',
        sourceDomain.split('.')[0] || 'Web',
        'Extraction',
        ...normalizeAlbumMediaTags(raw.tags || [], mediaSummary.hasGifs)
      ])),
      images: images,
      extractionMode: 'ai_react',
      durationSeconds: raw.metadata?.duration || 12.4,
      mediaType: mediaSummary.mediaType,
      hasGifs: mediaSummary.hasGifs,
      gifCount: mediaSummary.gifCount,
      sourceOrigin: isLocalOrigin ? 'local' : 'remote',
      folder: raw.folder || raw.metadata?.folder || 'Geral',
      isFavorite: raw.is_favorite ?? raw.isFavorite ?? raw.metadata?.is_favorite ?? false,
      syncStats: raw.sync_stats || raw.syncStats,
      syncMessage: raw.sync_message || raw.syncMessage
    };
  }

  /**
   * Saves an extracted web video to the local Video Gallery via background job.
   */
  async saveExtractedVideoToGallery(
    videoUrl: string,
    title?: string,
    folder?: string,
    sourceUrl?: string,
    thumbnailUrl?: string,
    streamOnly: boolean = true
  ): Promise<{ success: boolean; job_id?: string; video?: any; error?: string }> {
    try {
      const res = await fetch('/api/extractor/save-video-to-gallery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_url: videoUrl,
          title,
          folder: folder || 'Extraídos',
          source_url: sourceUrl,
          thumbnail_url: thumbnailUrl,
          stream_only: streamOnly
        })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.detail || 'Error saving video' };
      return { success: true, job_id: data.job_id, video: data.video };
    } catch (err) {
      return { success: false, error: 'Connection to server failed' };
    }
  }

  /**
   * Scans a web page to extract all listed video cards across current and subsequent pagination pages.
   */
  async scanPageForVideos(url: string, maxItems: number = 2000, maxPages?: number): Promise<ScanPageVideosResponse & { error?: string }> {
    try {
      const payload: any = { url, max_items: maxItems };
      if (typeof maxPages === 'number' && maxPages > 0) {
        payload.max_pages = maxPages;
      }
      const res = await fetch('/api/video-scraper/scan-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.detail || 'Error scanning page', page_title: '', suggested_folder: '', total_found: 0, album_id: '', videos: [] };
      return data;
    } catch (err: any) {
      return { success: false, error: err?.message || 'Failed to connect to server to scan page', page_title: '', suggested_folder: '', total_found: 0, album_id: '', videos: [] };
    }
  }

  /**
   * Scans a web page using real-time streaming (SSE) to deliver video batches dynamically as each page is crawled.
   * If streaming encounters any connection issue, it automatically and safely falls back to standard HTTP scan.
   */
  async scanPageForVideosStream(
    url: string,
    maxItems: number = 5000,
    maxPages?: number,
    onPageDiscovered?: (pageData: {
      page_number: number;
      pages_scanned: number;
      page_title: string;
      suggested_folder: string;
      new_videos: any[];
      total_found: number;
      main_count: number;
      recommended_count: number;
      already_saved_count: number;
      new_videos_count: number;
    }) => void,
    onComplete?: (result: ScanPageVideosResponse) => void,
    onError?: (error: string) => void,
    abortSignal?: AbortSignal
  ): Promise<ScanPageVideosResponse & { error?: string }> {
    try {
      const payload: any = { url, max_items: maxItems };
      if (typeof maxPages === 'number' && maxPages > 0) {
        payload.max_pages = maxPages;
      }

      const response = await fetch('/api/video-scraper/scan-page-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortSignal
      });

      if (!response.ok || !response.body) {
        // Fallback to standard endpoint
        return this.scanPageForVideos(url, maxItems, maxPages);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedVideos: any[] = [];
      let finalResult: ScanPageVideosResponse | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.type === 'page') {
              if (data.new_videos && data.new_videos.length > 0) {
                accumulatedVideos = [...accumulatedVideos, ...data.new_videos];
              }
              onPageDiscovered?.(data);
            } else if (data.type === 'complete') {
              finalResult = {
                success: true,
                page_title: data.page_title || '',
                suggested_folder: data.suggested_folder || '',
                total_found: data.total_found || accumulatedVideos.length,
                main_count: data.main_count || 0,
                recommended_count: data.recommended_count || 0,
                already_saved_count: data.already_saved_count || 0,
                new_videos_count: data.new_videos_count || 0,
                album_id: '',
                pages_scanned: data.pages_scanned || 1,
                videos: data.videos || accumulatedVideos
              };
              onComplete?.(finalResult);
            } else if (data.type === 'error') {
              onError?.(data.error || 'Error during page scan');
            }
          } catch (e) {
            console.warn('Error parsing stream event line:', jsonStr, e);
          }
        }
      }

      if (finalResult) return finalResult;
      if (accumulatedVideos.length > 0) {
        return {
          success: true,
          page_title: '',
          suggested_folder: '',
          total_found: accumulatedVideos.length,
          album_id: '',
          videos: accumulatedVideos
        };
      }
      return this.scanPageForVideos(url, maxItems, maxPages);
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw err;
      }
      console.warn('Stream encountered issue, falling back to standard scan:', err);
      return this.scanPageForVideos(url, maxItems, maxPages);
    }
  }

  /**
   * Enqueues batch video downloads to the background engine with controlled concurrency.
   */
  async batchSaveVideos(
    videos: any[],
    folder: string = 'Extraídos',
    maxConcurrency: number = 2,
    skipExisting: boolean = true,
    streamOnly: boolean = true
  ): Promise<{
    success: boolean;
    total_queued?: number;
    total_skipped?: number;
    skipped_items?: any[];
    job_ids?: string[];
    folder?: string;
    message?: string;
    error?: string;
    stream_only?: boolean;
  }> {
    try {
      const res = await fetch('/api/video-scraper/batch-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videos,
          folder: folder || 'Extraídos',
          max_concurrency: maxConcurrency,
          skip_existing: skipExisting,
          stream_only: streamOnly
        })
      });
      const data = await res.json();
      if (!res.ok) return { success: false, error: data.detail || 'Error batch saving videos' };
      return data;

    } catch (err) {
      return { success: false, error: 'Falha ao conectar ao servidor para download em lote' };
    }
  }

  /**
   * Obtém o status de conexão e chaves mascaradas com segurança.
   */
  async getKeysStatus(): Promise<{
    gemini: { is_set: boolean; masked_key: string; is_connected: boolean; error: string | null };
    huggingface: { is_set: boolean; masked_token: string; repo_id: string; is_connected: boolean; error?: string | null; auto_cloud_sync?: boolean };
  } | null> {
    try {
      const res = await fetch('/api/settings/keys');
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Atualiza as chaves com segurança e revalida conexões em tempo real.
   */
  async updateKeys(data: {
    gemini_api_key?: string;
    hf_token?: string;
    hf_dataset_repo?: string;
    auto_cloud_sync?: boolean;
  }): Promise<{
    gemini: { is_set: boolean; masked_key: string; is_connected: boolean; error: string | null };
    huggingface: { is_set: boolean; masked_token: string; repo_id: string; is_connected: boolean; error?: string | null; auto_cloud_sync?: boolean };
  } | null> {
    try {
      const res = await fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }

  /**
   * Sincroniza e restaura sob demanda todos os álbuns, jobs e vídeos do Hugging Face.
   */
  async syncHfData(): Promise<{ success: boolean; message: string; details?: any; error?: string }> {
    try {
      const res = await fetch('/api/settings/hf/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, message: data.detail || 'Erro na sincronização', error: data.detail };
      }
      return data;
    } catch (err: any) {
      return { success: false, message: err.message || 'Erro de conexão', error: err.message };
    }
  }

  /**
   * Pré-visualiza as imagens de um álbum específico no Multi-Album antes do salvamento/download.
   */
  async previewMultiAlbum(
    album: { title: string; url: string; thumbnail_url?: string | null; source_type?: string }
  ): Promise<{
    success: boolean;
    title: string;
    url: string;
    total: number;
    images: MultiAlbumPreviewImage[];
    error?: string;
  }> {
    try {
      const res = await fetch('/api/multi-album/preview-album', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(album),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to preview album images');
      }
      const data = await res.json();
      const rawImages = Array.isArray(data.images) ? data.images : [];
      const referer = album.url || '';
      const getSafeUrl = (u?: string) => {
        if (!u) return '';
        if (u.startsWith('http') && !u.includes('unsplash.com')) {
          return `/api/proxy-image?url=${encodeURIComponent(u)}&referer=${encodeURIComponent(referer)}`;
        }
        return u;
      };
      const mappedImages: MultiAlbumPreviewImage[] = rawImages.map((img: any, idx: number) => ({
        id: img.id || `img-${idx + 1}`,
        position: img.position || idx + 1,
        original_url: img.original_url || img.thumbnail_url || '',
        thumbnail_url: getSafeUrl(img.thumbnail_url || img.original_url || ''),
        width: img.width || 0,
        height: img.height || 0,
        file_size_bytes: img.file_size_bytes || 0,
        media_type: getMediaCategory({
          mediaType: img.media_type,
          isAnimated: !!img.is_animated,
          animationChecked: !!img.animation_checked,
          rawOriginalUrl: img.original_url,
          format: (img.format || '').toLowerCase() as ImageItem['format']
        }) === 'gif' ? 'gif' : 'photo',
        filename: img.filename || `image_${idx + 1}.jpg`,
      }));
      return {
        success: true,
        title: data.title || album.title,
        url: data.url || album.url,
        total: mappedImages.length,
        images: mappedImages,
      };
    } catch (err: any) {
      return {
        success: false,
        title: album.title,
        url: album.url,
        total: 0,
        images: [],
        error: err.message || 'Server connection error',
      };
    }
  }

  /**
   * Envia múltiplos álbuns selecionados para extração e salvamento na biblioteca interna.
   */
  async batchSaveMultiAlbums(
    albums: Array<{ title: string; url: string; thumbnail_url?: string | null; source_type?: string; selected_image_urls?: string[] }>,
    folder?: string
  ): Promise<{ success: boolean; queued: number; target_folder?: string; message: string }> {
    try {
      const res = await fetch('/api/multi-album/batch-save-to-library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albums, folder: folder || 'Geral' }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save albums to library');
      }
      const data = await res.json();
      return {
        success: true,
        queued: data.queued || albums.length,
        target_folder: data.target_folder || folder || 'Geral',
        message: data.message || 'Albums queued successfully!'
      };
    } catch (err: any) {
      return { success: false, queued: 0, message: err.message || 'Server connection error' };
    }
  }

  // ==========================================
  // Album Folders Management
  // ==========================================
  async fetchAlbumFolders(): Promise<{ folders: AlbumFolder[]; total_albums: number }> {
    try {
      const res = await fetch('/api/albums/folders', { cache: 'no-store' });
      if (!res.ok) return { folders: [{ id: 'Geral', name: 'Geral', count: 0 }], total_albums: 0 };
      return await res.json();
    } catch {
      return { folders: [{ id: 'Geral', name: 'Geral', count: 0 }], total_albums: 0 };
    }
  }

  async createAlbumFolder(name: string): Promise<{ success: boolean; folders: AlbumFolder[]; total_albums: number }> {
    try {
      const res = await fetch('/api/albums/folders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Falha ao criar pasta');
      return await res.json();
    } catch {
      return { success: false, folders: [], total_albums: 0 };
    }
  }

  async renameAlbumFolder(oldName: string, newName: string): Promise<{ success: boolean; folders: AlbumFolder[]; total_albums: number }> {
    try {
      const res = await fetch('/api/albums/folders/rename', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_name: oldName, new_name: newName }),
      });
      if (!res.ok) throw new Error('Falha ao renomear pasta');
      return await res.json();
    } catch {
      return { success: false, folders: [], total_albums: 0 };
    }
  }

  async deleteAlbumFolder(name: string): Promise<{ success: boolean; folders: AlbumFolder[]; total_albums: number }> {
    try {
      const res = await fetch('/api/albums/folders/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Falha ao excluir pasta');
      return await res.json();
    } catch {
      return { success: false, folders: [], total_albums: 0 };
    }
  }

  async moveAlbumsToFolder(albumIds: string[], targetFolder: string): Promise<{ success: boolean; moved: number; folders: AlbumFolder[] }> {
    try {
      const res = await fetch('/api/albums/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ album_ids: albumIds, target_folder: targetFolder }),
      });
      if (!res.ok) throw new Error('Failed to move albums');
      return await res.json();
    } catch {
      return { success: false, moved: 0, folders: [] };
    }
  }

  /**
   * Dispara o download de múltiplos álbuns em arquivo ZIP (individual ou unificado).
   */
  async batchDownloadMultiAlbumsZip(
    albums: Array<{ title: string; url: string; thumbnail_url?: string | null; selected_image_urls?: string[] }>,
    format: 'unified' | 'individual' = 'unified'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch('/api/multi-album/batch-download-zip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albums, format }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to generate albums ZIP file.');
      }
      
      const blob = await res.blob();
      const contentDisposition = res.headers.get('content-disposition');
      let filename = format === 'unified' ? `albuns_unificados_${Date.now()}.zip` : `${albums[0]?.title || 'album'}.zip`;
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message || 'Erro ao processar download do ZIP' };
    }
  }

  /**
   * Baixa um único álbum em arquivo ZIP direto (respeitando subconjunto de imagens se houver).
   */
  triggerSingleAlbumZipDownload(url: string, title?: string, selectedImageUrls?: string[]): void {
    if (selectedImageUrls && selectedImageUrls.length > 0) {
      // Utiliza POST via batchDownloadMultiAlbumsZip no formato individual para não estourar limite de URL em GET
      this.batchDownloadMultiAlbumsZip(
        [{ title: title || 'album', url, selected_image_urls: selectedImageUrls }],
        'individual'
      );
      return;
    }
    const params = new URLSearchParams({ url });
    if (title) params.append('title', title);
    const downloadUrl = `/api/multi-album/download-single-zip?${params.toString()}`;
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Dispara a rotina de reparo e atualização de paletas cromáticas salvas no disco.
   * Utiliza visão computacional Pillow (160x160) com 8 cores perceptuais.
   */
  async repairAllAlbumPalettes(force: boolean = false, limit?: number): Promise<{
    success: boolean;
    scanned_albums: number;
    repaired_albums: number;
    repaired_images: number;
    message: string;
    error?: string;
  }> {
    try {
      const params = new URLSearchParams();
      if (force) params.append('force', 'true');
      if (limit) params.append('limit', limit.toString());
      const query = params.toString() ? `?${params.toString()}` : '';
      const res = await fetch(`/api/albums/repair-all-palettes${query}`, {
        method: 'POST'
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (err: any) {
      return {
        success: false,
        scanned_albums: 0,
        repaired_albums: 0,
        repaired_images: 0,
        message: 'Falha ao reparar paletas',
        error: err.message || String(err)
      };
    }
  }

  /**
   * Salva um arquivo diretamente na pasta Downloads do computador.
   * Contorna bloqueios de download do WebView2 no executável Windows.
   */

  async downloadToDisk(url: string, filename?: string, openFolder: boolean = false): Promise<{ success: boolean; filePath?: string; filename?: string; error?: string }> {
    try {
      const res = await fetch('/api/system/download-to-disk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, filename, open_folder: openFolder })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return { success: false, error: err.detail || 'Erro ao salvar arquivo no disco.' };
      }
      const data = await res.json();
      return { success: true, filePath: data.file_path, filename: data.filename };
    } catch (err: any) {
      return { success: false, error: err.message || 'Connection failure to local backend.' };
    }
  }
}

export const backendApi = new BackendApiClient();
