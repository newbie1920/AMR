/**
 * pluginManager.js
 * ================
 * Plugin Architecture — Hệ sinh thái "Plug & Play"
 * Thay thế: ROS2 Packages + Nodes + Launch system
 *
 * Mỗi Plugin là một module JS có cấu trúc:
 *   plugins/
 *     my_plugin/
 *       plugin.json       — { name, version, description, author, dependencies }
 *       index.js           — export default { init(eventBus), destroy() }
 *
 * Plugin lifecycle:
 *   1. discover()   → Scan thư mục plugins/
 *   2. load(name)   → Import plugin module
 *   3. init(name)   → Call plugin.init(eventBus) — plugin subscribes to topics
 *   4. destroy(name) → Call plugin.destroy() — cleanup
 *
 * Plugins communicate via EventBus (Pub/Sub + Services),
 * giống y hệt ROS2 nodes communicate via topics/services.
 *
 * USAGE:
 *   import pluginManager from './pluginManager';
 *   import eventBus from './eventBus';
 *
 *   pluginManager.init(eventBus);
 *   await pluginManager.loadPlugin('camera_ai');
 *   pluginManager.listPlugins();
 *   pluginManager.unloadPlugin('camera_ai');
 *
 * PLUGIN EXAMPLE (plugins/camera_ai/index.js):
 *   export default {
 *     name: 'camera_ai',
 *     version: '1.0.0',
 *     init(eventBus) {
 *       eventBus.subscribe('/camera/rgb', (frame) => {
 *         const detection = processFrame(frame);
 *         eventBus.publish('/camera/detections', detection);
 *       });
 *       eventBus.advertiseService('/camera/take_photo', async () => {
 *         return { success: true, path: '/tmp/photo.jpg' };
 *       });
 *     },
 *     destroy() { console.log('Camera AI plugin destroyed.'); }
 *   };
 */

// ─── Plugin State ────────────────────────────────────────────────────────────

const PLUGIN_STATE = {
    DISCOVERED: 'discovered',
    LOADED: 'loaded',
    ACTIVE: 'active',
    ERROR: 'error',
    DISABLED: 'disabled',
};

class PluginEntry {
    constructor(name, manifest = {}) {
        this.name = name;
        this.version = manifest.version || '0.0.0';
        this.description = manifest.description || '';
        this.author = manifest.author || '';
        this.dependencies = manifest.dependencies || [];
        this.state = PLUGIN_STATE.DISCOVERED;
        this.module = null;   // The loaded plugin module
        this.error = null;
        this.loadedAt = null;
    }
}

// ─── Plugin Manager ──────────────────────────────────────────────────────────

class PluginManager {
    constructor() {
        this._eventBus = null;
        this._plugins = new Map();    // name → PluginEntry
        this._listeners = [];         // Change listeners
        this._builtinPlugins = [];    // Built-in plugins (registered via code)
    }

    // ─── Init ──────────────────────────────────────────────────────────────────

    /**
     * init(eventBus)
     * Initialize the plugin manager with an EventBus instance.
     */
    init(eventBus) {
        this._eventBus = eventBus;

        // Register plugin management services
        eventBus.advertiseService('/plugins/list', async () => {
            return { plugins: this.listPlugins() };
        });

        eventBus.advertiseService('/plugins/load', async (req) => {
            if (!req.name) return { success: false, error: 'Missing plugin name' };
            try {
                await this.loadPlugin(req.name);
                return { success: true };
            } catch (err) {
                return { success: false, error: err.message };
            }
        });

        eventBus.advertiseService('/plugins/unload', async (req) => {
            if (!req.name) return { success: false, error: 'Missing plugin name' };
            this.unloadPlugin(req.name);
            return { success: true };
        });

        console.log('[PluginManager] Initialized.');
    }

    // ─── Plugin Registration (Built-in) ─────────────────────────────────────

    /**
     * registerPlugin(pluginModule)
     * Register a built-in plugin (already imported, no dynamic loading needed).
     *
     * @param {Object} pluginModule - { name, version, description, init(eventBus), destroy() }
     */
    registerPlugin(pluginModule) {
        if (!pluginModule || !pluginModule.name) {
            console.error('[PluginManager] Plugin must have a "name" property.');
            return;
        }

        const entry = new PluginEntry(pluginModule.name, {
            version: pluginModule.version,
            description: pluginModule.description,
            author: pluginModule.author,
        });
        entry.module = pluginModule;
        entry.state = PLUGIN_STATE.LOADED;

        this._plugins.set(pluginModule.name, entry);
        this._notify();

        console.log(`[PluginManager] Plugin registered: ${pluginModule.name}`);
    }

    // ─── Plugin Lifecycle ────────────────────────────────────────────────────

