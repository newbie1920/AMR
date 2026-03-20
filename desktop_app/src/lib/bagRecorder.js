/**
 * bagRecorder.js
 * ==============
 * Bag Record/Playback System — thay thế ros2 bag record / ros2 bag play
 *
 * Records topic messages to IndexedDB with timestamps for later playback.
 *
 * Features:
 *   - Record specific topics or all topics
 *   - Playback with speed control (0.25x, 0.5x, 1x, 2x, 4x)
 *   - Pause, resume, seek to timestamp
 *   - Export to JSON
 *   - Browse saved bags
 *
 * USAGE:
 *   import bagRecorder from './bagRecorder';
 *
 *   // Record
 *   bagRecorder.startRecording(['/scan', '/odom', '/tf']);
 *   // ... later
 *   bagRecorder.stopRecording(); // returns bagId
 *
 *   // Playback
 *   await bagRecorder.loadBag(bagId);
 *   bagRecorder.play();
 *   bagRecorder.setSpeed(2.0);
 *   bagRecorder.pause();
 *   bagRecorder.seekTo(0.5); // 50% through
 */

import topicManager from './topicManager';

// ─── IndexedDB Helpers ───────────────────────────────────────────────────────
const DB_NAME = 'amr_bag_storage';
const DB_VERSION = 1;
const STORE_BAGS = 'bags';
const STORE_MESSAGES = 'messages';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_BAGS)) {
                db.createObjectStore(STORE_BAGS, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
                const store = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id', autoIncrement: true });
                store.createIndex('bagId', 'bagId', { unique: false });
                store.createIndex('bagId_timestamp', ['bagId', 'timestamp'], { unique: false });
            }
        };
    });
}

