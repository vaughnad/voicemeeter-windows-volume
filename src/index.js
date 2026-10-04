/**
 * main entry point for voicemeeter-windows-volume
 */

// imports *********************************************************************

// built-in
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

// local
import { systray, setupPersistantSystray } from './lib/persistantSysTray';
import { startAudioSync } from './lib/managers/audioSyncManager';
import { getVoicemeeterConnection } from './lib/managers/audioSyncManager';
import { getTrayApp } from './trayApp';
import { defaults } from './defaultSettings';
import { getSystemColor } from './lib/util';

const settingsPath = `${__dirname}/settings.json`;
const logPath = `${__dirname}/vmwv.log`;

// mirror console output into a log file for the current run; the app has no
// visible console when started by the launcher
try {
    fs.writeFileSync(logPath, '');
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const teeToLog = (original) => (...args) => {
        original(...args);
        logStream.write(
            `${new Date().toISOString()} ${args
                .map((arg) => (arg instanceof Error ? arg.stack : String(arg)))
                .join(' ')}\n`
        );
    };
    console.log = teeToLog(console.log.bind(console));
    console.error = teeToLog(console.error.bind(console));
} catch (error) {
    console.log('Log file unavailable:', error.message);
}

// a second copy started by the launcher replaces the running one
const exeName = path.basename(process.execPath);
if (!/^node(\.exe)?$/i.test(exeName)) {
    execFile(
        'taskkill',
        ['/F', '/T', '/FI', `PID ne ${process.pid}`, '/IM', exeName],
        (error, stdout) => {
            if (!error) {
                console.log('Replaced running instance:', stdout.trim());
            }
        }
    );
}

// handle app exit *************************************************************

const exitHandler = (options, exitCode) => {
    if (options.cleanup) {
        let vm = getVoicemeeterConnection();
        vm && vm.disconnect();
        vm = null;
        systray && systray.kill(false);
        console.log('clean exit');
    }
    if (exitCode) console.log('Exit Code:', exitCode);
    if (options.exit) process.exit();
};
// do something when app is closing
process.on('exit', exitHandler.bind(null, { cleanup: true }));
// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, { exit: true }));
// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));
// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));

// initialize the tray app *****************************************************

console.log('Voicemeeter Windows Volume started, Process ID: ', process.pid);
setupPersistantSystray({
    trayApp: getTrayApp('default'),
    defaults,
    settingsPath,
    onReady: () => {
        console.log('Starting audio synchronization');
        startAudioSync();
    },
});
