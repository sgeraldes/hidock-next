const { app, BrowserWindow } = require('electron');

let mainWindow;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 1100,
        height: 900,
        webPreferences: { 
            nodeIntegration: true, 
            contextIsolation: false,
            webSecurity: false 
        }
    });

    // Manejador para que Windows muestre el selector si no lo encuentra automático
    mainWindow.webContents.session.on('select-usb-device', (event, details, callback) => {
        event.preventDefault();
        const hidock = details.deviceList.find(d => d.productName.toLowerCase().includes('hidock'));
        if (hidock) {
            callback(hidock.deviceId);
        } else {
            // Si no lo encuentra, dejamos que el usuario elija manualmente si Electron abre el diálogo
            if (details.deviceList.length > 0) {
                callback(details.deviceList[0].deviceId);
            }
        }
    });

    mainWindow.webContents.session.setPermissionCheckHandler(() => true);
    mainWindow.webContents.session.setDevicePermissionHandler(() => true);

    mainWindow.loadFile('benchmark-ui.html');
});