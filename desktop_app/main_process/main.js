const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
        icon: path.join(__dirname, '../public/icon.png'),
        title: 'AMR Control Center',
        backgroundColor: '#0a0a1a',
    });

    // Load the app
    if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    // DevTools Shortcuts
    globalShortcut.register('CommandOrControl+Shift+I', () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) win.webContents.toggleDevTools();
    });

    globalShortcut.register('CommandOrControl+R', () => {
        const win = BrowserWindow.getFocusedWindow();
        if (win) win.webContents.reload();
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// IPC handlers
ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

let telnetSocket = null;
let logStream = null;

ipcMain.on('start-monitor', (event, { ip, robotId }) => {
    if (telnetSocket) telnetSocket.destroy();
    if (logStream) logStream.end();

    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const logPath = path.join(logsDir, `amr-monitor-${robotId}.log`);
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    logStream.write(`\n\n--- Monitor Started at ${new Date().toISOString()} ---\n`);

    telnetSocket = new net.Socket();
    
    telnetSocket.connect(23, ip, () => {
        event.sender.send('monitor-status', { status: 'connected', robotId, file: logPath });
    });
    
    telnetSocket.on('data', (data) => {
        const text = data.toString();
        if (logStream) logStream.write(text);
        event.sender.send('monitor-data', text);
    });
    
    telnetSocket.on('error', (err) => {
        const errorMsg = `\n[Error] ${err.message}\n`;
        if (logStream) logStream.write(errorMsg);
        event.sender.send('monitor-data', errorMsg);
        event.sender.send('monitor-status', { status: 'error', robotId, error: err.message });
    });
    
    telnetSocket.on('close', () => {
        const closeMsg = `\n--- Connection Closed ---\n`;
        if (logStream) logStream.write(closeMsg);
        event.sender.send('monitor-status', { status: 'disconnected', robotId });
    });
});

ipcMain.on('stop-monitor', () => {
    if (telnetSocket) {
        telnetSocket.destroy();
        telnetSocket = null;
    }
    if (logStream) {
        logStream.end();
        logStream = null;
    }
});

ipcMain.on('log-app-event', (event, text) => {
    if (logStream) {
        logStream.write(`\n[APP-EVENT] ${new Date().toISOString()}: ${text}\n`);
    }
});
