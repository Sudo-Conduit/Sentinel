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
 *   <script src="./BaseClassX.js"></script>
 *
 * Nothing here is hand-typed/copied source. The worker's own script
 * (WorkerCore, below) is composed by SharedWorkerDecorator from this
 * real function. The payload relayed into the page (previously a
 * hand-pasted MY_CODE template literal) is now built from the real,
 * live BaseClassX class (reflected via toString()) plus CPU.js's real
 * file text (fetched -- CPU.js is ES5 prototype-style, so it doesn't
 * round-trip through toString(); see SharedWorkerDecorator.js).
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

    async function composePayload()
    {
        const composer = new CodeComposer();

        // ES5 prototype-style -- toString() on the constructor alone
        // would silently drop every CPU.prototype.X instruction handler.
        // Read the real file's text instead: still zero hand-pasting,
        // always current, just not reflectable.
        const cpuSource = await fetch('./CPU.js').then(r => r.text());
        composer.injectSource(cpuSource);

        // Real ES6 class -- toString() reflects its full source
        // (methods included), so this stays live with zero duplication.
        composer.inject(BaseClassX);

        return composer.toString();
    }

    let injected = false;

    async function start()
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

        const payload = await composePayload();
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
