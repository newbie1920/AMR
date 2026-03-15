console.log(process.versions);
try {
    const electron = require('electron');
    console.log('Electron module:', typeof electron);
} catch (e) {
    console.log('Failed to require electron:', e.message);
}
