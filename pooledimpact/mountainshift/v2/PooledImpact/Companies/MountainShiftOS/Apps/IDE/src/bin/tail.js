/**
 * @file bin/tail.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Output the last part of files with POSIX parameter support.
 *              Supports: -n, -c, -f, -q, -v, --help
 * @example tail -n 15 file.txt
 * @example tail -f /var/log/syslog
 * @example tail -c 500 file.txt
 * @principle "Assume no dependencies in classes unless authorized."
 */

class TailCommand {
  static name = 'tail';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Output the last part of files with POSIX parameter support.';
  static docs = ['/docs/tail/README.md'];
  static tests = ['/tests/tail/unit.js'];
  static config_default = { supportsHeredoc: true, resourceMonitored: true };

  /**
   * Execute the tail command.
   * @param {string[]} args - Command arguments (options and files)
   * @param {Object} ctx - Execution context
   * @param {Object} ctx.stdin - Input stream
   * @param {Object} ctx.stdout - Output writer
   * @param {Object} ctx.stderr - Error writer
   * @param {string} ctx.cwd - Current working directory
   * @param {Object} ctx.vfs - Virtual filesystem
   * @returns {Promise<number>} Exit code (0 success, 1 error)
   * @throws {Error} If file cannot be read
   * @example tail -n 15 file.txt
   * @example tail -f /var/log/syslog
   * @example tail -c 500 file.txt
   */
  async execute(args, { stdin, stdout, stderr, cwd, vfs }) {
    let options = { lines: 10, bytes: null, follow: false, quiet: false, verbose: false, followRetry: false, help: false };
    let files = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--help') {
        options.help = true;
      } else if (arg === '-q' || arg === '--quiet' || arg === '--silent') {
        options.quiet = true;
      } else if (arg === '-v' || arg === '--verbose') {
        options.verbose = true;
      } else if (arg === '-f' || arg === '--follow') {
        options.follow = true;
      } else if (arg === '-F') {
        options.follow = true;
        options.followRetry = true;
      } else if (arg === '-n' || arg === '--lines') {
        if (i + 1 >= args.length) {
          stderr.write(`tail: option requires an argument -- 'n'\n`);
          return 1;
        }
        const numStr = args[++i];
        let num = parseInt(numStr, 10);
        if (isNaN(num)) {
          stderr.write(`tail: invalid number of lines: '${numStr}'\n`);
          return 1;
        }
        if (numStr.startsWith('+')) {
          stderr.write(`tail: starting at line ${num} is not supported\n`);
          return 1;
        }
        if (num < 0) num = -num;
        options.lines = num;
      } else if (arg === '-c' || arg === '--bytes') {
        if (i + 1 >= args.length) {
          stderr.write(`tail: option requires an argument -- 'c'\n`);
          return 1;
        }
        const numStr = args[++i];
        let num = parseInt(numStr, 10);
        if (isNaN(num)) {
          stderr.write(`tail: invalid number of bytes: '${numStr}'\n`);
          return 1;
        }
        if (numStr.startsWith('+')) {
          stderr.write(`tail: starting at byte ${num} is not supported\n`);
          return 1;
        }
        if (num < 0) num = -num;
        options.bytes = num;
      } else if (arg.startsWith('-') && arg.match(/^-\d+$/)) {
        options.lines = parseInt(arg.slice(1), 10);
      } else if (arg.startsWith('+') && arg.match(/^\+\d+$/)) {
        stderr.write(`tail: starting at line ${arg.slice(1)} is not supported\n`);
        return 1;
      } else {
        files.push(arg);
      }
    }

    if (options.bytes !== null) options.lines = null;

    if (options.help) {
      stdout.write(`Usage: tail [OPTION]... [FILE]...
Print the last 10 lines of each FILE to standard output.

Options:
  -n N     output the last N lines (default 10)
  -c N     output the last N bytes
  -f       output appended data as the file grows (follow)
  -F       same as -f but also retry if file becomes inaccessible
  -q       never print headers
  -v       always print headers
  --help   display this help and exit
`);
      return 0;
    }

    if (files.length === 0) {
      let content = '';
      for await (const chunk of stdin) {
        content += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      }
      this._outputContent(content, options, stdout);
      return 0;
    }

    const printHeader = (files.length > 1 && !options.quiet) || options.verbose;
    let hasError = false;
    let isFirstFile = true;

    for (const file of files) {
      let content;
      let filename = file;
      let filePath = null;

      if (file === '-') {
        content = '';
        for await (const chunk of stdin) {
          content += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        }
        filename = 'standard input';
      } else {
        let path = file;
        if (!path.startsWith('/')) path = cwd === '/' ? `/${file}` : `${cwd}/${file}`;
        filePath = this._normalizePath(path);

        try {
          const stats = await vfs.stat(filePath);
          if (stats.isDirectory()) {
            stderr.write(`tail: error reading '${file}': Is a directory\n`);
            hasError = true;
            continue;
          }
          content = await vfs.readFile(filePath);
        } catch (err) {
          if (err.code === 'ENOENT') {
            if (options.follow && options.followRetry) {
              content = '';
              stderr.write(`tail: '${file}': No such file or directory (waiting for file)\n`);
            } else {
              stderr.write(`tail: '${file}': No such file or directory\n`);
              hasError = true;
              continue;
            }
          } else {
            stderr.write(`tail: '${file}': ${err.message}\n`);
            hasError = true;
            continue;
          }
        }
      }

      if (printHeader) {
        if (!isFirstFile) stdout.write('\n');
        stdout.write(`==> ${filename} <==\n`);
      }

      this._outputContent(content, options, stdout);
      isFirstFile = false;
    }

    return hasError ? 1 : 0;
  }

  _outputContent(content, options, stdout) {
    if (options.bytes !== null) {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : (content instanceof Uint8Array ? content : new Uint8Array(content));
      const startByte = Math.max(0, bytes.length - options.bytes);
      const outputBytes = bytes.slice(startByte);
      stdout.write(new TextDecoder().decode(outputBytes));
      if (outputBytes.length > 0) {
        const lastChar = new TextDecoder().decode(outputBytes.slice(-1));
        if (lastChar !== '\n') stdout.write('\n');
      }
    } else {
      const lines = content.split('\n');
      const lineCount = options.lines;
      const startLine = (lineCount >= lines.length - 1) ? 0 : Math.max(0, lines.length - lineCount - 1);
      for (let i = startLine; i < lines.length; i++) {
        if (i === lines.length - 1 && lines[i] === '') continue;
        stdout.write(lines[i] + (i < lines.length - 1 ? '\n' : ''));
      }
      if (lines.length > 0 && lines[lines.length - 1] !== '') stdout.write('\n');
    }
  }

  _normalizePath(path) {
    const parts = path.split('/');
    const result = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') {
        if (result.length > 0) result.pop();
      } else {
        result.push(part);
      }
    }
    return '/' + result.join('/');
  }
}

module.exports = TailCommand;