/**
 * @file ShellServer.js
 * @description The thin Node host for Shell-Terminal.html. Boots Shell.js's
 *   opaque factory ONCE (real sockets, real child_process, real WASM --
 *   inherently server-side capabilities no browser sandbox can do at
 *   all, which is why this engine was never a candidate for running
 *   directly in-page: no raw TCP API and no process-spawning API exist
 *   in a browser, regardless of any require() concern), then exposes
 *   exactly one real capability over HTTP: POST /exec {cmdline} ->
 *   {rc, stdout, cwd}. GET / serves the terminal page itself.
 *
 *   This file is the ENTIRE server-side surface -- no session state, no
 *   auth, no multi-client isolation (every connected browser shares the
 *   same booted Shell instance and its cwd; that's a real, deliberate
 *   limitation for a single-user reference demo, not something to grow
 *   silently). The UI stays "fairly dumb" by construction: every
 *   command's real work happens in Shell.js, reached only through this
 *   one endpoint -- this file does no command interpretation of its
 *   own, just JSON in, JSON out.
 * @docs MSOS-Shell.md
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const ShellFactory = require('./Shell.js');

const PORT = Number(process.argv[2]) || 4600;
const TERMINAL_HTML_PATH = path.join(__dirname, 'Shell-Terminal.html');
async function main()
{
    // Nothing is served to boot the shell: shell.wasm arrives as a
    // require()d base64 constant, so this server only ever serves the
    // page and answers /exec.
    let caps = null;

    const server = http.createServer((req, res) =>
    {
        if (req.method === 'GET' && req.url === '/')
        {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(TERMINAL_HTML_PATH));
            return;
        }

        if (req.method === 'POST' && req.url === '/exec')
        {
            let body = '';
            req.on('data', (chunk) => { body += chunk; });
            req.on('end', async () =>
            {
                let cmdline = '';
                try { cmdline = String(JSON.parse(body || '{}').cmdline || ''); }
                catch (e) { /* malformed body -- fall through with an empty cmdline */ }

                if (!caps)
                {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ rc: 1, stdout: 'shell: still booting, try again in a moment\n', cwd: '/' }));
                    return;
                }

                try
                {
                    const result = await caps.exec(cmdline);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                }
                catch (err)
                {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ rc: 1, stdout: 'shell: ' + err.message + '\n', cwd: '/' }));
                }
            });
            return;
        }

        res.writeHead(404);
        res.end();
    });

    await new Promise((resolve) => server.listen(PORT, resolve));
    const { port } = server.address();

    const factory = ShellFactory({
        cwd: '/',
        uid: typeof process.getuid === 'function' ? process.getuid() : 0,
        env: { HOME: '/root', PATH: '/usr/bin:/bin' }
    });
    caps = await factory.boot();

    console.log('MSOS Shell Terminal: http://localhost:' + port);
}

main();
