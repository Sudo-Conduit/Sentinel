/**
 * @file bin/cat.js
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

  /**
   * Execute the cat command.
   * @param {string[]} args - Command arguments
   * @param {Object} ctx - Execution context
   * @param {Object} ctx.stdin - Input stream
   * @param {Object} ctx.stdout - Output writer
   * @param {Object} ctx.stderr - Error writer
   * @param {string} ctx.cwd - Current working directory
   * @param {Object} ctx.vfs - Virtual filesystem
   * @returns {Promise<number>} Exit code (0 success, 1 error)
   * @throws {Error} If file cannot be read
   * @example cat -n /bin/ls.js
   * @example cat -E /bin/ls.js
   * @example echo "hello" | cat -n
   */
  async execute(args, { stdin, stdout, stderr, cwd, vfs }) {
    let options = {
      number: false,
      numberNonEmpty: false,
      squeeze: false,
      showEnds: false,
      help: false
    };
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
              stderr.write(`cat: invalid option -- '${flag}'\n`);
              return 1;
          }
        }
      } else {
        files.push(arg);
      }
    }

    if (options.numberNonEmpty) options.number = false;

    if (options.help) {
      stdout.write(`Usage: cat [OPTION]... [FILE]...
Concatenate FILE(s) to standard output.

Options:
  -n     number all output lines
  -b     number non-empty output lines (overrides -n)
  -s     suppress repeated empty output lines
  -E     display $ at end of each line
  --help display this help and exit
`);
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
        outputLine = `${String(lineNumber++).padStart(6, ' ')}\t${outputLine}`;
      } else if (options.numberNonEmpty && line !== '') {
        outputLine = `${String(lineNumber++).padStart(6, ' ')}\t${outputLine}`;
      }

      stdout.write(outputLine + '\n');
    };

    const processContent = (content) => {
      const lines = content.split('\n');
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
        if (!path.startsWith('/')) path = cwd === '/' ? `/${file}` : `${cwd}/${file}`;
        try {
          content = await vfs.readFile(path);
        } catch (err) {
          if (err.code === 'ENOENT') stderr.write(`cat: ${file}: No such file or directory\n`);
          else if (err.code === 'EISDIR') stderr.write(`cat: ${file}: Is a directory\n`);
          else stderr.write(`cat: ${file}: ${err.message}\n`);
          return 1;
        }
      }
      processContent(content);
    }

    return 0;
  }
}

module.exports = CatCommand;