async function dbPut(storeName, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.put(data);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGetAll(storeName) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbGetByIndex(storeName, indexName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const index = store.index(indexName);
        const req = index.getAll(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbDelete(storeName, key) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const req = store.delete(key);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

// ─── Bag Recorder ────────────────────────────────────────────────────────────
class BagRecorder {
    constructor() {
        // Recording state
        this._isRecording = false;
        this._recordingBagId = null;
        this._recordingStartTime = null;
        this._recordingTopics = [];
        this._subscriptions = [];    // topic unsubscribe functions
        this._messageBuffer = [];    // buffered messages before flush
        this._bufferFlushInterval = null;
        this._messageCount = 0;

        // Playback state
        this._isPlaying = false;
        this._isPaused = false;
        this._loadedBag = null;
        this._loadedMessages = [];
        this._playbackSpeed = 1.0;
        this._playbackIndex = 0;
        this._playbackStartTime = 0;
        this._playbackTimer = null;
        this._playbackProgress = 0;   // 0 to 1

        // Listeners
        this._listeners = [];
    }

    // ─── Recording API ───────────────────────────────────────────────────────

    /**
     * Start recording topics.
     * Tương đương: ros2 bag record /topic1 /topic2
     * @param {string[]} topics - Topics to record (empty = all)
     */
    async startRecording(topics = []) {
        if (this._isRecording) {
            console.warn('[BagRecorder] Already recording.');
            return;
        }

        const bagId = `bag_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this._recordingBagId = bagId;
        this._recordingStartTime = Date.now();
        this._isRecording = true;
        this._messageCount = 0;
        this._messageBuffer = [];

        // Determine topics to record
        if (topics.length === 0) {
            // Record all active topics
            this._recordingTopics = topicManager.listTopics().map(t => t.name);
        } else {
            this._recordingTopics = [...topics];
        }

        // Subscribe to each topic
        for (const topicName of this._recordingTopics) {
            const unsub = topicManager.echoTopic(topicName, (msg) => {
                this._messageBuffer.push({
                    bagId,
                    topic: topicName,
                    timestamp: Date.now(),
                    relativeTime: Date.now() - this._recordingStartTime,
                    data: msg,
                });
                this._messageCount++;
            });
            this._subscriptions.push(unsub);
        }

        // Flush buffer periodically (every 500ms)
        this._bufferFlushInterval = setInterval(() => this._flushBuffer(), 500);

        // Save bag metadata
        await dbPut(STORE_BAGS, {
            id: bagId,
            name: `Recording ${new Date().toLocaleString()}`,
            startTime: this._recordingStartTime,
            endTime: null,
            topics: this._recordingTopics,
            messageCount: 0,
            duration: 0,
            size: 0,
        });

        console.log(`[BagRecorder] Recording started: ${bagId} (${this._recordingTopics.length} topics)`);
        this._notify();
    }

    /**
     * Stop recording.
     * @returns {string} bagId
     */
    async stopRecording() {
        if (!this._isRecording) return null;

        // Unsubscribe from all topics
        this._subscriptions.forEach(unsub => unsub());
        this._subscriptions = [];

        // Final flush
        await this._flushBuffer();
        if (this._bufferFlushInterval) {
            clearInterval(this._bufferFlushInterval);
            this._bufferFlushInterval = null;
        }

        const bagId = this._recordingBagId;
        const duration = Date.now() - this._recordingStartTime;

        // Update bag metadata
        await dbPut(STORE_BAGS, {
            id: bagId,
            name: `Recording ${new Date(this._recordingStartTime).toLocaleString()}`,
            startTime: this._recordingStartTime,
            endTime: Date.now(),
            topics: this._recordingTopics,
            messageCount: this._messageCount,
            duration,
            size: this._messageCount * 200, // approximate bytes
        });

        this._isRecording = false;
        this._recordingBagId = null;
        this._recordingStartTime = null;
        this._recordingTopics = [];
        this._messageCount = 0;

        console.log(`[BagRecorder] Recording stopped: ${bagId} (${duration}ms)`);
        this._notify();
        return bagId;
    }

    async _flushBuffer() {
        if (this._messageBuffer.length === 0) return;
        const batch = this._messageBuffer.splice(0);
        for (const msg of batch) {
            await dbPut(STORE_MESSAGES, msg);
        }
    }

    // ─── Playback API ────────────────────────────────────────────────────────

    /**
     * Load a bag for playback.
     */
    async loadBag(bagId) {
        this.stop(); // stop current playback

        const bags = await dbGetAll(STORE_BAGS);
        this._loadedBag = bags.find(b => b.id === bagId);
        if (!this._loadedBag) throw new Error(`Bag '${bagId}' not found.`);

        this._loadedMessages = await dbGetByIndex(STORE_MESSAGES, 'bagId', bagId);
        this._loadedMessages.sort((a, b) => a.relativeTime - b.relativeTime);
        this._playbackIndex = 0;
        this._playbackProgress = 0;

        console.log(`[BagRecorder] Loaded bag: ${bagId} (${this._loadedMessages.length} messages)`);
        this._notify();
    }

    /**
     * Play loaded bag.
     * Messages are published to topicManager at recorded timing × speed.
     */
    play() {
        if (!this._loadedBag || this._loadedMessages.length === 0) return;
        if (this._isPlaying && !this._isPaused) return;

        this._isPlaying = true;
        this._isPaused = false;
        this._playbackStartTime = performance.now() -
            (this._loadedMessages[this._playbackIndex]?.relativeTime || 0) / this._playbackSpeed;

        this._scheduleNext();
        this._notify();
    }

    /**
     * Pause playback.
     */
    pause() {
        this._isPaused = true;
        if (this._playbackTimer) {
            clearTimeout(this._playbackTimer);
            this._playbackTimer = null;
        }
        this._notify();
    }

    /**
     * Stop playback and reset.
     */
    stop() {
        this._isPlaying = false;
        this._isPaused = false;
        this._playbackIndex = 0;
        this._playbackProgress = 0;
        if (this._playbackTimer) {
            clearTimeout(this._playbackTimer);
            this._playbackTimer = null;
        }
        this._notify();
    }

    /**
     * Seek to a position (0.0 to 1.0).
     */
    seekTo(fraction) {
        if (!this._loadedMessages.length) return;
        fraction = Math.max(0, Math.min(1, fraction));
        this._playbackIndex = Math.floor(fraction * (this._loadedMessages.length - 1));
        this._playbackProgress = fraction;

        if (this._isPlaying && !this._isPaused) {
            if (this._playbackTimer) clearTimeout(this._playbackTimer);
            this._playbackStartTime = performance.now() -
                (this._loadedMessages[this._playbackIndex]?.relativeTime || 0) / this._playbackSpeed;
            this._scheduleNext();
        }
        this._notify();
    }

    /**
     * Set playback speed (e.g., 0.25, 0.5, 1.0, 2.0, 4.0).
     */
    setSpeed(speed) {
        const currentRelTime = this._loadedMessages[this._playbackIndex]?.relativeTime || 0;
        this._playbackSpeed = speed;
        if (this._isPlaying && !this._isPaused) {
            this._playbackStartTime = performance.now() - currentRelTime / this._playbackSpeed;
            if (this._playbackTimer) clearTimeout(this._playbackTimer);
            this._scheduleNext();
        }
        this._notify();
    }

    _scheduleNext() {
        if (this._playbackIndex >= this._loadedMessages.length) {
            this._isPlaying = false;
            this._playbackProgress = 1;
            this._notify();
            return;
        }

        const msg = this._loadedMessages[this._playbackIndex];
        const targetTime = this._playbackStartTime + msg.relativeTime / this._playbackSpeed;
        const delay = Math.max(0, targetTime - performance.now());

        this._playbackTimer = setTimeout(() => {
            // Publish the message to the topic system
            topicManager.publish(msg.topic, msg.data);

            this._playbackIndex++;
            this._playbackProgress = this._playbackIndex / this._loadedMessages.length;
            this._notify();

            if (this._playbackIndex < this._loadedMessages.length) {
                this._scheduleNext();
            } else {
                this._isPlaying = false;
                this._playbackProgress = 1;
                this._notify();
            }
        }, delay);
    }

    // ─── Bag Management API ──────────────────────────────────────────────────

    /**
     * List all recorded bags.
     * Tương đương: ros2 bag info <bag>
     */
    async listBags() {
        const bags = await dbGetAll(STORE_BAGS);
        return bags.sort((a, b) => b.startTime - a.startTime);
    }

    /**
     * Delete a bag.
     */
    async deleteBag(bagId) {
        await dbDelete(STORE_BAGS, bagId);
        // Delete messages (bulk delete via cursor)
        const db = await openDB();
        const tx = db.transaction(STORE_MESSAGES, 'readwrite');
        const store = tx.objectStore(STORE_MESSAGES);
        const index = store.index('bagId');
        const req = index.openCursor(bagId);
        req.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                cursor.delete();
                cursor.continue();
            }
        };
        this._notify();
    }

    /**
     * Export a bag as JSON.
     */
    async exportBag(bagId) {
        const bags = await dbGetAll(STORE_BAGS);
        const bag = bags.find(b => b.id === bagId);
        if (!bag) return null;

        const messages = await dbGetByIndex(STORE_MESSAGES, 'bagId', bagId);
        return {
            metadata: bag,
            messages: messages.sort((a, b) => a.relativeTime - b.relativeTime).map(m => ({
                topic: m.topic,
                timestamp: m.timestamp,
                relativeTime: m.relativeTime,
                data: m.data,
            })),
        };
    }

    // ─── State ───────────────────────────────────────────────────────────────

    get isRecording() { return this._isRecording; }
    get isPlaying() { return this._isPlaying; }
    get isPaused() { return this._isPaused; }
    get playbackSpeed() { return this._playbackSpeed; }
    get playbackProgress() { return this._playbackProgress; }
    get recordingDuration() {
        return this._isRecording ? Date.now() - this._recordingStartTime : 0;
    }
    get recordingMessageCount() { return this._messageCount; }
    get recordingTopics() { return this._recordingTopics; }
    get loadedBag() { return this._loadedBag; }
    get loadedMessageCount() { return this._loadedMessages.length; }

    get playbackTime() {
        if (!this._loadedMessages.length) return 0;
        const msg = this._loadedMessages[Math.min(this._playbackIndex, this._loadedMessages.length - 1)];
        return msg?.relativeTime || 0;
    }

    get totalDuration() {
        if (!this._loadedMessages.length) return 0;
        return this._loadedMessages[this._loadedMessages.length - 1]?.relativeTime || 0;
    }

    getState() {
        return {
            isRecording: this._isRecording,
            isPlaying: this._isPlaying,
            isPaused: this._isPaused,
            playbackSpeed: this._playbackSpeed,
            playbackProgress: this._playbackProgress,
            playbackTime: this.playbackTime,
            totalDuration: this.totalDuration,
            recordingDuration: this.recordingDuration,
            recordingMessageCount: this._messageCount,
            recordingTopics: this._recordingTopics,
            loadedBag: this._loadedBag,
        };
    }

    // ─── Listeners ───────────────────────────────────────────────────────────

    onChange(callback) {
        this._listeners.push(callback);
        return () => { this._listeners = this._listeners.filter(cb => cb !== callback); };
    }

    _notify() {
        const state = this.getState();
        for (const cb of this._listeners) {
            try { cb(state); } catch (_) { }
        }
    }

    destroy() {
        this.stop();
        this._subscriptions.forEach(unsub => unsub());
        this._subscriptions = [];
        if (this._bufferFlushInterval) clearInterval(this._bufferFlushInterval);
        this._listeners = [];
    }
}

const bagRecorder = new BagRecorder();
export default bagRecorder;
export { BagRecorder };
