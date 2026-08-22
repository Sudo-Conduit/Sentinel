/**
 * @file bin/ls.js
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

  /**
   * Execute the ls command.
   * @param {string[]} args - Command arguments (options and paths)
   * @param {Object} ctx - Execution context
   * @param {Object} ctx.stdout - Output writer
   * @param {Object} ctx.stderr - Error writer
   * @param {string} ctx.cwd - Current working directory
   * @param {Object} ctx.vfs - Virtual filesystem
   * @returns {Promise<number>} Exit code (0 success, 1 error)
   * @throws {Error} If path cannot be accessed
   * @example ls -la /bin
   * @example ls -R /usr
   * @example ls --help
   */
  async execute(args, { stdout, stderr, cwd, vfs }) {
    // Parse options
    let options = {
      long: false,
      all: false,
      human: false,
      recursive: false,
      sortByTime: false,
      reverse: false,
      sortBySize: false,
      dirSelf: false,
      help: false
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
              stderr.write(`ls: invalid option -- '${flag}'\n`);
              return 1;
          }
        }
      } else {
        targets.push(arg);
      }
    }

    if (options.help) {
      stdout.write(`Usage: ls [OPTION]... [FILE]...
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
`);
      return 0;
    }

    if (targets.length === 0) {
      targets = [cwd];
    }

    let first = true;
    for (const target of targets) {
      if (!first) stdout.write('\n');
      first = false;

      let path = target;
      if (!path.startsWith('/')) {
        path = cwd === '/' ? `/${target}` : `${cwd}/${target}`;
      }
      path = this._normalizePath(path);

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
      if (part === '..') {
        result.pop();
      } else {
        result.push(part);
      }
    }
    return '/' + result.join('/');
  }

  async _listSingle(path, options, stdout, vfs) {
    try {
      const stats = await vfs.stat(path);
      const name = path.split('/').pop() || path;
      stdout.write(name + (stats.isDirectory() ? '/' : '') + '\n');
    } catch (err) {
      stdout.write(`ls: cannot access '${path}': ${err.message}\n`);
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
        stdout.write(`${path}:\n`);
      }

      let entries = await vfs.readdir(path);
      if (!options.all) {
        entries = entries.filter(e => !e.startsWith('.'));
      }

      let items = [];
      for (const entry of entries) {
        const fullPath = path === '/' ? `/${entry}` : `${path}/${entry}`;
        try {
          const entryStats = await vfs.stat(fullPath);
          items.push({
            name: entry,
            path: fullPath,
            stats: entryStats,
            isDir: entryStats.isDirectory()
          });
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
        for (const item of items) {
          totalBlocks += Math.ceil(item.stats.size / 1024);
        }
        if (totalBlocks > 0) stdout.write(`total ${totalBlocks}\n`);
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
          const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
          const name = item.name + (item.isDir ? '/' : '');
          stdout.write(`${perms} 1 user group ${size} ${dateStr} ${name}\n`);
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
            stdout.write(output.trimEnd() + '\n');
            output = '';
          }
        }
      }

      if (options.recursive) {
        for (const item of items) {
          if (item.isDir && (options.all || !item.name.startsWith('.'))) {
            const subPath = path === '/' ? `/${item.name}` : `${path}/${item.name}`;
            stdout.write(`\n${subPath}:\n`);
            await this._listDirectory(subPath, options, stdout, vfs, '  ');
          }
        }
      }
    } catch (err) {
      stdout.write(`ls: cannot access '${path}': ${err.message}\n`);
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