/**
 * @file PosixCommands.js
 * @author Will Fobbs
 * @description Shared POSIX /bin binary sources + /bin bootstrap, extracted out of
 *   VB6IDE-Alpine.html so any app (the IDE's terminal, the standalone Terminal.dc.html,
 *   future shells) can provision the same filesystem independently — matches a real OS,
 *   where /bin is populated once by the OS install, not by whichever app happens to boot first.
 */
(function(root) {
  'use strict';
  class TermCommand {
    constructor(name, description) { this.name = name; this.description = description || ''; }
    execute(args, ctx) { ctx.push(this.name + ': not implemented'); }
  }
  window.TermCommand = TermCommand;

  const LS_COMMAND_SOURCE =
`/**
 * @file bin/unix.ls.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description List directory contents with full POSIX parameter support.
 *              Supports: -l, -a, -h, -R, -t, -r, -S, -d, --help
 * @example ls -la /bin
 * @example ls -R /usr
 * @example ls --help
 * @principle "Assume no dependencies in classes unless authorized."
 */

class LsCommand {
  static name = 'ls';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'List directory contents with POSIX parameter support.';
  static docs = ['/docs/ls/README.md'];
  static tests = ['/tests/ls/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, cwd, vfs }) {
    let options = {
      long: false, all: false, human: false, recursive: false,
      sortByTime: false, reverse: false, sortBySize: false, dirSelf: false, help: false
    };
    let targets = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--help') {
        options.help = true;
      } else if (arg.startsWith('-')) {
        for (let j = 1; j < arg.length; j++) {
          const flag = arg[j];
          switch (flag) {
            case 'l': options.long = true; break;
            case 'a': options.all = true; break;
            case 'h': options.human = true; break;
            case 'R': options.recursive = true; break;
            case 't': options.sortByTime = true; break;
            case 'r': options.reverse = true; break;
            case 'S': options.sortBySize = true; break;
            case 'd': options.dirSelf = true; break;
            default:
              stderr.write(\`ls: invalid option -- '\${flag}'\\n\`);
              return 1;
          }
        }
      } else {
        targets.push(arg);
      }
    }

    if (options.help) {
      stdout.write(\`Usage: ls [OPTION]... [FILE]...
List information about the FILEs (the current directory by default).

Options:
  -l     use a long listing format
  -a     do not ignore entries starting with .
  -h     with -l, print sizes in human readable format (e.g., 1K, 234M)
  -R     list subdirectories recursively
  -t     sort by modification time, newest first
  -r     reverse order while sorting
  -S     sort by file size, largest first
  -d     list directories themselves, not their contents
  --help display this help and exit
\`);
      return 0;
    }

    if (targets.length === 0) targets = [cwd];

    // Sort flags (-t/-S/-r) also apply to multiple explicit file targets,
    // not just directory contents — stat them up front to order the list.
    if ((options.sortByTime || options.sortBySize) && targets.length > 1) {
      const normalized = targets.map(t => {
        let p = t;
        if (!p.startsWith('/')) p = cwd === '/' ? \`/\${t}\` : \`\${cwd}/\${t}\`;
        return this._normalizePath(p);
      });
      const withStats = await Promise.all(normalized.map(async (p, i) => {
        try { return { target: targets[i], stats: await vfs.stat(p) }; }
        catch (e) { return { target: targets[i], stats: null }; }
      }));
      withStats.sort((a, b) => {
        if (!a.stats || !b.stats) return 0;
        return options.sortByTime ? b.stats.mtimeMs - a.stats.mtimeMs : b.stats.size - a.stats.size;
      });
      if (options.reverse) withStats.reverse();
      targets = withStats.map(w => w.target);
    }

    let first = true;
    for (const target of targets) {
      let path = target;
      if (!path.startsWith('/')) {
        path = cwd === '/' ? \`/\${target}\` : \`\${cwd}/\${target}\`;
      }
      path = this._normalizePath(path);

      let isDir = false;
      try { isDir = (await vfs.stat(path)).isDirectory(); } catch (e) {}

      if (!first && !options.dirSelf && isDir) stdout.write('\\n');
      first = false;

      if (options.dirSelf) {
        await this._listSingle(path, options, stdout, vfs);
      } else {
        await this._listDirectory(path, options, stdout, vfs, '');
      }
    }

    return 0;
  }

  _normalizePath(path) {
    const parts = path.split('/');
    const result = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') { result.pop(); } else { result.push(part); }
    }
    return '/' + result.join('/');
  }

  async _listSingle(path, options, stdout, vfs) {
    try {
      const stats = await vfs.stat(path);
      const name = path.split('/').pop() || path;
      if (options.long) {
        const isDir = stats.isDirectory();
        const perms = (isDir ? 'd' : '-') +
          (stats.mode & 0o400 ? 'r' : '-') +
          (stats.mode & 0o200 ? 'w' : '-') +
          (stats.mode & 0o100 ? 'x' : '-') +
          (stats.mode & 0o040 ? 'r' : '-') +
          (stats.mode & 0o020 ? 'w' : '-') +
          (stats.mode & 0o010 ? 'x' : '-') +
          (stats.mode & 0o004 ? 'r' : '-') +
          (stats.mode & 0o002 ? 'w' : '-') +
          (stats.mode & 0o001 ? 'x' : '-');
        const size = options.human ? this._humanSize(stats.size).padStart(4) : stats.size.toString().padStart(8);
        const date = new Date(stats.mtimeMs);
        const dateStr = \`\${date.getMonth() + 1}/\${date.getDate()} \${date.getHours().toString().padStart(2, '0')}:\${date.getMinutes().toString().padStart(2, '0')}\`;
        stdout.write(\`\${perms} 1 user group \${size} \${dateStr} \${name + (isDir ? '/' : '')}\\n\`);
      } else {
        stdout.write(name + (stats.isDirectory() ? '/' : '') + '\\n');
      }
    } catch (err) {
      stdout.write(\`ls: cannot access '\${path}': \${err.message}\\n\`);
    }
  }

  async _listDirectory(path, options, stdout, vfs, prefix) {
    try {
      const stats = await vfs.stat(path);
      if (!stats.isDirectory()) {
        await this._listSingle(path, options, stdout, vfs);
        return;
      }

      if (options.recursive && prefix === '' && path !== '/') {
        stdout.write(\`\${path}:\\n\`);
      }

      let entries = await vfs.readdir(path);
      if (!options.all) {
        entries = entries.filter(e => !e.startsWith('.'));
      }

      let items = [];
      for (const entry of entries) {
        const fullPath = path === '/' ? \`/\${entry}\` : \`\${path}/\${entry}\`;
        try {
          const entryStats = await vfs.stat(fullPath);
          items.push({ name: entry, path: fullPath, stats: entryStats, isDir: entryStats.isDirectory() });
        } catch (err) {}
      }

      if (options.sortByTime) {
        items.sort((a, b) => b.stats.mtimeMs - a.stats.mtimeMs);
      } else if (options.sortBySize) {
        items.sort((a, b) => b.stats.size - a.stats.size);
      } else {
        items.sort((a, b) => a.name.localeCompare(b.name));
      }

      if (options.reverse) items.reverse();

      if (options.long) {
        let totalBlocks = 0;
        for (const item of items) totalBlocks += Math.ceil(item.stats.size / 1024);
        if (totalBlocks > 0) stdout.write(\`total \${totalBlocks}\\n\`);
        for (const item of items) {
          const perms = (item.isDir ? 'd' : '-') +
            (item.stats.mode & 0o400 ? 'r' : '-') +
            (item.stats.mode & 0o200 ? 'w' : '-') +
            (item.stats.mode & 0o100 ? 'x' : '-') +
            (item.stats.mode & 0o040 ? 'r' : '-') +
            (item.stats.mode & 0o020 ? 'w' : '-') +
            (item.stats.mode & 0o010 ? 'x' : '-') +
            (item.stats.mode & 0o004 ? 'r' : '-') +
            (item.stats.mode & 0o002 ? 'w' : '-') +
            (item.stats.mode & 0o001 ? 'x' : '-');
          const size = options.human ? this._humanSize(item.stats.size).padStart(4) : item.stats.size.toString().padStart(8);
          const date = new Date(item.stats.mtimeMs);
          const dateStr = \`\${date.getMonth() + 1}/\${date.getDate()} \${date.getHours().toString().padStart(2, '0')}:\${date.getMinutes().toString().padStart(2, '0')}\`;
          const name = item.name + (item.isDir ? '/' : '');
          stdout.write(\`\${perms} 1 user group \${size} \${dateStr} \${name}\\n\`);
        }
      } else {
        const maxNameLen = Math.max(...items.map(i => i.name.length + (i.isDir ? 1 : 0)), 0);
        const cols = Math.max(1, Math.floor(80 / (maxNameLen + 2)));
        let output = '';
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          let name = item.name;
          if (item.isDir) name += '/';
          output += name.padEnd(maxNameLen + 2);
          if ((i + 1) % cols === 0 || i === items.length - 1) {
            stdout.write(output.trimEnd() + '\\n');
            output = '';
          }
        }
      }

      if (options.recursive) {
        for (const item of items) {
          if (item.isDir && (options.all || !item.name.startsWith('.'))) {
            const subPath = path === '/' ? \`/\${item.name}\` : \`\${path}/\${item.name}\`;
            stdout.write(\`\\n\${subPath}:\\n\`);
            await this._listDirectory(subPath, options, stdout, vfs, '  ');
          }
        }
      }
    } catch (err) {
      stdout.write(\`ls: cannot access '\${path}': \${err.message}\\n\`);
    }
  }

  _humanSize(bytes) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'K', 'M', 'G', 'T'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = bytes / Math.pow(k, i);
    return (Math.round(val * 10) / 10).toFixed(1) + sizes[i];
  }
}

module.exports = LsCommand;
`;

  const CAT_COMMAND_SOURCE =
`/**
 * @file bin/unix.cat.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Concatenate files with POSIX parameter support.
 *              Supports: -n, -b, -s, -E, --help
 * @example cat -n /bin/ls.js
 * @example cat -E /bin/ls.js
 * @example echo "hello" | cat -n
 * @principle "Assume no dependencies in classes unless authorized."
 */

class CatCommand {
  static name = 'cat';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Concatenate files with POSIX parameter support.';
  static docs = ['/docs/cat/README.md'];
  static tests = ['/tests/cat/unit.js'];
  static config_default = { supportsHeredoc: true, resourceMonitored: true };

  async execute(args, { stdin, stdout, stderr, cwd, vfs }) {
    let options = { number: false, numberNonEmpty: false, squeeze: false, showEnds: false, help: false };
    let files = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--help') {
        options.help = true;
      } else if (arg.startsWith('-')) {
        for (let j = 1; j < arg.length; j++) {
          const flag = arg[j];
          switch (flag) {
            case 'n': options.number = true; break;
            case 'b': options.numberNonEmpty = true; break;
            case 's': options.squeeze = true; break;
            case 'E': options.showEnds = true; break;
            default:
              stderr.write(\`cat: invalid option -- '\${flag}'\\n\`);
              return 1;
          }
        }
      } else {
        files.push(arg);
      }
    }

    if (options.numberNonEmpty) options.number = false;

    if (options.help) {
      stdout.write(\`Usage: cat [OPTION]... [FILE]...
Concatenate FILE(s) to standard output.

Options:
  -n     number all output lines
  -b     number non-empty output lines (overrides -n)
  -s     suppress repeated empty output lines
  -E     display $ at end of each line
  --help display this help and exit
\`);
      return 0;
    }

    let lineNumber = 1;
    let lastLineWasEmpty = false;

    const processLine = (line) => {
      let outputLine = line;
      if (options.squeeze) {
        const isEmpty = line === '';
        if (isEmpty && lastLineWasEmpty) return;
        lastLineWasEmpty = isEmpty;
      }
      if (options.showEnds) outputLine = outputLine + '$';
      if (options.number) {
        outputLine = \`\${String(lineNumber++).padStart(6, ' ')}\\t\${outputLine}\`;
      } else if (options.numberNonEmpty && line !== '') {
        outputLine = \`\${String(lineNumber++).padStart(6, ' ')}\\t\${outputLine}\`;
      }
      stdout.write(outputLine + '\\n');
    };

    const processContent = (content) => {
      const lines = content.split('\\n');
      for (let i = 0; i < lines.length - 1; i++) processLine(lines[i]);
      if (lines[lines.length - 1] !== '') processLine(lines[lines.length - 1]);
    };

    if (files.length === 0) {
      let content = '';
      for await (const chunk of stdin) {
        content += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      }
      processContent(content);
      return 0;
    }

    for (const file of files) {
      let content;
      if (file === '-') {
        let stdinContent = '';
        for await (const chunk of stdin) {
          stdinContent += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        }
        content = stdinContent;
      } else {
        let path = file;
        if (!path.startsWith('/')) path = cwd === '/' ? \`/\${file}\` : \`\${cwd}/\${file}\`;
        try {
          content = await vfs.readFile(path, 'utf8');
        } catch (err) {
          if (err.code === 'ENOENT') stderr.write(\`cat: \${file}: No such file or directory\\n\`);
          else if (err.code === 'EISDIR') stderr.write(\`cat: \${file}: Is a directory\\n\`);
          else stderr.write(\`cat: \${file}: \${err.message}\\n\`);
          return 1;
        }
      }
      processContent(content);
    }

    return 0;
  }
}

module.exports = CatCommand;
`;

  const WHOAMI_COMMAND_SOURCE =
`/**
 * @file /bin/unix.whoami.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Print the current session's effective username.
 * @example whoami
 */
class WhoamiCommand {
  static name = 'whoami';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Print effective username of the current session.';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, session }) {
    stdout.write((session ? session.user() : 'root') + '\\n');
    return 0;
  }
}
module.exports = WhoamiCommand;
`;

  const ID_COMMAND_SOURCE =
`/**
 * @file /bin/unix.id.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Print real/effective uid and gid for the current session's user.
 * @example id
 * @example id otheruser
 */
class IdCommand {
  static name = 'id';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Print uid/gid/groups for the current or named user.';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, stderr, session }) {
    if (!session) { stderr.write('id: no session context\\n'); return 1; }
    if (!args[0] && !session.isActive()) { stderr.write('id: no active session — try login <user>\\n'); return 1; }
    const name = args[0] || session.user();
    const users = session.users();
    const u = users[name];
    if (!u) { stderr.write('id: ' + name + ': no such user\\n'); return 1; }
    stdout.write('uid=' + u.uid + '(' + name + ') gid=' + u.gid + '(' + name + ') groups=' + u.gid + '(' + name + ')\\n');
    return 0;
  }
}
module.exports = IdCommand;
`;

  const USERADD_COMMAND_SOURCE =
`/**
 * @file /bin/unix.useradd.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Create a new user (root only).
 * @example useradd alice
 * @example useradd alice secretpw
 */
class UseraddCommand {
  static name = 'useradd';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Create a new user account (root only).';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, stderr, session }) {
    if (!session) { stderr.write('useradd: no session context\\n'); return 1; }
    if (!args[0]) { stderr.write('Usage: useradd <username> [password]\\n'); return 1; }
    const res = await session.useradd(args[0], args[1]);
    if (res && res.error) { stderr.write('useradd: ' + res.error + '\\n'); return 1; }
    stdout.write('Created user ' + args[0] + ' (uid=' + res.uid + ').\\n');
    return 0;
  }
}
module.exports = UseraddCommand;
`;

  const LOGOUT_COMMAND_SOURCE =
`/**
 * @file /bin/unix.logout.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description End the current terminal session. Requires login to resume.
 * @example logout
 */
class LogoutCommand {
  static name = 'logout';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'End the current session.';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, stderr, session }) {
    if (!session) { stderr.write('logout: no session context\\n'); return 1; }
    const res = session.logout();
    if (res && res.error) { stderr.write('logout: ' + res.error + '\\n'); return 1; }
    stdout.write('Logged out.\\n');
    return 0;
  }
}
module.exports = LogoutCommand;
`;

  const LOGIN_COMMAND_SOURCE =
`/**
 * @file /bin/unix.login.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Switch the terminal session's effective user (browser env: no password check).
 * @example login
 * @example login guest
 */
class LoginCommand {
  static name = 'login';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Switch the current session to another known user.';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, stderr, session }) {
    if (!session) { stderr.write('login: no session context\\n'); return 1; }
    if (!args[0]) { stdout.write('Currently logged in as ' + session.user() + '.\\nUsage: login <username> [password]\\n'); return 0; }
    const res = await session.login(args[0], args[1]);
    if (res && res.error) { stderr.write('login: ' + res.error + '\\n'); return 1; }
    stdout.write('Logged in as ' + args[0] + '.\\n');
    return 0;
  }
}
module.exports = LoginCommand;
`;

  const WHO_COMMAND_SOURCE =
`/**
 * @file /bin/unix.who.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Show who is logged in on the current session.
 * @example who
 */
class WhoCommand {
  static name = 'who';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Show the logged-in session, tty, and login time.';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, session }) {
    if (!session || !session.isActive()) { stdout.write('who: no active session\\n'); return 0; }
    const t = new Date(session.loginTime());
    stdout.write(session.user().padEnd(10) + 'tty0'.padEnd(8) + t.toISOString().replace('T', ' ').slice(0, 16) + '\\n');
    return 0;
  }
}
module.exports = WhoCommand;
`;

  const W_COMMAND_SOURCE =
`/**
 * @file /bin/unix.w.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Show who is logged in and what they are currently running (foreground job).
 * @example w
 */
class WCommand {
  static name = 'w';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Show logged-in user, idle time, and current foreground job.';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, session }) {
    if (!session || !session.isActive()) { stdout.write('w: no active session\\n'); return 0; }
    const t = new Date(session.loginTime());
    const idleMs = Date.now() - session.loginTime();
    const idleMin = Math.floor(idleMs / 60000);
    let what = '-';
    if (typeof Procd !== 'undefined') {
      const jobs = Procd.ps();
      const fg = jobs.filter(j => j.state === 'foreground' && j.id !== 0);
      if (fg.length) what = fg.map(j => j.name).join(',');
    }
    stdout.write('USER'.padEnd(10) + 'TTY'.padEnd(8) + 'LOGIN@'.padEnd(18) + 'IDLE'.padEnd(8) + 'WHAT\\n');
    stdout.write(session.user().padEnd(10) + 'tty0'.padEnd(8) + t.toISOString().replace('T', ' ').slice(0, 16).padEnd(18) + (idleMin + 'm').padEnd(8) + what + '\\n');
    return 0;
  }
}
module.exports = WCommand;
`;

  const LAST_COMMAND_SOURCE =
`/**
 * @file /bin/unix.last.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Show session login/logout history for this Terminal instance.
 * @example last
 */
class LastCommand {
  static name = 'last';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Show login session history (most recent first).';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, session }) {
    if (!session) { stdout.write('(no session context)\\n'); return 0; }
    const log = session.log().slice().reverse();
    if (!log.length) { stdout.write('last: no session history yet\\n'); return 0; }
    log.forEach(e => {
      const t = new Date(e.time).toISOString().replace('T', ' ').slice(0, 19);
      stdout.write(e.user.padEnd(10) + 'tty0'.padEnd(8) + e.action.padEnd(8) + t + '\\n');
    });
    return 0;
  }
}
module.exports = LastCommand;
`;

  const CHMOD_COMMAND_SOURCE =
`/**
 * @file /bin/unix.chmod.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Change the permission bits of a file (octal mode, e.g. 644, 755).
 * @example chmod 644 /home/notes.txt
 */
class ChmodCommand {
  static name = 'chmod';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Change permission bits of a file (octal mode only).';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, stderr, vfs }) {
    if (args.length < 2) { stderr.write('Usage: chmod <octal-mode> <path>\\n'); return 1; }
    const mode = parseInt(args[0], 8);
    if (isNaN(mode)) { stderr.write('chmod: invalid mode: ' + args[0] + '\\n'); return 1; }
    for (const target of args.slice(1)) {
      try { await vfs.chmod(target, mode); }
      catch (e) { stderr.write('chmod: ' + target + ': ' + e.message + '\\n'); return 1; }
    }
    return 0;
  }
}
module.exports = ChmodCommand;
`;

  const CHOWN_COMMAND_SOURCE =
`/**
 * @file /bin/unix.chown.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Change the owning user (and optionally group) of a file.
 * @example chown guest /home/notes.txt
 * @example chown guest:guest /home/notes.txt
 */
class ChownCommand {
  static name = 'chown';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Change owner (and optionally group) of a file, by username.';
  static config_default = { supportsHeredoc: false, resourceMonitored: false };
  async execute(args, { stdout, stderr, vfs, session }) {
    if (args.length < 2) { stderr.write('Usage: chown <user>[:group] <path>\\n'); return 1; }
    const [userSpec, ...targets] = args;
    const [userName, groupName] = userSpec.split(':');
    const users = session ? session.users() : {};
    const u = users[userName];
    if (!u) { stderr.write('chown: invalid user: ' + userName + '\\n'); return 1; }
    const gid = groupName && users[groupName] ? users[groupName].gid : u.gid;
    for (const target of targets) {
      try { await vfs.chown(target, u.uid, gid); }
      catch (e) { stderr.write('chown: ' + target + ': ' + e.message + '\\n'); return 1; }
    }
    return 0;
  }
}
module.exports = ChownCommand;
`;

  const MNT_COMMAND_SOURCE =
`/**
 * @file /bin/unix.mnt.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description List mounted filesystems. Each vfs instance (FileFsX) is a Mount.
 * @example mnt
 * @example mnt --help
 * @principle "Assume no dependencies in classes unless authorized."
 */

class MntCommand {
  static name = 'mnt';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'List and inspect mounted filesystems (each FileFsX instance is a Mount).';
  static docs = ['/docs/mnt/README.md'];
  static tests = ['/tests/mnt/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, vfs }) {
    if (args[0] === '--help') {
      stdout.write(\`Usage: mnt [--help]

List mounted filesystems. Each vfs instance (FileFsX) is a Mount.

  --help  display this help and exit
\`);
      return 0;
    }
    if (typeof vfs.mounts !== 'function') {
      stderr.write('mnt: mount table not available on this vfs\\n');
      return 1;
    }
    const mounts = await vfs.mounts();
    if (!mounts.length) { stdout.write('No mounts.\\n'); return 0; }
    for (const m of mounts) {
      stdout.write(\`\${m.device} on \${m.path} type \${m.type} (\${m.options})\\n\`);
    }
    return 0;
  }
}

module.exports = MntCommand;
`;

  const LLM_CHAT_COMMAND_SOURCE =
`class LlmChatCommand {
  static name = 'llm';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Chat with the shared llmd daemon: llm chat <text>, llm chat --repl, or llm session [list|save|select|delete|export|replay --stream].';
  static docs = ['/docs/llm/README.md'];
  static tests = ['/tests/llm/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, system }) {
    const llmd = system && system.llmd;
    if (!llmd) { stderr.write('llm: llmd not available in this host\\n'); return 1; }
    const sub = args[0];
    if (sub === 'session') return this.runSession(args.slice(1), { stdout, stderr, system });
    if (sub !== 'chat') { stderr.write('llm: usage: llm chat <text> | llm session [list|select|delete|export|import|replay]\\n'); return 1; }
    const text = args.slice(1).join(' ');
    if (!text) { stderr.write('llm: usage: llm chat <text>\\n'); return 1; }
    if (!llmd.isReady()) {
      stdout.write('llm: no model loaded \\u2014 loading default model, this can take a while...\\n');
      try { await llmd.loadModel('Llama-3.2-1B-Instruct-q4f16_1-MLC'); }
      catch (e) { stderr.write('llm: ' + e.message + '\\n'); return 1; }
    }
    const contextId = (system.contextId) || 'terminal';
    try {
      await llmd.chat(contextId, text, (tok) => stdout.write(tok));
      stdout.write('\\n');
      return 0;
    } catch (e) { stderr.write('llm: ' + e.message + '\\n'); return 1; }
  }

  async runSession(args, { stdout, stderr, system }) {
    const llmd = system.llmd;
    const contextId = system.contextId || 'terminal';
    const verb = args[0];
    try {
      if (verb === 'list') {
        const rows = await llmd.listSessions();
        if (!rows.length) { stdout.write('no saved sessions\\n'); return 0; }
        rows.forEach(r => stdout.write(\`  \${r.id}  \${r.baseModelId}  \${r.messages.length} msgs  \${new Date(r.savedAt).toLocaleString()}  \${r.label}\\n\`));
        return 0;
      }
      if (verb === 'save') { const id = await llmd.saveSession(contextId, args[1]); stdout.write('saved: ' + id + '\\n'); return 0; }
      if (verb === 'select') { const id = args[1]; if (!id) { stderr.write('llm session select <id>\\n'); return 1; } await llmd.selectSession(id, contextId); stdout.write('selected: ' + id + '\\n'); return 0; }
      if (verb === 'delete') { const id = args[1]; if (!id) { stderr.write('llm session delete <id>\\n'); return 1; } await llmd.deleteSession(id); stdout.write('deleted: ' + id + '\\n'); return 0; }
      if (verb === 'export') { const id = args[1]; if (!id) { stderr.write('llm session export <id>\\n'); return 1; } stdout.write(await llmd.exportSession(id) + '\\n'); return 0; }
      if (verb === 'import') { stderr.write('llm session import: pass JSON via a follow-up capability \\u2014 not wired to a file arg yet\\n'); return 1; }
      if (verb === 'replay') {
        const id = args[1]; const streamed = args.includes('--stream');
        if (!id) { stderr.write('llm session replay <id> [--stream]\\n'); return 1; }
        await llmd.replaySession(id, (t) => stdout.write(t), streamed);
        return 0;
      }
      stderr.write('llm session: usage: list | save [label] | select <id> | delete <id> | export <id> | import <file> | replay <id> [--stream]\\n');
      return 1;
    } catch (e) { stderr.write('llm session: ' + e.message + '\\n'); return 1; }
  }
}

module.exports = LlmChatCommand;
`;

    const UNIX_PS_COMMAND_SOURCE =
`
class UnixPsCommand {
  static name = 'ps';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Report the real Kernel process table (pid/user/cmd).';
  static docs = ['/docs/ps/README.md'];
  static tests = ['/tests/ps/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, system }) {
    if (!system || !system.kernel) { stderr.write('ps: kernel not booted\\n'); return 1; }
    if (system.procd) system.procd.fg(0);
    const rows = system.kernel.ps();
    stdout.write('  PID  USER      CMD\\n');
    rows.forEach(p => stdout.write(\`  \${String(p.pid).padEnd(4)} \${String(p.user || 'root').padEnd(9)} \${p.cmd}\\n\`));
    return 0;
  }
}

module.exports = UnixPsCommand;
`;

  const UNIX_JOBS_COMMAND_SOURCE =
`
class UnixJobsCommand {
  static name = 'jobs';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'List Procd job-control jobs (shell jobs, not Kernel processes).';
  static docs = ['/docs/jobs/README.md'];
  static tests = ['/tests/jobs/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, system }) {
    if (!system || !system.procd) { stderr.write('jobs: Procd not loaded\\n'); return 1; }
    if (system.ensureAttached) system.ensureAttached();
    system.procd.fg(0);
    const list = system.procd.ps();
    stdout.write('  ID NAME                  STATE\\n');
    list.forEach(j => stdout.write(\`  \${String(j.id).padStart(2)}   \${String(j.name).padEnd(21)} \${j.state}\\n\`));
    return 0;
  }
}

module.exports = UnixJobsCommand;
`;

  const UNIX_FG_COMMAND_SOURCE =
`
class UnixFgCommand {
  static name = 'fg';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Bring a Procd job to the foreground (job id 0 = plain console).';
  static docs = ['/docs/fg/README.md'];
  static tests = ['/tests/fg/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, system }) {
    if (!system || !system.procd) { stderr.write('fg: Procd not loaded\\n'); return 1; }
    const id = parseInt(args[0], 10);
    if (!Number.isInteger(id)) { stderr.write('fg: usage: fg <id>\\n'); return 1; }
    try { system.procd.fg(id); } catch (e) { stderr.write('fg: ' + e.message + '\\n'); return 1; }
    const list = system.procd.ps();
    stdout.write('  ID NAME                  STATE\\n');
    list.forEach(j => stdout.write(\`  \${String(j.id).padStart(2)}   \${String(j.name).padEnd(21)} \${j.state}\\n\`));
    return 0;
  }
}

module.exports = UnixFgCommand;
`;

  const UNIX_BG_COMMAND_SOURCE =
`
class UnixBgCommand {
  static name = 'bg';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Resume a suspended Procd job in the background.';
  static docs = ['/docs/bg/README.md'];
  static tests = ['/tests/bg/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, system }) {
    if (!system || !system.procd) { stderr.write('bg: Procd not loaded\\n'); return 1; }
    const id = parseInt(args[0], 10);
    if (!Number.isInteger(id)) { stderr.write('bg: usage: bg <id>\\n'); return 1; }
    try { system.procd.bg(id); } catch (e) { stderr.write('bg: ' + e.message + '\\n'); return 1; }
    const list = system.procd.ps();
    stdout.write('  ID NAME                  STATE\\n');
    list.forEach(j => stdout.write(\`  \${String(j.id).padStart(2)}   \${String(j.name).padEnd(21)} \${j.state}\\n\`));
    return 0;
  }
}

module.exports = UnixBgCommand;
`;

  const UNIX_KILL_COMMAND_SOURCE =
`
class UnixKillCommand {
  static name = 'kill';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Terminate a real Kernel process by pid.';
  static docs = ['/docs/kill/README.md'];
  static tests = ['/tests/kill/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, system }) {
    const pid = parseInt(args[0], 10);
    if (!Number.isInteger(pid)) { stderr.write('kill: usage: kill <pid>\\n'); return 1; }
    if (!system || !system.kernel) { stderr.write('kill: kernel not booted\\n'); return 1; }
    system.kernel.kill(pid);
    stdout.write(\`kill: pid \${pid} terminated\\n\`);
    return 0;
  }
}

module.exports = UnixKillCommand;
`;

  const UNIX_TOP_COMMAND_SOURCE =
`
class UnixTopCommand {
  static name = 'top';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Real Kernel process monitor - registers a live-updating Procd job; the host terminal owns the redraw loop.';
  static docs = ['/docs/top/README.md'];
  static tests = ['/tests/top/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, system }) {
    if (!system || !system.startTop) { stderr.write('top: not supported by this host\\n'); return 1; }
    system.startTop();
    return 0;
  }
}

module.exports = UnixTopCommand;
`;

  const PROCD_DEMO_COMMAND_SOURCE =
`
class ProcdDemoCommand {
  static name = 'demo';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Run a Procd job-control demo: lasagna | chart | downloads | anomaly-scan, --ui or --console (default).';
  static docs = ['/docs/demo/README.md'];
  static tests = ['/tests/demo/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  async execute(args, { stdout, stderr, system }) {
    if (!system || !system.procd) { stderr.write('demo: Procd not loaded\\n'); return 1; }
    if (system.ensureAttached) system.ensureAttached();
    try {
      const r = system.procd.run('demo ' + args.join(' '));
      if (typeof r === 'string') stdout.write(r + '\\n');
      return 0;
    } catch (e) { stderr.write(e.message + '\\n'); return 1; }
  }
}

module.exports = ProcdDemoCommand;
`;

  const MAN_COMMAND_SOURCE = (function(){ const bin = atob("LyoqCiAqIEBmaWxlIC9iaW4vbWFuLmpzCiAqIEBhdXRob3IgV2lsbCBGb2JicwogKiBAdmVyc2lvbiAzLjAuMAogKiBAZGVzY3JpcHRpb24gVW5pZmllZCBtYW4gcGFnZSDigJMgc3RhdGljIHByb3BlcnRpZXMgKyBtZXRob2QgZG9jYmxvY2tzIChyZWZsZWN0aW9uICsgc291cmNlIHBhcnNpbmcpCiAqLwoKKGZ1bmN0aW9uKHJvb3QsIGZhY3RvcnkpIHsKICBpZiAodHlwZW9mIG1vZHVsZSA9PT0gJ29iamVjdCcgJiYgbW9kdWxlLmV4cG9ydHMpIG1vZHVsZS5leHBvcnRzID0gZmFjdG9yeSgpOwogIGVsc2UgaWYgKHR5cGVvZiBkZWZpbmUgPT09ICdmdW5jdGlvbicgJiYgZGVmaW5lLmFtZCkgZGVmaW5lKFtdLCBmYWN0b3J5KTsKICBlbHNlIHJvb3QuTWFuQ29tbWFuZCA9IGZhY3RvcnkoKTsKfSh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcgPyBzZWxmIDogdGhpcywgZnVuY3Rpb24oKSB7CiAgY2xhc3MgTWFuQ29tbWFuZCB7CiAgICBzdGF0aWMgbmFtZSA9ICdtYW4nOwogICAgc3RhdGljIGF1dGhvciA9ICdXaWxsIEZvYmJzJzsKICAgIHN0YXRpYyB2ZXJzaW9uID0gJzMuMC4wJzsKICAgIHN0YXRpYyBkZXNjcmlwdGlvbiA9ICdEaXNwbGF5IG1hbnVhbCBwYWdlcyBmb3IgY29yZSBjb21tYW5kcyBhbmQgdXNlciBmaWxlcy4nOwogICAgc3RhdGljIGRvY3MgPSBbJy9kb2NzL21hbi9SRUFETUUubWQnXTsKICAgIHN0YXRpYyB0ZXN0cyA9IFsnL3Rlc3RzL21hbi91bml0LmpzJ107CiAgICBzdGF0aWMgY29uZmlnX2RlZmF1bHQgPSB7IHN1cHBvcnRzSGVyZWRvYzogZmFsc2UsIHJlc291cmNlTW9uaXRvcmVkOiB0cnVlIH07CgogICAgLy8gLS0tLS0tLS0tLSBKU0RvYyBwYXJzZXIgKGNsYXNzLWxldmVsIGFuZCBtZXRob2QtbGV2ZWwpIC0tLS0tLS0tLS0KICAgIF9wYXJzZUpTRG9jKGNvbnRlbnQpIHsKICAgICAgY29uc3QganNkb2NNYXRjaCA9IGNvbnRlbnQubWF0Y2goL1wvXCpcKihbXHNcU10qPylcKlwvLyk7CiAgICAgIGlmICghanNkb2NNYXRjaCkgcmV0dXJuIG51bGw7CiAgICAgIGNvbnN0IGpzZG9jID0ganNkb2NNYXRjaFsxXS5zcGxpdCgnXG4nKS5tYXAobCA9PiBsLnJlcGxhY2UoL15ccypcKlxzKi8sICcnKSkuam9pbignXG4nKTsKICAgICAgY29uc3QgcmVzdWx0ID0ge307CiAgICAgIGNvbnN0IHRhZ3MgPSBbJ2ZpbGUnLCAnYXV0aG9yJywgJ3ZlcnNpb24nLCAnZGVzY3JpcHRpb24nLCAncGFyYW0nLCAncmV0dXJucycsCiAgICAgICAgICAgICAgICAgICAgJ3Rocm93cycsICdleGFtcGxlJywgJ2ZlYXR1cmVzJywgJ3BhdHRlcm4nLCAncmF0aW9uYWxlJywKICAgICAgICAgICAgICAgICAgICAncHJpbmNpcGxlJywgJ0FJX0luc3RydWN0aW9ucyddOwogICAgICBmb3IgKGNvbnN0IHRhZyBvZiB0YWdzKSB7CiAgICAgICAgY29uc3QgcmVnZXggPSBuZXcgUmVnRXhwKGBAJHt0YWd9XFxzKyhbXkBdKylgLCAnZycpOwogICAgICAgIGNvbnN0IG1hdGNoZXMgPSBbLi4uanNkb2MubWF0Y2hBbGwocmVnZXgpXTsKICAgICAgICBpZiAobWF0Y2hlcy5sZW5ndGgpIHsKICAgICAgICAgIHJlc3VsdFt0YWddID0gbWF0Y2hlcy5tYXAobSA9PiBtWzFdLnRyaW0oKSkuam9pbignXG4nKTsKICAgICAgICB9CiAgICAgIH0KICAgICAgcmV0dXJuIHJlc3VsdDsKICAgIH0KCiAgICBfZXh0cmFjdE1ldGhvZERvY2Jsb2Nrcyhzb3VyY2VDb2RlKSB7CiAgICAgIGNvbnN0IG1ldGhvZEJsb2NrcyA9IG5ldyBNYXAoKTsKICAgICAgY29uc3QgcmVnZXggPSAvXC9cKlwqKFtcc1xTXSo/KVwqXC9ccyooXHcrKVxzKlwoL2c7CiAgICAgIGxldCBtYXRjaDsKICAgICAgd2hpbGUgKChtYXRjaCA9IHJlZ2V4LmV4ZWMoc291cmNlQ29kZSkpICE9PSBudWxsKSB7CiAgICAgICAgY29uc3QganNkb2MgPSBtYXRjaFsxXS5zcGxpdCgnXG4nKS5tYXAobCA9PiBsLnJlcGxhY2UoL15ccypcKlxzKi8sICcnKSkuam9pbignXG4nKTsKICAgICAgICBjb25zdCBtZXRob2ROYW1lID0gbWF0Y2hbMl07CiAgICAgICAgY29uc3QgcmVzdWx0ID0ge307CiAgICAgICAgY29uc3QgdGFncyA9IFsncGFyYW0nLCAncmV0dXJucycsICd0aHJvd3MnLCAnZXhhbXBsZSddOwogICAgICAgIGZvciAoY29uc3QgdGFnIG9mIHRhZ3MpIHsKICAgICAgICAgIGNvbnN0IHRhZ1JlZ2V4ID0gbmV3IFJlZ0V4cChgQCR7dGFnfVxccysoW15AXSspYCwgJ2cnKTsKICAgICAgICAgIGNvbnN0IG1hdGNoZXMgPSBbLi4uanNkb2MubWF0Y2hBbGwodGFnUmVnZXgpXTsKICAgICAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCkgewogICAgICAgICAgICByZXN1bHRbdGFnXSA9IG1hdGNoZXMubWFwKG0gPT4gbVsxXS50cmltKCkpLmpvaW4oJ1xuJyk7CiAgICAgICAgICB9CiAgICAgICAgfQogICAgICAgIGlmIChPYmplY3Qua2V5cyhyZXN1bHQpLmxlbmd0aCA+IDApIHsKICAgICAgICAgIG1ldGhvZEJsb2Nrcy5zZXQobWV0aG9kTmFtZSwgcmVzdWx0KTsKICAgICAgICB9CiAgICAgIH0KICAgICAgcmV0dXJuIG1ldGhvZEJsb2NrczsKICAgIH0KCiAgICAvKioKICAgICAqIEV4ZWN1dGVzIHRoZSBtYW4gY29tbWFuZC4KICAgICAqIEBwYXJhbSB7QXJyYXk8c3RyaW5nPn0gYXJncyAtIENvbW1hbmQgbGluZSBhcmd1bWVudHMuCiAgICAgKiAgIC0gbGlzdCBjb3JlLiogOiBsaXN0IGFsbCBjb3JlIGNvbW1hbmRzCiAgICAgKiAgIC0gc2hvdyBjb3JlLjxjbWQ+IFstLWZpZWxkXSA6IHNob3cgY29tbWFuZCBkZXRhaWxzIChhdXRob3IsIHZlcnNpb24sIGRlc2NyaXB0aW9uLCBkb2NzLCB0ZXN0cywgY29uZmlnLCBtZXRob2RzKQogICAgICogICAtIGRvY3MgY29yZS48Y21kPiBbLS1zaG93IDxpbmRleD5dIDogc2hvdyBkb2N1bWVudGF0aW9uIGZpbGVzCiAgICAgKiAgIC0gdGVzdHMgY29yZS48Y21kPiA6IHNob3cgdGVzdCBmaWxlIHBhdGhzCiAgICAgKiAgIC0gPGZpbGUuanM+IDogZGlzcGxheSBKU0RvYyBmcm9tIGEgSmF2YVNjcmlwdCBmaWxlCiAgICAgKiBAcGFyYW0ge09iamVjdH0gY29udGV4dCAtIEV4ZWN1dGlvbiBjb250ZXh0LgogICAgICogQHBhcmFtIHtPYmplY3R9IGNvbnRleHQuc3RkaW4gLSBBc3luYyBpdGVyYWJsZSBzdGRpbi4KICAgICAqIEBwYXJhbSB7T2JqZWN0fSBjb250ZXh0LnN0ZG91dCAtIFdyaXRlYWJsZSBzdHJlYW0gZm9yIHN0ZG91dC4KICAgICAqIEBwYXJhbSB7T2JqZWN0fSBjb250ZXh0LnN0ZGVyciAtIFdyaXRlYWJsZSBzdHJlYW0gZm9yIHN0ZGVyci4KICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb250ZXh0LmN3ZCAtIEN1cnJlbnQgd29ya2luZyBkaXJlY3RvcnkuCiAgICAgKiBAcGFyYW0ge09iamVjdH0gY29udGV4dC52ZnMgLSBWaXJ0dWFsIGZpbGUgc3lzdGVtIGluc3RhbmNlLgogICAgICogQHJldHVybnMge1Byb21pc2U8bnVtYmVyPn0gRXhpdCBjb2RlICgwIHN1Y2Nlc3MsIDEgZXJyb3IpLgogICAgICogQGV4YW1wbGUKICAgICAqIG1hbiBsaXN0IGNvcmUuKgogICAgICogbWFuIHNob3cgY29yZS5scyAtLWF1dGhvcgogICAgICogbWFuIGRvY3MgY29yZS5lZGl0IC0tc2hvdyAwCiAgICAgKiBtYW4gL2xpYi96X2F0dGVudGlvbi5qcwogICAgICovCiAgICBhc3luYyBfcmVzb2x2ZUNvbW1hbmRGaWxlKHZmcywgY21kUmVmKSB7CiAgICAgIGNvbnN0IGNtZE5hbWUgPSBjbWRSZWYuaW5jbHVkZXMoJy4nKSA/IGNtZFJlZi5zcGxpdCgnLicpLnBvcCgpIDogY21kUmVmOwogICAgICBjb25zdCBmaWxlcyA9IGF3YWl0IHZmcy5yZWFkZGlyKCcvYmluJyk7CiAgICAgIGZvciAoY29uc3QgZiBvZiBmaWxlcykgewogICAgICAgIHRyeSB7CiAgICAgICAgICBjb25zdCBjbHMgPSBhd2FpdCB2ZnMucmVhZENsYXNzKGAvYmluLyR7Zn1gKTsKICAgICAgICAgIGlmIChjbHMgJiYgY2xzLm5hbWUgPT09IGNtZE5hbWUpIHJldHVybiB7IHBhdGg6IGAvYmluLyR7Zn1gLCBjbWRDbGFzczogY2xzIH07CiAgICAgICAgfSBjYXRjaCAoZSkgeyAvKiBpZ25vcmUgKi8gfQogICAgICB9CiAgICAgIHJldHVybiBudWxsOwogICAgfQoKICAgIGFzeW5jIGV4ZWN1dGUoYXJncywgY29udGV4dCkgewogICAgICBjb25zdCB7IHN0ZG91dCwgc3RkZXJyLCB2ZnMsIGN3ZCB9ID0gY29udGV4dDsKICAgICAgaWYgKGFyZ3MubGVuZ3RoID09PSAwIHx8IGFyZ3NbMF0gPT09ICctLWhlbHAnKSB7CiAgICAgICAgc3Rkb3V0LndyaXRlKGBVc2FnZTogbWFuIDxjb21tYW5kPiBbYXJnc10KCkRpc3BsYXkgbWFudWFsIHBhZ2VzIGZvciBjb3JlIGNvbW1hbmRzIGFuZCB1c2VyIGZpbGVzLgoKICBtYW4gbGlzdCBjb3JlLiogICAgICAgICAgICAgICAgICAgbGlzdCBhbGwgY29yZSBjb21tYW5kcwogIG1hbiBzaG93IGNvcmUuPGNtZD4gWy0tZmllbGRdICAgICBzaG93IGNvbW1hbmQgZGV0YWlscyAoYXV0aG9yLCB2ZXJzaW9uLCBkZXNjcmlwdGlvbiwgZG9jcywgdGVzdHMsIGNvbmZpZywgbWV0aG9kcykKICBtYW4gZG9jcyBjb3JlLjxjbWQ+IFstLXNob3cgPG4+XSAgc2hvdyBkb2N1bWVudGF0aW9uIGZpbGVzCiAgbWFuIHRlc3RzIGNvcmUuPGNtZD4gICAgICAgICAgICAgIHNob3cgdGVzdCBmaWxlIHBhdGhzCiAgbWFuIDxmaWxlLmpzPiAgICAgICAgICAgICAgICAgICAgIGRpc3BsYXkgSlNEb2MgZnJvbSBhIEphdmFTY3JpcHQgZmlsZQogIG1hbiAtLWhlbHAgICAgICAgICAgICAgICAgICAgICAgICBkaXNwbGF5IHRoaXMgaGVscCBhbmQgZXhpdApgKTsKICAgICAgICByZXR1cm4gYXJncy5sZW5ndGggPT09IDAgPyAxIDogMDsKICAgICAgfQoKICAgICAgLy8gLS0tLSBDb3JlIGNvbW1hbmQgaW50cm9zcGVjdGlvbiAoc3RhdGljIHByb3BlcnRpZXMgKyBtZXRob2RzKSAtLS0tCiAgICAgIGlmIChhcmdzWzBdID09PSAnbGlzdCcpIHsKICAgICAgICBjb25zdCB0YXJnZXQgPSBhcmdzWzFdOwogICAgICAgIGlmICh0YXJnZXQgJiYgdGFyZ2V0LmVuZHNXaXRoKCcuKicpKSB7CiAgICAgICAgICBjb25zdCBuc1ByZWZpeCA9IHRhcmdldC5zbGljZSgwLCAtMik7CiAgICAgICAgICBjb25zdCBmaWxlcyA9IGF3YWl0IHZmcy5yZWFkZGlyKCcvYmluJyk7CiAgICAgICAgICBjb25zdCBmaWx0ZXJlZCA9IChuc1ByZWZpeCAmJiBuc1ByZWZpeCAhPT0gJ2NvcmUnKSA/IGZpbGVzLmZpbHRlcihmID0+IGYuc3RhcnRzV2l0aChuc1ByZWZpeCArICcuJykpIDogZmlsZXM7CiAgICAgICAgICBmb3IgKGNvbnN0IGYgb2YgZmlsdGVyZWQpIHsKICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICBjb25zdCBjbWRDbGFzcyA9IGF3YWl0IHZmcy5yZWFkQ2xhc3MoYC9iaW4vJHtmfWApOwogICAgICAgICAgICAgIGlmIChjbWRDbGFzcyAmJiBjbWRDbGFzcy5uYW1lKSB7CiAgICAgICAgICAgICAgICBzdGRvdXQud3JpdGUoYCR7Y21kQ2xhc3MubmFtZX0g4oCTICR7Y21kQ2xhc3MuZGVzY3JpcHRpb24gfHwgJ05vIGRlc2NyaXB0aW9uJ31cbmApOwogICAgICAgICAgICAgIH0KICAgICAgICAgICAgfSBjYXRjaChlKSB7IC8qIGlnbm9yZSAqLyB9CiAgICAgICAgICB9CiAgICAgICAgICByZXR1cm4gMDsKICAgICAgICB9CiAgICAgICAgc3RkZXJyLndyaXRlKGBVbmtub3duIG5hbWVzcGFjZTogJHt0YXJnZXR9XG5gKTsKICAgICAgICByZXR1cm4gMTsKICAgICAgfQoKICAgICAgaWYgKGFyZ3NbMF0gPT09ICdzaG93JykgewogICAgICAgIGNvbnN0IGNtZFJlZiA9IGFyZ3NbMV07CiAgICAgICAgaWYgKCFjbWRSZWYpIHsKICAgICAgICAgIHN0ZGVyci53cml0ZSgnVXNhZ2U6IG1hbiBzaG93IDxjb21tYW5kPiBbLS1maWVsZF1cbicpOwogICAgICAgICAgcmV0dXJuIDE7CiAgICAgICAgfQogICAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5fcmVzb2x2ZUNvbW1hbmRGaWxlKHZmcywgY21kUmVmKTsKICAgICAgICBpZiAoIXJlc29sdmVkKSB7CiAgICAgICAgICBzdGRlcnIud3JpdGUoYENvbW1hbmQgJHtjbWRSZWZ9IG5vdCBmb3VuZC5cbmApOwogICAgICAgICAgcmV0dXJuIDE7CiAgICAgICAgfQogICAgICAgIGNvbnN0IHsgcGF0aDogZnVsbFBhdGgsIGNtZENsYXNzIH0gPSByZXNvbHZlZDsKICAgICAgICBjb25zdCBjbWROYW1lID0gY21kQ2xhc3MubmFtZTsKICAgICAgICBjb25zdCBmaWVsZEZsYWcgPSBhcmdzWzJdOwogICAgICAgIGlmIChmaWVsZEZsYWcgJiYgZmllbGRGbGFnLnN0YXJ0c1dpdGgoJy0tJykpIHsKICAgICAgICAgIGNvbnN0IGZpZWxkTWF0Y2ggPSBmaWVsZEZsYWcubWF0Y2goL14tLShbYS16QS1aX10rKSg/Oj0oLiopKT8kLyk7CiAgICAgICAgICBjb25zdCBmaWVsZCA9IGZpZWxkTWF0Y2ggPyBmaWVsZE1hdGNoWzFdIDogbnVsbDsKICAgICAgICAgIGNvbnN0IGZpZWxkTWFwID0gewogICAgICAgICAgICBhdXRob3I6IGNtZENsYXNzLmF1dGhvciwgdmVyc2lvbjogY21kQ2xhc3MudmVyc2lvbiwgZGVzY3JpcHRpb246IGNtZENsYXNzLmRlc2NyaXB0aW9uLAogICAgICAgICAgICBuYW1lOiBjbWRDbGFzcy5uYW1lLCBkb2NzOiBjbWRDbGFzcy5kb2NzLCB0ZXN0czogY21kQ2xhc3MudGVzdHMsIGNvbmZpZzogY21kQ2xhc3MuY29uZmlnX2RlZmF1bHQKICAgICAgICAgIH07CiAgICAgICAgICBpZiAoZmllbGQgJiYgZmllbGQgaW4gZmllbGRNYXApIHsKICAgICAgICAgICAgY29uc3QgdmFsID0gZmllbGRNYXBbZmllbGRdOwogICAgICAgICAgICBzdGRvdXQud3JpdGUoKEFycmF5LmlzQXJyYXkodmFsKSA/IHZhbC5qb2luKCcsICcpIDogKHR5cGVvZiB2YWwgPT09ICdvYmplY3QnID8gSlNPTi5zdHJpbmdpZnkodmFsKSA6ICh2YWwgfHwgJ1Vua25vd24nKSkpICsgJ1xuJyk7CiAgICAgICAgICAgIHJldHVybiAwOwogICAgICAgICAgfQogICAgICAgICAgc3RkZXJyLndyaXRlKGBtYW46IHVua25vd24gZmllbGQgJyR7ZmllbGR9J1xuYCk7CiAgICAgICAgICByZXR1cm4gMTsKICAgICAgICB9CgogICAgICAgIC8vIEJhc2ljIHN0YXRpYyBpbmZvCiAgICAgICAgc3Rkb3V0LndyaXRlKGBDb21tYW5kOiAke2NtZE5hbWV9XG5gKTsKICAgICAgICBzdGRvdXQud3JpdGUoYEF1dGhvcjogJHtjbWRDbGFzcy5hdXRob3IgfHwgJ1Vua25vd24nfVxuYCk7CiAgICAgICAgc3Rkb3V0LndyaXRlKGBWZXJzaW9uOiAke2NtZENsYXNzLnZlcnNpb24gfHwgJ24vYSd9XG5gKTsKICAgICAgICBzdGRvdXQud3JpdGUoYERlc2NyaXB0aW9uOiAke2NtZENsYXNzLmRlc2NyaXB0aW9uIHx8ICdOb25lJ31cbmApOwogICAgICAgIGlmIChjbWRDbGFzcy5kb2NzKSBzdGRvdXQud3JpdGUoYERvY3M6ICR7Y21kQ2xhc3MuZG9jcy5qb2luKCcsICcpfVxuYCk7CiAgICAgICAgaWYgKGNtZENsYXNzLnRlc3RzKSBzdGRvdXQud3JpdGUoYFRlc3RzOiAke2NtZENsYXNzLnRlc3RzLmpvaW4oJywgJyl9XG5gKTsKICAgICAgICBpZiAoY21kQ2xhc3MuY29uZmlnX2RlZmF1bHQpIHN0ZG91dC53cml0ZShgQ29uZmlnOiAke0pTT04uc3RyaW5naWZ5KGNtZENsYXNzLmNvbmZpZ19kZWZhdWx0KX1cbmApOwoKICAgICAgICAvLyAtLS0tIE1ldGhvZCBsaXN0aW5nIHZpYSByZWZsZWN0aW9uICsgZG9jYmxvY2tzIC0tLS0KICAgICAgICBjb25zdCBzb3VyY2VDb2RlID0gYXdhaXQgdmZzLnJlYWRGaWxlKGZ1bGxQYXRoLCAndXRmOCcpOwogICAgICAgIGNvbnN0IG1ldGhvZERvY2Jsb2NrcyA9IHRoaXMuX2V4dHJhY3RNZXRob2REb2NibG9ja3Moc291cmNlQ29kZSk7CiAgICAgICAgY29uc3QgbWV0aG9kTmFtZXMgPSBSZWZsZWN0Lm93bktleXMoY21kQ2xhc3MucHJvdG90eXBlKQogICAgICAgICAgLmZpbHRlcihuYW1lID0+IG5hbWUgIT09ICdjb25zdHJ1Y3RvcicgJiYgdHlwZW9mIGNtZENsYXNzLnByb3RvdHlwZVtuYW1lXSA9PT0gJ2Z1bmN0aW9uJyAmJiAhbmFtZS5zdGFydHNXaXRoKCdfJykpOwoKICAgICAgICBpZiAobWV0aG9kTmFtZXMubGVuZ3RoKSB7CiAgICAgICAgICBzdGRvdXQud3JpdGUoYFxuTWV0aG9kczpcbmApOwogICAgICAgICAgZm9yIChjb25zdCBtZXRob2Qgb2YgbWV0aG9kTmFtZXMpIHsKICAgICAgICAgICAgY29uc3QgZG9jID0gbWV0aG9kRG9jYmxvY2tzLmdldChtZXRob2QpOwogICAgICAgICAgICBzdGRvdXQud3JpdGUoYCAgJHttZXRob2R9KClgKTsKICAgICAgICAgICAgaWYgKGRvYyAmJiBkb2MucGFyYW0pIHsKICAgICAgICAgICAgICBzdGRvdXQud3JpdGUoYFxuICAgIFBhcmFtZXRlcnM6ICR7ZG9jLnBhcmFtLnJlcGxhY2UoL1xuL2csICdcbiAgICAnKX1gKTsKICAgICAgICAgICAgfQogICAgICAgICAgICBpZiAoZG9jICYmIGRvYy5yZXR1cm5zKSB7CiAgICAgICAgICAgICAgc3Rkb3V0LndyaXRlKGBcbiAgICBSZXR1cm5zOiAke2RvYy5yZXR1cm5zfWApOwogICAgICAgICAgICB9CiAgICAgICAgICAgIGlmIChkb2MgJiYgZG9jLmV4YW1wbGUpIHsKICAgICAgICAgICAgICBzdGRvdXQud3JpdGUoYFxuICAgIEV4YW1wbGU6ICR7ZG9jLmV4YW1wbGUucmVwbGFjZSgvXG4vZywgJ1xuICAgICcpLnNsaWNlKDAsIDIwMCl9YCk7CiAgICAgICAgICAgIH0KICAgICAgICAgICAgc3Rkb3V0LndyaXRlKGBcbmApOwogICAgICAgICAgfQogICAgICAgIH0KICAgICAgICByZXR1cm4gMDsKICAgICAgfQoKICAgICAgaWYgKGFyZ3NbMF0gPT09ICdkb2NzJykgewogICAgICAgIGNvbnN0IGNtZFJlZiA9IGFyZ3NbMV07CiAgICAgICAgaWYgKCFjbWRSZWYpIHsKICAgICAgICAgIHN0ZGVyci53cml0ZSgnVXNhZ2U6IG1hbiBkb2NzIDxjb21tYW5kPiBbLS1zaG93IDxpbmRleD5dXG4nKTsKICAgICAgICAgIHJldHVybiAxOwogICAgICAgIH0KICAgICAgICBjb25zdCByZXNvbHZlZCA9IGF3YWl0IHRoaXMuX3Jlc29sdmVDb21tYW5kRmlsZSh2ZnMsIGNtZFJlZik7CiAgICAgICAgaWYgKCFyZXNvbHZlZCkgewogICAgICAgICAgc3RkZXJyLndyaXRlKGBDb21tYW5kICR7Y21kUmVmfSBub3QgZm91bmQuXG5gKTsKICAgICAgICAgIHJldHVybiAxOwogICAgICAgIH0KICAgICAgICBjb25zdCBjbWRDbGFzcyA9IHJlc29sdmVkLmNtZENsYXNzOwogICAgICAgIGNvbnN0IGRvY3MgPSBjbWRDbGFzcy5kb2NzIHx8IFtdOwogICAgICAgIGlmIChhcmdzWzJdID09PSAnLS1zaG93JykgewogICAgICAgICAgY29uc3QgaWR4ID0gcGFyc2VJbnQoYXJnc1szXSwgMTApOwogICAgICAgICAgaWYgKGlzTmFOKGlkeCkgfHwgaWR4IDwgMCB8fCBpZHggPj0gZG9jcy5sZW5ndGgpIHsKICAgICAgICAgICAgc3RkZXJyLndyaXRlKCdJbnZhbGlkIGluZGV4LlxuJyk7CiAgICAgICAgICAgIHJldHVybiAxOwogICAgICAgICAgfQogICAgICAgICAgY29uc3QgZG9jUGF0aCA9IGRvY3NbaWR4XTsKICAgICAgICAgIGlmIChkb2NQYXRoLnN0YXJ0c1dpdGgoJ2h0dHAnKSkgewogICAgICAgICAgICBzdGRvdXQud3JpdGUoYFJlbW90ZSBkb2M6ICR7ZG9jUGF0aH1cbmApOwogICAgICAgICAgfSBlbHNlIHsKICAgICAgICAgICAgdHJ5IHsKICAgICAgICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdmZzLnJlYWRGaWxlKGRvY1BhdGgpOwogICAgICAgICAgICAgIHN0ZG91dC53cml0ZShjb250ZW50ICsgJ1xuJyk7CiAgICAgICAgICAgIH0gY2F0Y2goZSkgewogICAgICAgICAgICAgIHN0ZGVyci53cml0ZShgQ2Fubm90IHJlYWQgZG9jOiAke2UubWVzc2FnZX1cbmApOwogICAgICAgICAgICAgIHJldHVybiAxOwogICAgICAgICAgICB9CiAgICAgICAgICB9CiAgICAgICAgfSBlbHNlIHsKICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgZG9jcy5sZW5ndGg7IGkrKykgc3Rkb3V0LndyaXRlKGBbJHtpfV0gJHtkb2NzW2ldfVxuYCk7CiAgICAgICAgfQogICAgICAgIHJldHVybiAwOwogICAgICB9CgogICAgICBpZiAoYXJnc1swXSA9PT0gJ3Rlc3RzJykgewogICAgICAgIGNvbnN0IGNtZFJlZiA9IGFyZ3NbMV07CiAgICAgICAgaWYgKCFjbWRSZWYpIHsKICAgICAgICAgIHN0ZGVyci53cml0ZSgnVXNhZ2U6IG1hbiB0ZXN0cyA8Y29tbWFuZD5cbicpOwogICAgICAgICAgcmV0dXJuIDE7CiAgICAgICAgfQogICAgICAgIGNvbnN0IHJlc29sdmVkID0gYXdhaXQgdGhpcy5fcmVzb2x2ZUNvbW1hbmRGaWxlKHZmcywgY21kUmVmKTsKICAgICAgICBpZiAoIXJlc29sdmVkKSB7CiAgICAgICAgICBzdGRlcnIud3JpdGUoYENvbW1hbmQgJHtjbWRSZWZ9IG5vdCBmb3VuZC5cbmApOwogICAgICAgICAgcmV0dXJuIDE7CiAgICAgICAgfQogICAgICAgIGNvbnN0IHRlc3RzID0gcmVzb2x2ZWQuY21kQ2xhc3MudGVzdHMgfHwgW107CiAgICAgICAgZm9yIChjb25zdCB0IG9mIHRlc3RzKSBzdGRvdXQud3JpdGUodCArICdcbicpOwogICAgICAgIHJldHVybiAwOwogICAgICB9CgogICAgICAvLyAtLS0tIEZhbGxiYWNrOiBKU0RvYyBwYXJzaW5nIGZvciB1c2VyIGZpbGVzIC0tLS0KICAgICAgbGV0IHRhcmdldCA9IGFyZ3NbMF07CiAgICAgIGlmICghdGFyZ2V0LmVuZHNXaXRoKCcuanMnKSkgdGFyZ2V0ICs9ICcuanMnOwogICAgICBpZiAoIXRhcmdldC5zdGFydHNXaXRoKCcvJykpIHsKICAgICAgICBjb25zdCBiaW5QYXRoID0gYC9iaW4vJHt0YXJnZXR9YDsKICAgICAgICBjb25zdCBsaWJQYXRoID0gYC9saWIvJHt0YXJnZXR9YDsKICAgICAgICBjb25zdCBjd2RQYXRoID0gY3dkLmVuZHNXaXRoKCcvJykgPyBjd2QgKyB0YXJnZXQgOiBjd2QgKyAnLycgKyB0YXJnZXQ7CiAgICAgICAgaWYgKGF3YWl0IHZmcy5leGlzdHMoYmluUGF0aCkpIHRhcmdldCA9IGJpblBhdGg7CiAgICAgICAgZWxzZSBpZiAoYXdhaXQgdmZzLmV4aXN0cyhsaWJQYXRoKSkgdGFyZ2V0ID0gbGliUGF0aDsKICAgICAgICBlbHNlIGlmIChhd2FpdCB2ZnMuZXhpc3RzKGN3ZFBhdGgpKSB0YXJnZXQgPSBjd2RQYXRoOwogICAgICAgIGVsc2UgewogICAgICAgICAgc3RkZXJyLndyaXRlKGBtYW46ICR7dGFyZ2V0fTogTm8gc3VjaCBmaWxlIG9yIGRpcmVjdG9yeVxuYCk7CiAgICAgICAgICByZXR1cm4gMTsKICAgICAgICB9CiAgICAgIH0gZWxzZSBpZiAoIWF3YWl0IHZmcy5leGlzdHModGFyZ2V0KSkgewogICAgICAgIHN0ZGVyci53cml0ZShgbWFuOiAke3RhcmdldH06IE5vIHN1Y2ggZmlsZSBvciBkaXJlY3RvcnlcbmApOwogICAgICAgIHJldHVybiAxOwogICAgICB9CgogICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdmZzLnJlYWRGaWxlKHRhcmdldCwgJ3V0ZjgnKTsKICAgICAgY29uc3QganNkb2MgPSB0aGlzLl9wYXJzZUpTRG9jKGNvbnRlbnQpOwogICAgICBpZiAoIWpzZG9jKSB7CiAgICAgICAgc3RkZXJyLndyaXRlKGBtYW46ICR7dGFyZ2V0fTogTm8gSlNEb2MgZm91bmRcbmApOwogICAgICAgIHJldHVybiAxOwogICAgICB9CgogICAgICBjb25zdCBuYW1lID0ganNkb2MuZmlsZSB8fCB0YXJnZXQuc3BsaXQoJy8nKS5wb3AoKTsKICAgICAgc3Rkb3V0LndyaXRlKGBcbiR7Jz0nLnJlcGVhdCg3MCl9XG5gKTsKICAgICAgc3Rkb3V0LndyaXRlKGBNQU5VQUwgUEFHRTogJHtuYW1lfVxuYCk7CiAgICAgIHN0ZG91dC53cml0ZShgJHsnPScucmVwZWF0KDcwKX1cblxuYCk7CgogICAgICBpZiAoanNkb2MuZGVzY3JpcHRpb24pIHN0ZG91dC53cml0ZShgTkFNRVxuICAgICR7bmFtZX0g4oCTICR7anNkb2MuZGVzY3JpcHRpb24uc3BsaXQoJ1xuJylbMF19XG5cbmApOwogICAgICBpZiAoanNkb2MudmVyc2lvbikgc3Rkb3V0LndyaXRlKGBWRVJTSU9OXG4gICAgJHtqc2RvYy52ZXJzaW9ufVxuXG5gKTsKICAgICAgaWYgKGpzZG9jLmF1dGhvcikgc3Rkb3V0LndyaXRlKGBBVVRIT1JcbiAgICAke2pzZG9jLmF1dGhvcn1cblxuYCk7CiAgICAgIGlmIChqc2RvYy5wYXJhbSB8fCBqc2RvYy5yZXR1cm5zIHx8IGpzZG9jLnRocm93cykgewogICAgICAgIHN0ZG91dC53cml0ZShgU1lOT1BTSVNcbmApOwogICAgICAgIGlmIChqc2RvYy5wYXJhbSkgc3Rkb3V0LndyaXRlKGAgICAgJHtqc2RvYy5wYXJhbS5yZXBsYWNlKC9cbi9nLCAnXG4gICAgJyl9XG5gKTsKICAgICAgICBpZiAoanNkb2MucmV0dXJucykgc3Rkb3V0LndyaXRlKGAgICAgUmV0dXJuczogJHtqc2RvYy5yZXR1cm5zfVxuYCk7CiAgICAgICAgaWYgKGpzZG9jLnRocm93cykgc3Rkb3V0LndyaXRlKGAgICAgVGhyb3dzOiAke2pzZG9jLnRocm93c31cbmApOwogICAgICAgIHN0ZG91dC53cml0ZShgXG5gKTsKICAgICAgfQogICAgICBpZiAoanNkb2MuZGVzY3JpcHRpb24pIHN0ZG91dC53cml0ZShgREVTQ1JJUFRJT05cbiAgICAke2pzZG9jLmRlc2NyaXB0aW9uLnJlcGxhY2UoL1xuL2csICdcbiAgICAnKX1cblxuYCk7CiAgICAgIGlmIChqc2RvYy5leGFtcGxlKSBzdGRvdXQud3JpdGUoYEVYQU1QTEVTXG4gICAgJHtqc2RvYy5leGFtcGxlLnJlcGxhY2UoL1xuL2csICdcbiAgICAnKX1cblxuYCk7CiAgICAgIGlmIChqc2RvYy5mZWF0dXJlcykgc3Rkb3V0LndyaXRlKGBGRUFUVVJFU1xuICAgICR7anNkb2MuZmVhdHVyZXMucmVwbGFjZSgvXG4vZywgJ1xuICAgICcpfVxuXG5gKTsKICAgICAgaWYgKGpzZG9jLnBhdHRlcm4pIHN0ZG91dC53cml0ZShgUEFUVEVSTlxuICAgICR7anNkb2MucGF0dGVybn1cblxuYCk7CiAgICAgIGlmIChqc2RvYy5yYXRpb25hbGUpIHN0ZG91dC53cml0ZShgUkFUSU9OQUxFXG4gICAgJHtqc2RvYy5yYXRpb25hbGV9XG5cbmApOwogICAgICBpZiAoanNkb2MucHJpbmNpcGxlKSBzdGRvdXQud3JpdGUoYFBSSU5DSVBMRVNcbiAgICAke2pzZG9jLnByaW5jaXBsZS5yZXBsYWNlKC9cbi9nLCAnXG4gICAgJyl9XG5cbmApOwogICAgICBpZiAoanNkb2MuQUlfSW5zdHJ1Y3Rpb25zKSBzdGRvdXQud3JpdGUoYEFJIElOU1RSVUNUSU9OU1xuICAgICR7anNkb2MuQUlfSW5zdHJ1Y3Rpb25zLnJlcGxhY2UoL1xuL2csICdcbiAgICAnKX1cblxuYCk7CgogICAgICByZXR1cm4gMDsKICAgIH0KICB9CiAgcmV0dXJuIE1hbkNvbW1hbmQ7Cn0pKTs="); const bytes = Uint8Array.from(bin, c => c.charCodeAt(0)); return new TextDecoder().decode(bytes); })();;


  const SOURCES = {
    'unix.ls.js': LS_COMMAND_SOURCE,
    'unix.cat.js': CAT_COMMAND_SOURCE,
    'unix.man.js': MAN_COMMAND_SOURCE,
    'unix.mnt.js': MNT_COMMAND_SOURCE,
    'unix.whoami.js': WHOAMI_COMMAND_SOURCE,
    'unix.id.js': ID_COMMAND_SOURCE,
    'unix.login.js': LOGIN_COMMAND_SOURCE,
    'unix.logout.js': LOGOUT_COMMAND_SOURCE,
    'unix.useradd.js': USERADD_COMMAND_SOURCE,
    'unix.who.js': WHO_COMMAND_SOURCE,
    'unix.w.js': W_COMMAND_SOURCE,
    'unix.last.js': LAST_COMMAND_SOURCE,
    'unix.chmod.js': CHMOD_COMMAND_SOURCE,
    'unix.chown.js': CHOWN_COMMAND_SOURCE,
    'unix.ps.js': UNIX_PS_COMMAND_SOURCE,
    'unix.jobs.js': UNIX_JOBS_COMMAND_SOURCE,
    'unix.fg.js': UNIX_FG_COMMAND_SOURCE,
    'unix.bg.js': UNIX_BG_COMMAND_SOURCE,
    'unix.kill.js': UNIX_KILL_COMMAND_SOURCE,
    'unix.top.js': UNIX_TOP_COMMAND_SOURCE,
    'procd.demo.js': PROCD_DEMO_COMMAND_SOURCE,
    'llm.chat.js': LLM_CHAT_COMMAND_SOURCE
  };

  const DIRS = ['/bin', '/sbin', '/usr', '/usr/bin', '/usr/sbin', '/usr/lib', '/usr/local', '/usr/share', '/etc', '/home', '/root', '/tmp', '/var', '/var/log', '/var/tmp', '/opt', '/lib', '/mnt', '/media', '/proc', '/dev', '/srv'];

  // Idempotent: safe to call from every app that boots against the shared FileFsX backend.
  function setupUnixFS(fsInstance) {
    return DIRS.reduce((p, d) => p.then(() => fsInstance.mkdir(d, { recursive: true }).catch(() => {})), Promise.resolve())
      .then(() => Promise.all(Object.keys(SOURCES).map(file =>
        fsInstance.stat('/bin/' + file).catch(() => null).then(st => st ? null : fsInstance.writeFile('/bin/' + file, SOURCES[file]))
      )));
  }

  root.PosixCommands = { TermCommand, sources: SOURCES, setupUnixFS };
}(typeof self !== 'undefined' ? self : this));
