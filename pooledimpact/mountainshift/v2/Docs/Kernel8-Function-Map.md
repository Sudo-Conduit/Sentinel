# kernel_8.0.10.js — Function/Export Reference Map

Static analysis of the pre-BaseClassX kernel (Part XIII.5 of Architecture 2.0), captured for reference during the BaseClassX rebuild. Columns: Export Name, Type, Start/End Line, Parameters, Returns, Calls, Called By, Max Indent Depth, Side Effects.

| Export Name | Type | Start Line | End Line | Parameters | Returns | Calls | Called By | Max Indent Depth | Side Effects |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `coopCoepHandler` | async function | 133 | 143 | `(request, next)` | `Promise<Response>` | `next` | `handleFetch` | 2 | API |
| `offlineCacheHandler` | async function | 149 | 156 | `(request, next)` | `Promise<Response>` | `next`, `caches.open`, `cache.match` | `handleFetch` | 2 | API |
| `diskImageHandler` | async function | 162 | 187 | `(request, next)` | `Promise<Response>` | `next`, `caches.open`, `cache.match`, `new Request`, `new Response` | `handleFetch` | 3 | API |
| `networkHandler` | async function | 193 | 199 | `(request)` | `Promise<Response>` | `fetch` | `handleFetch` | 2 | API |
| `buildChain` | function | 205 | 209 | `(handlers)` | `function` | (none) | `self.addEventListener` | 4 | EVENT |
| `EventBus` | class | 263 | 281 | `(maxHistory = 1000)` | `void` | (constructor internal) | `MountainShift` (indirect) | 5 | EVENT |
| `EventBus.on` | function | 268 | 271 | `(event, callback)` | `object` | (none) | `EventBus` methods | 3 | NONE |
| `EventBus.emit` | async function | 273 | 279 | `(event, payload)` | `Promise<void>` | `performance.now` | `EventBus` methods | 4 | EVENT |
| `EventBus.getHistory` | function | 281 | 281 | `(limit = 50)` | `array` | (none) | `EventsCommand` | 1 | NONE |
| `AuditLog` | class | 286 | 299 | `(kernel, maxEntries = 10000)` | `void` | (constructor internal) | `MountainShift` (indirect) | 4 | FS |
| `AuditLog.add` | function | 291 | 294 | `(entry)` | `void` | `Date.now` | (internal kernel) | 3 | FS |
| `AuditLog.get` | function | 296 | 296 | `(limit = 100)` | `array` | (none) | (internal kernel) | 1 | NONE |
| `AuditLog.getBySession` | function | 297 | 297 | `(userId, limit = 100)` | `array` | (none) | (internal kernel) | 2 | NONE |
| `AuditLog.getByUid` | function | 298 | 298 | `(uid, limit = 100)` | `array` | (none) | (internal kernel) | 2 | NONE |
| `ServiceTokenManager` | class | 304 | 336 | (none) | `void` | (constructor internal) | `MountainShift` (indirect) | 5 | NONE |
| `ServiceTokenManager.mint` | function | 307 | 321 | `(name, permissions = [], options = {})` | `string` | `_platform.crypto.randomUUID`, `Date.now` | `MintCommand`, `SpawnCommand` | 3 | NONE |
| `ServiceTokenManager.check` | function | 323 | 333 | `(token, operation, path)` | `boolean` | `Date.now` | (internal kernel) | 4 | NONE |
| `ServiceTokenManager.revoke` | function | 335 | 335 | `(token)` | `boolean` | (none) | (internal kernel) | 1 | NONE |
| `ResourceMonitor` | class | 341 | 366 | `(maxHistory = 1000, options = {})` | `void` | (constructor internal) | `MountainShift` (indirect) | 6 | EVENT |
| `ResourceMonitor.register` | function | 348 | 354 | `(obj, name, metadata = {})` | `number` | `performance.now` | (internal kernel) | 5 | EVENT |
| `ResourceMonitor.unregister` | function | 356 | 362 | `(id)` | `void` | `performance.now` | (internal kernel) | 5 | EVENT |
| `ResourceMonitor.listActive` | function | 364 | 364 | (none) | `array` | (none) | `ResourcesCommand` | 1 | NONE |
| `ResourceMonitor.listDisposed` | function | 365 | 365 | `(limit = 50)` | `array` | (none) | `ResourcesCommand` | 1 | NONE |
| `ResourceMonitor.cleanupStale` | function | 366 | 366 | (none) | `void` | (none) | (internal kernel) | 3 | NONE |
| `ResourceManager` | class | 371 | 415 | `(options = {})` | `void` | (constructor internal) | `MountainShift` (indirect) | 6 | EVENT |
| `ResourceManager.setLimits` | function | 381 | 381 | `(newLimits)` | `this` | (none) | (internal kernel) | 1 | NONE |
| `ResourceManager.getEffectiveLimits` | function | 382 | 382 | (none) | `object` | (none) | (internal kernel) | 2 | NONE |
| `ResourceManager.reserveProcess` | function | 383 | 396 | `(pid, metadata = {})` | `object/null` | `Date.now` | (internal kernel) | 4 | EVENT |
| `ResourceManager.reserveFileHandle` | function | 397 | 397 | (none) | `boolean` | (none) | (internal kernel) | 2 | NONE |
| `ResourceManager.releaseFileHandle` | function | 398 | 398 | (none) | `void` | (none) | (internal kernel) | 2 | NONE |
| `ResourceManager.updateMemory` | function | 399 | 399 | `(pid, usedMB)` | `boolean` | (none) | (internal kernel) | 2 | NONE |
| `ResourceManager.reserveLLMTokens` | function | 402 | 402 | `(tokens)` | `boolean` | (none) | (internal kernel) | 2 | NONE |
| `ResourceManager.on` | function | 404 | 404 | `(event, cb)` | `void` | (none) | (internal kernel) | 2 | EVENT |
| `ResourceManager.stats` | function | 406 | 406 | (none) | `object` | (none) | `ResourcesCommand` | 2 | NONE |
| `ResourceManager.destroy` | function | 407 | 407 | (none) | `void` | (none) | (internal kernel) | 3 | NONE |
| `MemoryBackend` | class | 420 | 614 | (none) | `void` | (constructor internal) | `MountainShift` (indirect) | 11 | FS |
| `MemoryBackend._initSecureDirectories` | function | 423 | 446 | (none) | `void` | `new TextEncoder`, `Date.now` | (constructor) | 4 | FS |
| `MemoryBackend._checkPermission` | function | 448 | 457 | `(node, uid, gid, writeMode = false)` | `boolean` | (none) | (multiple methods) | 4 | NONE |
| `MemoryBackend._checkDirectoryWritePermission` | function | 459 | 465 | `(dirNode, uid, gid)` | `boolean` | (none) | (multiple methods) | 4 | NONE |
| `MemoryBackend._normalizePath` | function | 471 | 480 | `(path)` | `string` | (none) | (multiple methods) | 4 | NONE |
| `MemoryBackend.readFile` | async function | 482 | 503 | `(path, options = {})` | `Promise<Uint8Array/string>` | `new TextDecoder`, `String`, `new TextEncoder` | `KernelJS` (indirect) | 6 | FS |
| `MemoryBackend.writeFile` | async function | 505 | 529 | `(path, data, options = {})` | `Promise<void>` | `new TextEncoder`, `Date.now` | `KernelJS` (indirect) | 6 | FS |
| `MemoryBackend.mkdir` | async function | 531 | 559 | `(path, options = {})` | `Promise<void>` | `Date.now` | `KernelJS` (indirect) | 6 | FS |
| `MemoryBackend.readdir` | async function | 561 | 579 | `(path, options = {})` | `Promise<array>` | (none) | `KernelJS` (indirect) | 5 | FS |
| `MemoryBackend.stat` | async function | 581 | 591 | `(path, options = {})` | `Promise<object>` | (none) | `KernelJS` (indirect) | 4 | FS |
| `MemoryBackend.chmod` | async function | 593 | 601 | `(path, mode, options = {})` | `Promise<void>` | `Date.now` | `KernelJS` (indirect) | 5 | FS |
| `MemoryBackend.chown` | async function | 603 | 613 | `(path, uid, gid, options = {})` | `Promise<void>` | `Date.now` | `KernelJS` (indirect) | 5 | FS |
| `MemoryBackend.unlink` | async function | 615 | 629 | `(path, options = {})` | `Promise<void>` | (none) | `KernelJS` (indirect) | 6 | FS |
| `MemoryBackend.rmdir` | async function | 631 | 645 | `(path, options = {})` | `Promise<void>` | (none) | `KernelJS` (indirect) | 6 | FS |
| `MemoryBackend.rename` | async function | 647 | 668 | `(oldPath, newPath, options = {})` | `Promise<void>` | `Date.now` | `KernelJS` (indirect) | 7 | FS |
| `Session` | class | 674 | 702 | `(userId, tty)` | `void` | (constructor internal) | `KernelJS` (indirect) | 5 | NONE |
| `Session.setWaiting` | function | 685 | 685 | `(command, data)` | `void` | (none) | (internal commands) | 1 | NONE |
| `Session.isWaiting` | function | 686 | 686 | (none) | `boolean` | (none) | `KernelJS.run` | 1 | NONE |
| `Session.getWaiting` | function | 687 | 687 | (none) | `object` | (none) | (internal commands) | 1 | NONE |
| `Session.clearWaiting` | function | 688 | 688 | (none) | `void` | (none) | (internal commands) | 1 | NONE |
| `Session.touch` | function | 690 | 690 | (none) | `void` | `Date.now` | (internal kernel) | 1 | NONE |
| `Session.toJSON` | function | 692 | 699 | (none) | `object` | `Object.fromEntries` | `KernelJS._saveSession` | 2 | NONE |
| `Session.fromJSON` | static function | 701 | 702 | `(data)` | `Session` | `new Session` | `KernelJS._loadSessions` | 2 | NONE |
| `BshShell` | class | 707 | 902 | `(kernel)` | `void` | (constructor internal) | `KernelJS` (indirect) | 9 | NONE |
| `BshShell._tokenizeWithEscapes` | function | 710 | 746 | `(str)` | `array` | (none) | `BshShell._parseSegment` | 8 | NONE |
| `BshShell._findPipe` | function | 748 | 758 | `(str)` | `number` | (none) | `BshShell._parseCommandLine` | 5 | NONE |
| `BshShell._parseCommandLine` | function | 760 | 769 | `(line)` | `array` | `BshShell._findPipe`, `BshShell._parseSegment` | `BshShell.execute` | 4 | NONE |
| `BshShell._parseSegment` | function | 771 | 793 | `(seg)` | `object` | (none) | `BshShell._parseCommandLine` | 5 | NONE |
| `BshShell._makeStdinIterable` | function | 795 | 803 | `(data)` | `object` | (none) | `BshShell._executeCommand` | 5 | NONE |
| `BshShell._executeCommand` | async function | 805 | 868 | `(cmd, {kernel, stdout, stderr, stdin, cwd, requestId, resolveCommand, session, resourceManager, gatedGlobals, effectiveUid})` | `Promise<object>` | `new TextEncoder`, `new TextDecoder`, `new CommandClass`, `kernel._fs.readFile`, `kernel._fs.writeFile` | `BshShell.execute` | 9 | FS |
| `BshShell._extractHeredocs` | function | 870 | 900 | `(commandLine)` | `object` | (none) | `BshShell.execute` | 7 | NONE |
| `BshShell.execute` | async function | 902 | 930 | `(commandLine, {kernel, stdout, stderr, stdin, cwd, resolveCommand, requestId, session, resourceManager, gatedGlobals, effectiveUid})` | `Promise<object>` | `BshShell._extractHeredocs`, `BshShell._parseCommandLine`, `BshShell._makeStdinIterable`, `BshShell._executeCommand`, `new TextEncoder` | `KernelJS.run`, `KernelJS._executeCommandWithToken` | 6 | NONE |
| `TTY` | class | 935 | 961 | (none) | `void` | (constructor internal) | `KernelJS` (indirect) | 5 | NONE |
| `TTY.setWaiting` | function | 944 | 944 | `(command, data)` | `void` | (none) | (internal commands) | 1 | NONE |
| `TTY.isWaiting` | function | 945 | 945 | (none) | `boolean` | (none) | `KernelJS.run` | 1 | NONE |
| `TTY.getWaiting` | function | 946 | 946 | (none) | `object` | (none) | (internal commands) | 1 | NONE |
| `TTY.clear` | function | 947 | 947 | (none) | `void` | (none) | (internal commands) | 1 | NONE |
| `TTY.prompt` | async function | 949 | 952 | `(prompt, hidden = false)` | `Promise<string>` | (none) | (internal commands) | 4 | NONE |
| `TTY.receiveInput` | function | 954 | 960 | `(input, cancelled = false)` | `boolean` | `String` | (kernel internal) | 5 | NONE |
| `TTY.sendInput` | function | 961 | 961 | `(data)` | `boolean` | `TTY.receiveInput` | (device mounts) | 1 | NONE |
| `LoginCommand` | class | 966 | 986 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 5 | FS |
| `LoginCommand.execute` | function | 968 | 973 | `(args, {tty, stdout, session})` | `number` | (none) | `BshShell` | 4 | NONE |
| `LoginCommand._complete` | async function | 975 | 986 | `(input, {tty, stdout, kernel, session, waitingHolder})` | `Promise<number>` | `kernel.login` | `KernelJS.run` | 5 | FS |
| `LogoutCommand` | class | 991 | 1005 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 6 | FS |
| `LogoutCommand.execute` | async function | 993 | 1005 | `(args, {stdout, stderr, kernel, session})` | `Promise<number>` | `kernel._etcResolver.getUserByUid`, `kernel.logout` | `BshShell` | 4 | FS |
| `SuCommand` | class | 1010 | 1060 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 6 | FS |
| `SuCommand.execute` | function | 1012 | 1034 | `(args, {stdout, stderr, session, tty})` | `number` | (none) | `BshShell` | 5 | NONE |
| `SuCommand._complete` | async function | 1036 | 1060 | `(input, {stdout, stderr, kernel, etcResolver, session, waitingHolder})` | `Promise<number>` | `etcResolver.getUser`, `etcResolver.verifyPassword`, `kernel.login` | `KernelJS.run` | 7 | FS |
| `ExitCommand` | class | 1065 | 1074 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 3 | FS |
| `ExitCommand.execute` | async function | 1068 | 1074 | `(args, {stdout, stderr, kernel, session})` | `Promise<number>` | `kernel._etcResolver.getUserByUid` | `BshShell` | 4 | FS |
| `SudoCommand` | class | 1079 | 1141 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 8 | FS |
| `SudoCommand.execute` | async function | 1081 | 1119 | `(args, {tty, stdout, stderr, kernel, etcResolver, session})` | `Promise<number>` | `etcResolver.getUserByUid`, `etcResolver.isSudoer`, `kernel._executeCommandWithToken` | `BshShell` | 8 | FS |
| `SudoCommand._complete` | async function | 1121 | 1141 | `(input, {kernel, stdout, stderr, etcResolver, tty, session, waitingHolder})` | `Promise<number>` | `etcResolver.verifyPassword`, `kernel._executeCommandWithToken` | `KernelJS.run` | 6 | FS |
| `UserCommand` | class | 1146 | 1238 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 9 | FS |
| `UserCommand._generatePassword` | function | 1157 | 1164 | `(length = 12)` | `string` | `Math.random` | `UserCommand._add` | 3 | NONE |
| `UserCommand.execute` | async function | 1166 | 1176 | `(args, {kernel, stdout, stderr, vfs, etcResolver, session})` | `Promise<number>` | `UserCommand._add`, `UserCommand._remove`, `UserCommand._list`, `UserCommand._passwd` | `BshShell` | 5 | FS |
| `UserCommand._add` | async function | 1178 | 1214 | `(args, {kernel, stdout, stderr, vfs, session})` | `Promise<number>` | `UserCommand._userExists`, `vfs.readFile`, `vfs.mkdir`, `vfs.chown`, `vfs.chmod`, `vfs.writeFile`, `kernel._etcResolver.clearCache` | `UserCommand.execute` | 7 | FS |
| `UserCommand._remove` | async function | 1216 | 1242 | `(args, {kernel, stdout, stderr, vfs, session})` | `Promise<number>` | `kernel._etcResolver.getUser`, `vfs.readFile`, `vfs.writeFile`, `kernel.logout`, `vfs.rmdir`, `kernel._etcResolver.clearCache` | `UserCommand.execute` | 7 | FS |
| `UserCommand._list` | async function | 1244 | 1253 | `(args, {kernel, stdout, stderr, vfs, session})` | `Promise<number>` | `vfs.readFile` | `UserCommand.execute` | 5 | FS |
| `UserCommand._passwd` | async function | 1255 | 1274 | `(args, {kernel, stdout, stderr, vfs, etcResolver, session})` | `Promise<number>` | `etcResolver.getUserByUid`, `etcResolver.getUser` | `UserCommand.execute` | 6 | FS |
| `UserCommand._userExists` | async function | 1276 | 1282 | `(vfs, username)` | `Promise<boolean>` | `vfs.readFile` | `UserCommand._add` | 4 | FS |
| `EtcResolver` | class | 1287 | 1328 | `(kernel)` | `void` | (constructor internal) | `KernelJS` (indirect) | 5 | FS |
| `EtcResolver._read` | async function | 1293 | 1293 | `(path)` | `Promise<string>` | `this._kernel._fs.readFile` | `EtcResolver` methods | 2 | FS |
| `EtcResolver.getUser` | async function | 1295 | 1308 | `(username)` | `Promise<object/null>` | `EtcResolver._read`, `parseInt` | (multiple commands) | 5 | FS |
| `EtcResolver.getShadow` | async function | 1310 | 1321 | `(username)` | `Promise<object/null>` | `EtcResolver._read`, `parseInt` | (internal kernel) | 5 | FS |
| `EtcResolver.verifyPassword` | async function | 1323 | 1328 | `(username, password)` | `Promise<boolean>` | `EtcResolver.getShadow` | (multiple commands) | 4 | FS |
| `EtcResolver.isSudoer` | async function | 1330 | 1338 | `(username)` | `Promise<boolean>` | `EtcResolver._read` | `SudoCommand.execute` | 5 | FS |
| `EtcResolver.getUserByUid` | async function | 1340 | 1354 | `(uid)` | `Promise<object/null>` | `EtcResolver._read`, `parseInt` | (multiple commands) | 6 | FS |
| `EtcResolver.clearCache` | async function | 1356 | 1357 | (none) | `Promise<void>` | (none) | (multiple commands) | 1 | FS |
| `CatCommand` | class | 1362 | 1383 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 5 | FS |
| `CatCommand.execute` | async function | 1364 | 1382 | `(args, {stdin, stdout, stderr, vfs, cwd, session, effectiveUid})` | `Promise<number>` | `new TextDecoder`, `vfs.readFile` | `BshShell` | 6 | FS |
| `EchoCommand` | class | 1388 | 1393 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 2 | NONE |
| `EchoCommand.execute` | async function | 1390 | 1393 | `(args, {stdout})` | `Promise<number>` | (none) | `BshShell` | 1 | NONE |
| `VersionCommand` | class | 1398 | 1402 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 1 | NONE |
| `VersionCommand.execute` | async function | 1400 | 1402 | `(args, {stdout})` | `Promise<number>` | (none) | `BshShell` | 1 | NONE |
| `PasteCommand` | class | 1407 | 1417 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 4 | API |
| `PasteCommand.execute` | async function | 1409 | 1417 | `(args, {stdin, stdout, stderr, kernel})` | `Promise<number>` | `new TextDecoder`, `_platform.navigator.clipboard.readText` | `BshShell` | 4 | API |
| `ReadCommand` | class | 1422 | 1439 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 5 | FS |
| `ReadCommand.execute` | async function | 1424 | 1438 | `(args, {stdout, stderr, vfs, session, effectiveUid})` | `Promise<number>` | `vfs.readFile`, `parseInt` | `BshShell` | 7 | FS |
| `EditCommand` | class | 1444 | 1467 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 6 | FS |
| `EditCommand.execute` | async function | 1446 | 1466 | `(args, {stdin, stdout, stderr, vfs, session, effectiveUid})` | `Promise<number>` | `vfs.readFile`, `vfs.writeFile`, `new TextDecoder` | `BshShell` | 8 | FS |
| `ManCommand` | class | 1472 | 1503 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 6 | FS |
| `ManCommand.execute` | async function | 1474 | 1502 | `(args, {stdout, stderr, vfs, session, effectiveUid})` | `Promise<number>` | `vfs.readdir`, `vfs.readFile`, `parseInt` | `BshShell` | 8 | FS |
| `EventsCommand` | class | 1508 | 1514 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 2 | EVENT |
| `EventsCommand.execute` | async function | 1510 | 1514 | `(args, {stdout, kernel})` | `Promise<number>` | `kernel._events.getHistory`, `parseInt`, `JSON.stringify` | `BshShell` | 3 | EVENT |
| `ResourcesCommand` | class | 1519 | 1529 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 3 | EVENT |
| `ResourcesCommand.execute` | async function | 1521 | 1529 | `(args, {stdout, stderr, kernel})` | `Promise<number>` | `kernel._resourceMonitor.listActive`, `kernel._resourceMonitor.listDisposed`, `performance.now`, `JSON.stringify` | `BshShell` | 5 | EVENT |
| `RegistryCommand` | class | 1534 | 1564 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 5 | FS |
| `RegistryCommand.execute` | async function | 1536 | 1564 | `(args, {stdout, stderr, kernel, vfs, session})` | `Promise<number>` | `vfs.writeFile`, `JSON.stringify`, `JSON.parse` | `BshShell` | 8 | FS |
| `PkgCommand` | class | 1569 | 1615 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 6 | FS, API |
| `PkgCommand.execute` | async function | 1571 | 1581 | `(args, {stdin, stdout, stderr, kernel, vfs, requestId, session})` | `Promise<number>` | `PkgCommand.install`, `PkgCommand.list`, `PkgCommand.remove` | `BshShell` | 6 | FS |
| `PkgCommand.install` | async function | 1582 | 1601 | `(args, {stdout, stderr, kernel, vfs, requestId, session})` | `Promise<number>` | `fetch`, `kernel.run`, `kernel.compileCommand` | `PkgCommand.execute` | 6 | FS, API |
| `PkgCommand.list` | async function | 1602 | 1605 | `(args, {stdout, kernel})` | `Promise<number>` | (none) | `PkgCommand.execute` | 4 | NONE |
| `PkgCommand.remove` | async function | 1606 | 1610 | `(args, {stdout, stderr, kernel})` | `Promise<number>` | (none) | `PkgCommand.execute` | 4 | NONE |
| `GzCommand` | class | 1615 | 1729 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 8 | FS, API |
| `GzCommand.execute` | async function | 1617 | 1728 | `(args, {stdin, stdout, stderr, vfs, cwd, session, effectiveUid, kernel})` | `Promise<number>` | `_platform.gzManifest`, `_platform.gzPayload`, `atob`, `new Response`, `new Blob`, `vfs.mkdir`, `vfs.writeFile`, `vfs.readFile` | `BshShell` | 8 | FS |
| `SpawnCommand` | class | 1734 | 1890 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 10 | FS, API |
| `SpawnCommand.execute` | async function | 1736 | 1746 | `(args, {kernel, stdout, stderr, session})` | `Promise<number>` | `SpawnCommand.create`, `SpawnCommand.dispose`, `SpawnCommand.list` | `BshShell` | 6 | FS, API |
| `SpawnCommand.create` | async function | 1748 | 1822 | `(args, {kernel, stdout, stderr, session})` | `Promise<number>` | `Date.now`, `Math.random`, `_platform.isBrowser`, `_platform.document.createElement`, `_platform.addEventListener`, `_platform.removeEventListener`, `_platform.spawnProcess`, `kernel._fs.mkdir`, `kernel._fs.writeFile`, `kernel._fs.stat`, `kernel._events.emit` | `SpawnCommand.execute` | 10 | FS, API, EVENT |
| `SpawnCommand.dispose` | async function | 1824 | 1846 | `(args, {kernel, stdout, stderr, session})` | `Promise<number>` | `kernel._fs.stat`, `_platform.removeEventListener`, `kernel._fs.unlink`, `kernel._fs.rmdir`, `kernel._events.emit` | `SpawnCommand.execute` | 7 | FS, EVENT |
| `SpawnCommand.list` | async function | 1848 | 1866 | `(args, {kernel, stdout, session})` | `Promise<number>` | `kernel._fs.readdir`, `kernel._fs.readFile`, `JSON.stringify` | `SpawnCommand.execute` | 6 | FS |
| `WhoamiCommand` | class | 1871 | 1883 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 4 | FS |
| `WhoamiCommand.execute` | async function | 1873 | 1883 | `(args, {stdout, kernel, session})` | `Promise<number>` | `kernel._etcResolver.getUserByUid`, `String` | `BshShell` | 4 | FS |
| `SessionCommand` | class | 1888 | 1934 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 7 | FS |
| `SessionCommand.execute` | async function | 1891 | 1933 | `(args, {stdout, stderr, session, kernel})` | `Promise<number>` | `JSON.parse`, `session.metadata.set`, `kernel._saveSession`, `session.metadata.get`, `session.metadata.delete`, `session.metadata.clear` | `BshShell` | 7 | FS |
| `MintCommand` | class | 1939 | 1950 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 3 | NONE |
| `MintCommand.execute` | async function | 1941 | 1950 | `(args, {kernel, stdout, stderr, session})` | `Promise<number>` | `kernel._tokenManager.mint` | `BshShell` | 4 | NONE |
| `ExportSnapshotCommand` | class | 1955 | 1966 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 3 | FS |
| `ExportSnapshotCommand.execute` | async function | 1957 | 1966 | `(args, {kernel, stdout, stderr, session})` | `Promise<number>` | `SnapshotManager.exportBackend`, `SnapshotManager.toGzippedBase64` | `BshShell` | 4 | FS |
| `ImportSnapshotCommand` | class | 1971 | 1985 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 3 | FS |
| `ImportSnapshotCommand.execute` | async function | 1973 | 1985 | `(args, {kernel, stdin, stdout, stderr, session})` | `Promise<number>` | `SnapshotManager.fromGzippedBase64`, `SnapshotManager.importBackend`, `new TextDecoder` | `BshShell` | 5 | FS |
| `MigrateCommand` | class | 1990 | 2003 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 3 | FS |
| `MigrateCommand.execute` | async function | 1992 | 2003 | `(args, {kernel, stdout, stderr, session})` | `Promise<number>` | `SnapshotManager.exportBackend`, `kernel._zenfsRouter.resolve`, `SnapshotManager.importBackend` | `BshShell` | 5 | FS |
| `UpgradeFsCommand` | class | 2008 | 2108 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 8 | FS |
| `UpgradeFsCommand.execute` | async function | 2010 | 2107 | `(args, {kernel, stdout, stderr, session})` | `Promise<number>` | `kernel._kfs().stat`, `kernel._kfs().readFile`, `JSON.parse`, `new Function`, `SnapshotManager.exportBackend`, `SnapshotManager.importBackend`, `new Date`, `JSON.stringify`, `kernel._zenfsRouter.unmount`, `kernel._zenfsRouter.mount`, `kernel._createThreeLayerFS` | `BshShell` | 8 | FS |
| `ListMountsCommand` | class | 2113 | 2128 | (none) | `void` | (constructor internal) | `KernelJS._initBuiltins` | 2 | FS |
| `ListMountsCommand.execute` | async function | 2115 | 2127 | `(args, {kernel, stdout, stderr, session})` | `Promise<number>` | `kernel._zenfsRouter.list`, `kernel._mountTable.list`, `JSON.stringify` | `BshShell` | 5 | FS |
| `ParentProxy` | class | 2133 | 2162 | `(kernelRun, token)` | `void` | (constructor internal) | `SpawnCommand.create` | 7 | FS |
| `ParentProxy._call` | async function | 2136 | 2138 | `(cmd, opts = {})` | `Promise` | `this._kernelRun` | `ParentProxy` methods | 1 | FS |
| `ChildProxy` | class | 2167 | 2192 | `(token, run, pid)` | `void` | (constructor internal) | `ParentProxy.Spawn.spawnChild` | 5 | FS |
| `ChildProxy._call` | async function | 2171 | 2175 | `(cmd, opts = {})` | `Promise` | `this._run` | `ChildProxy` methods | 3 | FS |
| `AppProxy` | class | 2197 | 2223 | `(token, run)` | `void` | (constructor internal) | (internal kernel) | 4 | FS |
| `AppProxy._call` | async function | 2201 | 2205 | `(cmd, opts = {})` | `Promise` | `this._run` | `AppProxy` methods | 4 | FS |
| `ZenFSRouter` | class | 2228 | 2263 | (none) | `void` | (constructor internal) | `KernelJS` (indirect) | 7 | FS |
| `ZenFSRouter.mount` | function | 2231 | 2238 | `(path, backend, options = {})` | `void` | (none) | `KernelJS._createThreeLayerFS`, `UpgradeFsCommand.execute` | 4 | FS |
| `ZenFSRouter.unmount` | function | 2240 | 2242 | `(path)` | `void` | (none) | `UpgradeFsCommand.execute` | 2 | FS |
| `ZenFSRouter.resolve` | function | 2244 | 2257 | `(path)` | `object/null` | `String` | `KernelJS._createThreeLayerFS` | 5 | FS |
| `ZenFSRouter.list` | function | 2259 | 2261 | (none) | `array` | (none) | `ListMountsCommand.execute` | 2 | FS |
| `MountTable` | class | 2268 | 2284 | (none) | `void` | (constructor internal) | `KernelJS` (indirect) | 6 | FS |
| `MountTable.mount` | function | 2271 | 2272 | `(entry)` | `number` | (none) | `KernelJS._initDeviceMounts` | 2 | FS |
| `MountTable.unmount` | function | 2274 | 2274 | `(id)` | `void` | (none) | (internal kernel) | 1 | FS |
| `MountTable.resolve` | function | 2276 | 2281 | `(path)` | `object` | (none) | `KernelJS._createThreeLayerFS` | 3 | FS |
| `MountTable.list` | function | 2283 | 2283 | (none) | `array` | `Object.keys` | `ListMountsCommand.execute` | 2 | FS |
| `SnapshotManager` | class | 2289 | 2316 | (none) | `void` | (constructor internal) | (internal kernel) | 6 | FS |
| `SnapshotManager.exportBackend` | static async function | 2291 | 2303 | `(backend, mountPoint = '/')` | `Promise<object>` | `backend.readdir`, `backend.stat`, `backend.readFile`, `Array.from` | `ExportSnapshotCommand.execute`, `MigrateCommand.execute`, `UpgradeFsCommand.execute` | 5 | FS |
| `SnapshotManager.importBackend` | static async function | 2305 | 2315 | `(backend, files, mountPoint = '/')` | `Promise<void>` | `backend.mkdir`, `backend.writeFile`, `backend.chmod`, `backend.chown`, `new TextEncoder`, `new Uint8Array` | `ImportSnapshotCommand.execute`, `MigrateCommand.execute`, `UpgradeFsCommand.execute` | 5 | FS |
| `SnapshotManager.toGzippedBase64` | static async function | 2317 | 2321 | `(files)` | `Promise<string>` | `JSON.stringify`, `Date.now`, `new Response`, `new Blob`, `new Uint8Array`, `btoa` | `ExportSnapshotCommand.execute` | 3 | FS |
| `SnapshotManager.fromGzippedBase64` | static async function | 2323 | 2329 | `(gzippedBase64)` | `Promise<object>` | `atob`, `new Uint8Array`, `new Response`, `new Blob`, `new TextDecoder`, `JSON.parse` | `ImportSnapshotCommand.execute` | 4 | FS |
| `LineEditor` | class | 2334 | 2345 | (none) | `void` | (constructor internal) | (not called directly) | 3 | FS |
| `LineEditor.readLines` | static async function | 2336 | 2341 | `(vfs, path, startLine = 1, endLine = undefined)` | `Promise<array>` | `vfs.readFile` | (not called directly) | 3 | FS |
| `LineEditor.replaceLines` | static async function | 2343 | 2347 | `(vfs, path, startLine, endLine, newLines)` | `Promise<void>` | `vfs.readFile`, `vfs.writeFile` | (not called directly) | 3 | FS |
| `LineEditor.deleteLines` | static async function | 2349 | 2349 | `(vfs, path, startLine, endLine)` | `Promise<void>` | `LineEditor.replaceLines` | (not called directly) | 1 | FS |
| `ScopedToken` | class | 2354 | 2372 | `(kernel, options = {})` | `void` | (constructor internal) | (internal kernel) | 5 | NONE |
| `ScopedToken.runCommand` | async function | 2359 | 2366 | `(commandLine)` | `Promise` | `kernel.run` | (internal kernel) | 3 | FS |
| `ScopedToken.expire` | function | 2368 | 2368 | (none) | `void` | `clearTimeout` | (internal kernel) | 1 | NONE |
| `ScopedToken.isValid` | function | 2370 | 2370 | (none) | `boolean` | (none) | (internal kernel) | 1 | NONE |
| `KernelJS` | class | 2377 | 2833 | `(storage = null, options = {})` | `void` | (constructor internal) | `MountainShift` | 12 | FS, EVENT, API, DB |
| `KernelJS._initDeviceMounts` | function | 2862 | 2871 | (none) | `void` | `this._mountTable.mount`, `_platform.crypto.getRandomValues` | (constructor) | 3 | DEVICE |
| `KernelJS._initBuiltins` | function | 2873 | 2879 | (none) | `void` | (multiple class instantiations) | (constructor) | 3 | NONE |
| `KernelJS._createGatedGlobals` | function | 2881 | 2909 | (none) | `object` | `_platform.fetch`, `_platform.WebSocket`, `_platform.indexedDB`, `_platform.crypto.randomUUID` | (constructor) | 7 | API, DB |
| `KernelJS._createFakeIDB` | function | 2911 | 2913 | (none) | `object` | `_platform.crypto.randomUUID` | `KernelJS._createGatedGlobals` | 1 | DB |
| `KernelJS._kfs` | function | 2919 | 2921 | (none) | `object` | (none) | `KernelJS` methods | 1 | FS |
| `KernelJS._setKfs` | function | 2925 | 2931 | `(newBackend)` | `void` | `Object.defineProperty` | `_loadFstab`, `UpgradeFsCommand` | 2 | FS |
| `KernelJS._createThreeLayerFS` | function | 2933 | 3021 | (none) | `Proxy` | `mountTable.resolve`, `zenfsRouter.resolve`, `Object.keys`, `String` | (constructor), `_loadFstab`, `UpgradeFsCommand` | 12 | FS |
| `KernelJS._resolveCommand` | async function | 3023 | 3042 | `(program)` | `Promise<Class/function>` | `this._builtins.get`, `this._commandCache.get`, `this._registry.extensions`, `this._fs.readFile`, `this._compileCommand` | `KernelJS.run` | 6 | FS |
| `KernelJS._compileCommand` | function | 3044 | 3058 | `(source, name)` | `Class/function` | `this._optLibs.get`, `new Function`, `Object.defineProperty` | `KernelJS._resolveCommand`, `PkgCommand.install` | 4 | NONE |
| `KernelJS._checkServiceWorker` | async function | 3060 | 3073 | (none) | `Promise<void>` | `_platform.serviceWorker.ready`, `_platform.serviceWorker.getRegistration` | (constructor) | 5 | API |
| `KernelJS._loadOptLibs` | async function | 3075 | 3087 | (none) | `Promise<void>` | `this._kfs().readdir`, `this._loadOptLib` | (constructor) | 4 | FS |
| `KernelJS._loadOptLib` | async function | 3089 | 3123 | `(name)` | `Promise<void>` | `this._kfs().readFile`, `new Function`, `console.info`, `console.error` | `KernelJS._loadOptLibs` | 7 | FS |
| `KernelJS._loadFstab` | async function | 3130 | 3166 | (none) | `Promise<void>` | `this._kfs().readFile`, `JSON.parse`, `this._kfs().readFile`, `new Function`, `newBackend.stat`, `this._zenfsRouter.unmount`, `this._zenfsRouter.mount`, `this._createThreeLayerFS` | (constructor) | 7 | FS |
| `KernelJS._loadSessions` | async function | 3168 | 3194 | (none) | `Promise<void>` | `this._etcResolver.clearCache`, `this._fs.readdir`, `parseInt`, `this._fs.readFile`, `JSON.parse`, `this._etcResolver.getUserByUid`, `this._fs.unlink`, `Session.fromJSON`, `console.warn` | (constructor) | 6 | FS |
| `KernelJS._saveSession` | async function | 3196 | 3215 | `(userId)` | `Promise<void>` | `this._sessions.get`, `JSON.stringify`, `this._etcResolver.getUserByUid`, `this._fs.writeFile`, `this._fs.chmod`, `this._fs.chown` | `SessionCommand.execute`, `KernelJS.run` | 7 | FS |
| `KernelJS._deleteSessionFile` | async function | 3217 | 3222 | `(userId)` | `Promise<void>` | `this._fs.unlink` | `KernelJS.logout` | 2 | FS |
| `KernelJS.login` | async function | 3224 | 3254 | `(username, password, tty)` | `Promise<Session/null>` | `this._etcResolver.getUser`, `this._etcResolver.verifyPassword`, `this.logout`, `this._fs.readFile`, `JSON.parse`, `Session.fromJSON`, `new Session`, `this._sessions.set`, `this._saveSession`, `this._auditLog.add`, `this._events.emit` | `LoginCommand._complete`, `SuCommand._complete` | 6 | FS, EVENT |
| `KernelJS.logout` | async function | 3256 | 3278 | `(userId)` | `Promise<void>` | `this._sessions.get`, `_platform.removeEventListener`, `this._processes`, `this._tokenManager.revoke`, `this._sessions.delete`, `this._deleteSessionFile`, `this._etcResolver.getUserByUid`, `this._auditLog.add`, `this._events.emit` | `LoginCommand._complete`, `LogoutCommand.execute`, `UserCommand._remove` | 7 | FS, EVENT |
| `KernelJS.run` | async function | 3280 | 3388 | `(commandLine, options = {})` | `Promise<object>` | `_platform.crypto.randomUUID`, `this._sessions.get`, `this._resolveCommand`, `this._shell.execute`, `this._saveSession`, `this._events.emit` | `MountainShift` (factory), `ScopedToken.runCommand` | 12 | FS, EVENT |
| `KernelJS._executeCommandWithToken` | async function | 3390 | 3419 | `(command, session, token)` | `Promise<object>` | `_platform.crypto.randomUUID`, `this._resolveCommand`, `this._shell.execute` | `SudoCommand`, `SudoCommand._complete` | 7 | FS |
| `MountainShift` | function | 3424 | 3466 | `(options = {})` | `Proxy` | `new KernelJS`, `run` | (module export) | 6 | FS, EVENT |
| `MountainShift` (factory internal run) | async function | 3432 | 3461 | `(commandLine, opts = {})` | `Promise<object>` | `kernel.run` | `MountainShift` (proxy) | 6 | FS, EVENT |
</content>
