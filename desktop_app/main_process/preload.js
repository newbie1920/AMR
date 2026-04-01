const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    getAppVersion: () => ipcRenderer.invoke('get-app-version'),
    platform: process.platform,
    startMonitor: (args) => ipcRenderer.send('start-monitor', args),
    stopMonitor: () => ipcRenderer.send('stop-monitor'),
    logAppEvent: (text) => ipcRenderer.send('log-app-event', text),
    onMonitorData: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('monitor-data', sub);
        return () => ipcRenderer.removeListener('monitor-data', sub);
    },
    onMonitorStatus: (callback) => {
        const sub = (event, data) => callback(data);
        ipcRenderer.on('monitor-status', sub);
        return () => ipcRenderer.removeListener('monitor-status', sub);
    }
});
