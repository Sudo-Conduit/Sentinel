/**
 * @file bin/head.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Output the first part of files with POSIX parameter support.
 *              Supports: -n, -c, -q, -v, --help
 * @example head -n 20 file.txt
 * @example head -c 100 file.txt
 * @example head -q file1.txt file2.txt
 * @principle "Assume no dependencies in classes unless authorized."
 */

class HeadCommand {
  static name = 'head';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Output the first part of files with POSIX parameter support.';
  static docs = ['/docs/head/README.md'];
  static tests = ['/tests/head/unit.js'];
  static config_default = { supportsHeredoc: true, resourceMonitored: true };

  /**
   * Execute the head command.
   * @param {string[]} args - Command arguments (options and files)
   * @param {Object} ctx - Execution context
   * @param {Object} ctx.stdin - Input stream
   * @param {Object} ctx.stdout - Output writer
   * @param {Object} ctx.stderr - Error writer
   * @param {string} ctx.cwd - Current working directory
   * @param {Object} ctx.vfs - Virtual filesystem
   * @returns {Promise<number>} Exit code (0 success, 1 error)
   * @throws {Error} If file cannot be read
   * @example head -n 20 file.txt
   * @example head -c 100 file.txt
   * @example head -q file1.txt file2.txt
   */
  async execute(args, { stdin, stdout, stderr, cwd, vfs }) {
    let options = { lines: 10, bytes: null, quiet: false, verbose: false, help: false };
    let files = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--help') {
        options.help = true;
      } else if (arg === '-q' || arg === '--quiet') {
        options.quiet = true;
      } else if (arg === '-v' || arg === '--verbose') {
        options.verbose = true;
      } else if (arg === '-n' || arg === '--lines') {
        if (i + 1 >= args.length) {
          stderr.write(`head: option requires an argument -- 'n'\n`);
          return 1;
        }
        const numStr = args[++i];
        const num = parseInt(numStr, 10);
        if (isNaN(num) || num < 0) {
          stderr.write(`head: invalid number of lines: '${numStr}'\n`);
          return 1;
        }
        options.lines = num;
      } else if (arg === '-c' || arg === '--bytes') {
        if (i + 1 >= args.length) {
          stderr.write(`head: option requires an argument -- 'c'\n`);
          return 1;
        }
        const numStr = args[++i];
        const num = parseInt(numStr, 10);
        if (isNaN(num) || num < 0) {
          stderr.write(`head: invalid number of bytes: '${numStr}'\n`);
          return 1;
        }
        options.bytes = num;
      } else if (arg.startsWith('-')) {
        const numStr = arg.slice(1);
        if (numStr.match(/^\d+$/)) {
          options.lines = parseInt(numStr, 10);
        } else {
          stderr.write(`head: invalid option -- '${arg}'\n`);
          return 1;
        }
      } else {
        files.push(arg);
      }
    }

    if (options.bytes !== null) options.lines = null;

    if (options.help) {
      stdout.write(`Usage: head [OPTION]... [FILE]...
Print the first 10 lines of each FILE to standard output.

Options:
  -n N     output the first N lines (default 10)
  -c N     output the first N bytes
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

      if (file === '-') {
        content = '';
        for await (const chunk of stdin) {
          content += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        }
        filename = 'standard input';
      } else {
        let path = file;
        if (!path.startsWith('/')) path = cwd === '/' ? `/${file}` : `${cwd}/${file}`;
        path = this._normalizePath(path);

        try {
          const stats = await vfs.stat(path);
          if (stats.isDirectory()) {
            stderr.write(`head: error reading '${file}': Is a directory\n`);
            hasError = true;
            continue;
          }
          content = await vfs.readFile(path);
        } catch (err) {
          stderr.write(`head: '${file}': ${err.code === 'ENOENT' ? 'No such file or directory' : err.message}\n`);
          hasError = true;
          continue;
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
      const byteCount = Math.min(options.bytes, bytes.length);
      const outputBytes = bytes.slice(0, byteCount);
      stdout.write(new TextDecoder().decode(outputBytes));
      if (byteCount > 0) {
        const lastChar = new TextDecoder().decode(outputBytes.slice(-1));
        if (lastChar !== '\n') stdout.write('\n');
      }
    } else {
      const lines = content.split('\n');
      const lineCount = Math.min(options.lines, lines.length - 1);
      for (let i = 0; i < lineCount; i++) stdout.write(lines[i] + '\n');
      if (lineCount === lines.length - 1 && lines[lines.length - 1] !== '') {
        stdout.write(lines[lines.length - 1] + '\n');
      }
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

module.exports = HeadCommand;