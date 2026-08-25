/**
 * MSOS-Injector.js
 *
 * DevTools override loader: persists the MSOS core libraries into any
 * page (and across reloads/new tabs) via a SharedWorker relay, then
 * eval()s them into the page on connect.
 *
 * Expects (loaded on the page before this script, same convention as
 * every other MSOS entry point -- see DesktopShell.dc.html etc.):
 *   <script src="./SharedWorkerDecorator.js"></script>
 *   <script src="./CPU.js"></script>
 *   <script src="./BaseClassX.js"></script>
 *
 * Nothing here is hand-typed/copied source. The worker's own script
 * (WorkerCore, below) is composed by SharedWorkerDecorator from this
 * real function. The payload relayed into the page (previously a
 * hand-pasted MY_CODE template literal) is built from the real, live
 * CPU and BaseClassX classes via toString() -- both are real ES6
 * `class` bodies (CPU.js was rewritten from ES5 prototype-style
 * specifically so it would reflect cleanly, same as BaseClassX).
 */
(function()
{
    'use strict';

    // WorkerCore is the SharedWorker's OWN control logic: store the
    // payload, relay it to every connecting port, heartbeat every 3s.
    // Composed into the worker by SharedWorkerDecorator via toString() --
    // this function IS the live source, not a copy of it.
    function WorkerCore()
    {
        let storedCode = '';
        let isStored = false;
        let ports = [];

        self.onconnect = function (e)
        {
            const port = e.ports[0];
            ports.push(port);

            if (isStored && storedCode)
            {
                port.postMessage({ action: 'INJECT', code: storedCode });
            }

            port.onmessage = function (event)
            {
                if (event.data.action === 'STORE')
                {
                    storedCode = event.data.code;
                    isStored = true;
                    port.postMessage({ action: 'STORED' });
                }
                if (event.data.action === 'GET')
                {
                    port.postMessage({ action: 'INJECT', code: storedCode });
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
                        p.postMessage({ action: 'INJECT', code: storedCode });
                        return true;
                    }
                    catch (e)
                    {
                        return false;
                    }
                });
            }
        }, 3000);
    }

    // Both CPU and BaseClassX are real ES6 classes -- toString() reflects
    // their full source (methods included), so this payload stays live
    // with zero duplication and no fetch() needed.
    function composePayload()
    {
        return new CodeComposer()
            .inject(CPU)
            .inject(BaseClassX)
            .toString();
    }

    let injected = false;

    function start()
    {
        const decorated = new SharedWorkerDecorator(WorkerCore).build();

        decorated.worker.port.onmessage = function (e)
        {
            if (e.data.action === 'INJECT' && !injected)
            {
                eval(e.data.code);
                injected = true;
                console.log('[HOST] BIOS HandOff to Kernel');
            }
        };
        decorated.worker.port.start();

        const payload = composePayload();
        decorated.worker.port.postMessage({ action: 'STORE', code: payload });

        window.__worker = decorated.worker;
        window.__workerUrl = decorated.url;

        // === EXPOSE RECONNECT ===
        window.__reconnect = function()
        {
            const w = new SharedWorker(decorated.url);
            w.port.onmessage = function(e)
            {
                if (e.data.action === 'INJECT')
                {
                    eval(e.data.code);
                    console.log('[HOST] BIOS Loaded');
                }
            };
            w.port.start();
            w.port.postMessage({ action: 'GET' });
            window.__worker = w;
        };

        console.log('[PAGE] MSOS Initializing');
        console.log('[PAGE] BIOS Handoff');
    }

    start();
})();