    /**
     * loadPlugin(name)
     * Dynamically load a plugin from the plugins/ directory.
     *
     * @param {string} name - Plugin name (folder name under plugins/)
     */
    async loadPlugin(name) {
        if (this._plugins.has(name) && this._plugins.get(name).state === PLUGIN_STATE.ACTIVE) {
            console.warn(`[PluginManager] Plugin '${name}' is already active.`);
            return;
        }

        let entry = this._plugins.get(name);

        // If not yet loaded, try dynamic import
        if (!entry || !entry.module) {
            try {
                // Dynamic import — works in Vite/Webpack
                const module = await import(`../../plugins/${name}/index.js`);
                const pluginModule = module.default || module;

                if (!entry) {
                    entry = new PluginEntry(name, pluginModule);
                    this._plugins.set(name, entry);
                }
                entry.module = pluginModule;
                entry.state = PLUGIN_STATE.LOADED;
            } catch (err) {
                console.error(`[PluginManager] Failed to load plugin '${name}':`, err);
                if (!entry) {
                    entry = new PluginEntry(name);
                    this._plugins.set(name, entry);
                }
                entry.state = PLUGIN_STATE.ERROR;
                entry.error = err.message;
                this._notify();
                throw err;
            }
        }

        // Initialize the plugin
        try {
            if (typeof entry.module.init === 'function') {
                await Promise.resolve(entry.module.init(this._eventBus));
            }
            entry.state = PLUGIN_STATE.ACTIVE;
            entry.loadedAt = Date.now();
            entry.error = null;
            console.log(`[PluginManager] Plugin '${name}' activated.`);
        } catch (err) {
            console.error(`[PluginManager] Plugin '${name}' init failed:`, err);
            entry.state = PLUGIN_STATE.ERROR;
            entry.error = err.message;
        }

        this._notify();
    }

    /**
     * unloadPlugin(name)
     * Destroy and unload a plugin.
     */
    unloadPlugin(name) {
        const entry = this._plugins.get(name);
        if (!entry) return;

        if (entry.module && typeof entry.module.destroy === 'function') {
            try { entry.module.destroy(); } catch (err) {
                console.error(`[PluginManager] Plugin '${name}' destroy error:`, err);
            }
        }

        entry.state = PLUGIN_STATE.DISABLED;
        entry.loadedAt = null;
        this._notify();

        console.log(`[PluginManager] Plugin '${name}' unloaded.`);
    }

    /**
     * activateAll()
     * Load and init all registered/discovered plugins.
     */
    async activateAll() {
        for (const [name, entry] of this._plugins) {
            if (entry.state === PLUGIN_STATE.LOADED || entry.state === PLUGIN_STATE.DISCOVERED) {
                await this.loadPlugin(name);
            }
        }
    }

    /**
     * deactivateAll()
     */
    deactivateAll() {
        for (const [name] of this._plugins) {
            this.unloadPlugin(name);
        }
    }

    // ─── Query API ───────────────────────────────────────────────────────────

    /**
     * listPlugins()
     * @returns {Array<{ name, version, description, state, loadedAt, error }>}
     */
    listPlugins() {
        const result = [];
        for (const [name, entry] of this._plugins) {
            result.push({
                name,
                version: entry.version,
                description: entry.description,
                author: entry.author,
                state: entry.state,
                loadedAt: entry.loadedAt,
                error: entry.error,
            });
        }
        return result;
    }

    /**
     * getPlugin(name)
     */
    getPlugin(name) {
        const entry = this._plugins.get(name);
        if (!entry) return null;
        return {
            name: entry.name,
            version: entry.version,
            description: entry.description,
            state: entry.state,
            loadedAt: entry.loadedAt,
            error: entry.error,
        };
    }

    /**
     * isActive(name)
     */
    isActive(name) {
        const entry = this._plugins.get(name);
        return entry?.state === PLUGIN_STATE.ACTIVE;
    }

    // ─── Listeners ───────────────────────────────────────────────────────────

    onChange(callback) {
        this._listeners.push(callback);
        return () => {
            this._listeners = this._listeners.filter(cb => cb !== callback);
        };
    }

    _notify() {
        const plugins = this.listPlugins();
        for (const cb of this._listeners) {
            try { cb(plugins); } catch (_) { /* ignore */ }
        }
    }

    // ─── Cleanup ─────────────────────────────────────────────────────────────

    destroy() {
        this.deactivateAll();
        this._plugins.clear();
        this._listeners = [];
        console.log('[PluginManager] Destroyed.');
    }
}

// Singleton
const pluginManager = new PluginManager();
export default pluginManager;
export { PluginManager, PLUGIN_STATE };
