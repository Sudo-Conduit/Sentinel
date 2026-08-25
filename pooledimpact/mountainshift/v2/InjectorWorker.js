/**
 * InjectorWorker.js — SharedWorker backing store for the MSOS DevTools
 * override loader (see the host injector script).
 *
 * Previously this same code lived only as a `workerCode` string, turned
 * into a SharedWorker via `new Blob([...])` + `URL.createObjectURL()`.
 * That blob: URL is regenerated every session, so DevTools Overrides had
 * no stable path to bind to and the worker's own source never appeared
 * as real, breakpointable code in Sources — just a synthetic VM entry.
 * Loading it from this file instead gives it a real, stable URL.
 */

let storedCode = '';
let isStored = false;
let ports = [];

self.onconnect = function (e)
{
    const port = e.ports[0];
    ports.push(port);

    if (isStored && storedCode)
    {
        port.postMessage(
        {
            action: 'INJECT',
            code: storedCode
        });
    }

    port.onmessage = function (event)
    {
        if (event.data.action === 'STORE')
        {
            storedCode = event.data.code;
            isStored = true;
            port.postMessage(
            {
                action: 'STORED'
            });
        }
        if (event.data.action === 'GET')
        {
            port.postMessage(
            {
                action: 'INJECT',
                code: storedCode
            });
        }
    };

    port.start();
};

// Heartbeat every 3s - push to ALL connected ports
setInterval(() =>
{
    if (isStored && storedCode)
    {
        ports = ports.filter(p =>
        {
            try
            {
                p.postMessage(
                {
                    action: 'INJECT',
                    code: storedCode
                });
                return true;
            }
            catch (e)
            {
                return false;
            }
        });
    }
}, 3000);
