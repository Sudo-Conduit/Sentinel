/**
 * @file bin/grep.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Search for patterns in files with POSIX parameter support.
 *              Supports: -i, -v, -c, -n, -l, -r, -w, --help
 * @example grep "function" /bin/ls.js
 * @example grep -r "KernelJS" /lib/
 * @example cat /bin/ls.js | grep -n "class"
 * @principle "Assume no dependencies in classes unless authorized."
 */

class GrepCommand {
  static name = 'grep';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Search for patterns in files with POSIX parameter support.';
  static docs = ['/docs/grep/README.md'];
  static tests = ['/tests/grep/unit.js'];
  static config_default = { supportsHeredoc: true, resourceMonitored: true };

  /**
   * Execute the grep command.
   * @param {string[]} args - Command arguments (pattern and files)
   * @param {Object} ctx - Execution context
   * @param {Object} ctx.stdin - Input stream
   * @param {Object} ctx.stdout - Output writer
   * @param {Object} ctx.stderr - Error writer
   * @param {string} ctx.cwd - Current working directory
   * @param {Object} ctx.vfs - Virtual filesystem
   * @returns {Promise<number>} Exit code (0 if matches found, 1 if no matches)
   * @throws {Error} If pattern is invalid
   * @example grep "function" /bin/ls.js
   * @example grep -r "KernelJS" /lib/
   * @example cat /bin/ls.js | grep -n "class"
   */
  async execute(args, { stdin, stdout, stderr, cwd, vfs }) {
    let options = { ignoreCase: false, invert: false, count: false, lineNum: false, filesWithMatches: false, recursive: false, wordRegexp: false, help: false };
    let pattern = null;
    let files = [];

    let i = 0;
    while (i < args.length) {
      const arg = args[i];

      if (arg === '--help') {
        options.help = true;
        i++;
      } else if (arg.startsWith('-')) {
        for (let j = 1; j < arg.length; j++) {
          const flag = arg[j];
          switch (flag) {
            case 'i': options.ignoreCase = true; break;
            case 'v': options.invert = true; break;
            case 'c': options.count = true; break;
            case 'n': options.lineNum = true; break;
            case 'l': options.filesWithMatches = true; break;
            case 'r': options.recursive = true; break;
            case 'w': options.wordRegexp = true; break;
            default:
              stderr.write(`grep: invalid option -- '${flag}'\n`);
              return 1;
          }
        }
        i++;
      } else if (pattern === null) {
        pattern = arg;
        i++;
      } else {
        files.push(arg);
        i++;
      }
    }

    if (options.help) {
      stdout.write(`Usage: grep [OPTION]... PATTERN [FILE]...
Search for PATTERN in each FILE.

Options:
  -i     ignore case distinctions
  -v     invert match (select non-matching lines)
  -c     count matching lines
  -n     prefix each line with line number
  -l     show only names of files with matches
  -r     read all files under each directory, recursively
  -w     match only whole words
  --help display this help and exit
`);
      return 0;
    }

    if (!pattern) {
      stderr.write('grep: missing pattern\n');
      return 1;
    }

    let regexPattern = pattern;
    if (options.wordRegexp) regexPattern = `\\b${this._escapeRegex(pattern)}\\b`;
    else regexPattern = this._escapeRegex(pattern);

    let regex;
    try {
      regex = new RegExp(regexPattern, options.ignoreCase ? 'gi' : 'g');
    } catch (err) {
      stderr.write(`grep: invalid regular expression: ${err.message}\n`);
      return 1;
    }

    if (files.length === 0) {
      let content = '';
      for await (const chunk of stdin) {
        content += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      }
      const result = this._searchContent(content, '(standard input)', options, regex, stdout);
      return result ? 0 : 1;
    }

    let allFiles = [];
    for (const file of files) {
      let path = file;
      if (!path.startsWith('/')) path = cwd === '/' ? `/${file}` : `${cwd}/${file}`;
      await this._collectFiles(path, options, allFiles, vfs);
    }

    let anyMatches = false;
    for (const fileInfo of allFiles) {
      if (this._searchContent(fileInfo.content, fileInfo.path, options, regex, stdout)) {
        anyMatches = true;
      }
    }

    return anyMatches ? 0 : 1;
  }

  async _collectFiles(path, options, allFiles, vfs) {
    try {
      const stats = await vfs.stat(path);
      if (!stats.isDirectory()) {
        const content = await vfs.readFile(path);
        allFiles.push({ path, content });
        return;
      }

      if (!options.recursive) throw new Error(`Is a directory`);

      const entries = await vfs.readdir(path);
      for (const entry of entries) {
        if (entry.startsWith('.')) continue;
        const fullPath = path === '/' ? `/${entry}` : `${path}/${entry}`;
        await this._collectFiles(fullPath, options, allFiles, vfs);
      }
    } catch (err) {}
  }

  _searchContent(content, filename, options, regex, stdout) {
    const lines = content.split('\n');
    let matchCount = 0;
    let outputLines = [];

    for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
      const line = lines[lineNum - 1];
      const lineRegex = new RegExp(regex.source, regex.flags);
      let matches = lineRegex.test(line);
      if (options.invert) matches = !matches;

      if (matches) {
        matchCount++;
        if (!options.count && !options.filesWithMatches) {
          let outputLine = '';
          if (options.lineNum) outputLine += `${lineNum}:`;
          outputLine += line;
          outputLines.push(outputLine);
        }
      }
    }

    if (options.filesWithMatches && matchCount > 0) {
      stdout.write(`${filename}\n`);
    } else if (options.count) {
      stdout.write(`${filename}:${matchCount}\n`);
    } else {
      for (const outputLine of outputLines) {
        stdout.write(`${filename}:${outputLine}\n`);
      }
    }

    return matchCount > 0;
  }

  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

module.exports = GrepCommand;