/**
 * @file bin/which.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Locate a command in the user's PATH with POSIX parameter support.
 *              Supports: -a, --help
 * @example which cat
 * @example which -a ls
 * @example which node npm
 * @principle "Assume no dependencies in classes unless authorized."
 */

class WhichCommand {
  static name = 'which';
  static author = 'Will Fobbs';
  static version = '1.0.0';
  static description = 'Locate a command in the user\'s PATH with POSIX parameter support.';
  static docs = ['/docs/which/README.md'];
  static tests = ['/tests/which/unit.js'];
  static config_default = { supportsHeredoc: false, resourceMonitored: true };

  /**
   * Execute the which command.
   * @param {string[]} args - Command arguments (command names and options)
   * @param {Object} ctx - Execution context
   * @param {Object} ctx.stdout - Output writer
   * @param {Object} ctx.stderr - Error writer
   * @param {Object} ctx.vfs - Virtual filesystem
   * @returns {Promise<number>} Exit code (0 if all found, 1 if any missing)
   * @throws {Error} If PATH cannot be read
   * @example which cat
   * @example which -a ls
   * @example which node npm
   */
  async execute(args, { stdout, stderr, vfs }) {
    let options = { all: false, help: false };
    let commands = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === '--help') {
        options.help = true;
      } else if (arg === '-a') {
        options.all = true;
      } else if (arg.startsWith('-')) {
        stderr.write(`which: invalid option -- '${arg}'\n`);
        return 1;
      } else {
        commands.push(arg);
      }
    }

    if (options.help) {
      stdout.write(`Usage: which [OPTION]... COMMAND...
Locate a command in the user's PATH.

Options:
  -a     print all matching pathnames (not just the first)
  --help display this help and exit

Exit status:
  0      if all specified commands are found
  1      if any specified command is not found
`);
      return 0;
    }

    if (commands.length === 0) {
      stderr.write('which: missing command operand\n');
      return 1;
    }

    let pathDirs = ['/bin', '/usr/bin', '/usr/local/bin'];
    let foundAll = true;

    for (const command of commands) {
      let found = false;
      let foundPaths = [];

      for (const dir of pathDirs) {
        const fullPath = dir === '/' ? `/${command}.js` : `${dir}/${command}.js`;
        try {
          const stats = await vfs.stat(fullPath);
          if (stats.isFile()) {
            found = true;
            foundPaths.push(fullPath);
            if (!options.all) break;
          }
        } catch (err) {}
      }

      const builtins = ['cd', 'exit', 'jobs', 'fg', 'bg', 'kill', 'alias', 'unalias', 'history', 'type', 'hash', 'set', 'unset', 'export', 'source'];
      if (builtins.includes(command) && !found) {
        found = true;
        foundPaths.push(`${command} (built-in)`);
      }

      if (found) {
        for (const foundPath of foundPaths) stdout.write(foundPath + '\n');
      } else {
        foundAll = false;
        stderr.write(`which: no ${command} in (${pathDirs.join(':')})\n`);
      }
    }

    return foundAll ? 0 : 1;
  }
}

module.exports = WhichCommand;