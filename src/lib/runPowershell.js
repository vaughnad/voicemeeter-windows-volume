/*
 this handles all things powershell from within node
*/

import { spawn } from 'child_process';

let powershellHosts = [];
let powershellWorkers = [];

/**
 * takes a code block and removes newlines and whitespaces
 * @param {string} typedCode Powershell code in string format
 * @returns {string} formatted and terminal-friendly code
 */
const formatCode = (typedCode) => {
    return typedCode.replace(/\r?\n|\r/g, ' ').trim();
};

const JSONPS = {
    /**
     * prepares powershell json results using ConvertTo-Json for JS consumption
     * by removing ALL leading, trailing, and repeating commas.
     * @param {array} jsonResultLines the powershell json result lines
     */
    parse: (jsonResultLines) => {
        return JSON.parse(
            jsonResultLines
                .filter((x) => x !== '')
                .join()
                .replace(/\,\,/g, ',')
                .replace(/\{\,/g, '{')
                .replace(/\,\}/g, '}')
                .replace(/\[\,/g, '[')
                .replace(/\,\]/g, ']')
        );
    },
};

/**
 * creates a labeled powershell host the continues to run
 * @param {string} label the unique label for the host
 * @param {function} onResponse the function called with response data when a command completes (only commands piping to Out-Host will have response data)
 */
const createPowershellHost = (label, onResponse) => {
    // spawn the child process
    powershellHosts[label] = spawn('powershell.exe', ['-Mta', '-NoProfile'], {
        shell: true,
    });

    console.log(
        `Started Powershell worker "${label}" with process ID of `,
        powershellHosts[label].pid
    );

    // register data handlers
    let streamedOutput = [];
    let started = false;

    // data is sometimes being comprised of multiple lines...
    let handleSingleLine = (line) => {
        let controlPattern = /^{{(.*):(.*)}}/;
        let match = line.match(controlPattern);

        if (match && match[1] && match[2]) {
            // control string
            let label = match[1];
            let control = match[2];
            if (control === 'start') {
                // begin data
                started = true;
            } else if (control === 'end') {
                // end data
                if (typeof onResponse === 'function') {
                    onResponse(streamedOutput);
                }
                streamedOutput.length = 0;
                started = false;
            }

            label = null;
            control = null;
        } else if (started) {
            streamedOutput.push(line);
            //console.log(line);
        }

        controlPattern = null;
        match = null;
    };

    powershellHosts[label].stdout.on('data', function (data) {
        // lines can come in solo or multiple. we need them 1 at a time here.
        let receivedLines = data.toString().split(/[\r\n]+/);
        receivedLines.forEach((line) => {
            line = line.trim();
            if (line.length > 0) {
                handleSingleLine(line);
            }
            line = null;
        });
        receivedLines = null;
    });

    return powershellHosts[label];
};

/**
 * writes a line to the stdin of an existing powershell host by label. a
 * started worker never returns to the prompt, so the line is only consumed if
 * the worker's own code reads stdin
 * @param {object} props an object of properties
 * @param {string} props.label the unique label of the powershell host
 * @param {string} command the line to send to the powershell host
 */
const sendToPowershellWorker = ({ label, command }) => {
    if (powershellHosts[label]) {
        powershellHosts[label].stdin.write(command + '\n');
    }
};

/**
 * starts a powershell worker that lasts until manually closed. this worker
 * can use an initial setup script and will repeat a given command on a timer.
 * the timer loop runs inside powershell as a single submission: every line
 * the host receives is scanned by the installed AMSI provider, and some
 * providers leak handles on each scan
 * @param {object} props an object of properties
 * @param {number} props.interval an interval in ms that the command should run
 * @param {string} props.label a unique label for this powershell worker
 * @param {string} props.setsup (optional) a filename without extension for the script needed during worker setup
 * @param {string} props.init (optional) a command to run once before the timer starts
 * @param {string} props.command the commmand to run on a timer
 * @param {function} props.onResponse the function called with response data when a command completes (only commands piping to Out-Host will have response data)
 */
const startPowershellWorker = ({
    interval,
    label,
    setup,
    init,
    command,
    onResponse,
}) => {
    if (!powershellHosts[label] && !powershellWorkers[label]) {
        // create the powershell instance
        let ps = createPowershellHost(label, onResponse);

        // define our control commands
        const controlCommandStart = `echo "{{${label}:start}}"; `;
        const controlCommandEnd = `echo "{{${label}:end}}"; `;

        // format our command and setup code
        if (command) {
            command = formatCode(command);
            if (!command.endsWith(';')) {
                command = command + ';';
            }
            command = `while ($true) { ${controlCommandStart}${command}${controlCommandEnd}Start-Sleep -Milliseconds ${interval}; }\n`;
            if (init) {
                command = formatCode(init) + '; ' + command;
            }
        }

        // handle our setup command if supplied
        if (setup) {
            let setupCode = `${setup}\r\n`;
            ps.stdin.write(setupCode);
        }

        // start the timer loop
        ps.stdin.write(command);
        powershellWorkers[label] = true;
    }
};

/**
 * stops a powershell worker by label
 * @param {string} label the uniquye label of the powershell worker
 */
const stopPowershellWorker = (label) => {
    if (powershellWorkers[label]) {
        powershellWorkers[label] = null;
    }
    if (
        powershellHosts[label] &&
        typeof powershellHosts[label].kill === 'function'
    ) {
        console.log(`Killed Powershell worker with label "${label}"`);
        powershellHosts[label].kill();
        powershellHosts[label] = null;
    }
};

/**
 * runs powershell with a single command and then closes
 * @param {object} props properties object containing parameters
 * @param {array} props.commands an array of string commands to run
 * @param {function} props.callback a function to call when done
 * @param {boolean} props.stdout if true, will console log Powershell output
 */
const runPowershell = ({ commands, callback, stdout = false }) => {
    // make sure our command is a part of an array
    if (typeof commands !== 'object') {
        commands = [commands];
    }

    // clean up inputs
    commands.forEach((value, index) => {
        commands[index] = formatCode(commands[index]);
    });

    let child = spawn('powershell.exe', [...commands]);
    let output = '';
    let errorOutput = '';
    stdout && console.log('Running Powershell Command:', commands.join(' '));
    child.on('end', function () {
        stdout && console.log('Powershell Script finished');
        if (typeof callback === 'function') {
            callback(output, errorOutput);
        }
        child.kill();
        child = null;
        output = null;
        errorOutput = null;
    });
    child.stdout.on('data', function (data) {
        stdout && console.log('' + data);
        output += data;
    });
    child.stderr.on('data', function (data) {
        stdout && console.log('' + data);
        errorOutput += data;
    });

    // close powershell input
    child.stdin.end();
};

export {
    runPowershell,
    startPowershellWorker,
    stopPowershellWorker,
    sendToPowershellWorker,
    JSONPS,
};
