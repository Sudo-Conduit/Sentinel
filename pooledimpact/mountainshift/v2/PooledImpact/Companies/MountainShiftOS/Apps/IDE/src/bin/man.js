/**
 * @file /bin/man.js
 * @author Will Fobbs
 * @version 3.0.0
 * @description Unified man page – static properties + method docblocks (reflection + source parsing)
 */

(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.ManCommand = factory();
}(typeof self !== 'undefined' ? self : this, function() {
  class ManCommand {
    static name = 'man';
    static author = 'Will Fobbs';
    static version = '3.0.0';
    static description = 'Display manual pages for core commands and user files.';
    static docs = ['/docs/man/README.md'];
    static tests = ['/tests/man/unit.js'];
    static config_default = { supportsHeredoc: false, resourceMonitored: true };

    // ---------- JSDoc parser (class-level and method-level) ----------
    _parseJSDoc(content) {
      const jsdocMatch = content.match(/\/\*\*([\s\S]*?)\*\//);
      if (!jsdocMatch) return null;
      const jsdoc = jsdocMatch[1];
      const result = {};
      const tags = ['file', 'author', 'version', 'description', 'param', 'returns',
                    'throws', 'example', 'features', 'pattern', 'rationale',
                    'principle', 'AI_Instructions'];
      for (const tag of tags) {
        const regex = new RegExp(`@${tag}\\s+([^@]+)`, 'g');
        const matches = [...jsdoc.matchAll(regex)];
        if (matches.length) {
          result[tag] = matches.map(m => m[1].trim()).join('\n');
        }
      }
      return result;
    }

    _extractMethodDocblocks(sourceCode) {
      const methodBlocks = new Map();
      const regex = /\/\*\*([\s\S]*?)\*\/\s*(\w+)\s*\(/g;
      let match;
      while ((match = regex.exec(sourceCode)) !== null) {
        const jsdoc = match[1];
        const methodName = match[2];
        const result = {};
        const tags = ['param', 'returns', 'throws', 'example'];
        for (const tag of tags) {
          const tagRegex = new RegExp(`@${tag}\\s+([^@]+)`, 'g');
          const matches = [...jsdoc.matchAll(tagRegex)];
          if (matches.length) {
            result[tag] = matches.map(m => m[1].trim()).join('\n');
          }
        }
        if (Object.keys(result).length > 0) {
          methodBlocks.set(methodName, result);
        }
      }
      return methodBlocks;
    }

    /**
     * Executes the man command.
     * @param {Array<string>} args - Command line arguments.
     *   - list core.* : list all core commands
     *   - show core.<cmd> [--field] : show command details (author, version, description, docs, tests, config, methods)
     *   - docs core.<cmd> [--show <index>] : show documentation files
     *   - tests core.<cmd> : show test file paths
     *   - <file.js> : display JSDoc from a JavaScript file
     * @param {Object} context - Execution context.
     * @param {Object} context.stdin - Async iterable stdin.
     * @param {Object} context.stdout - Writeable stream for stdout.
     * @param {Object} context.stderr - Writeable stream for stderr.
     * @param {string} context.cwd - Current working directory.
     * @param {Object} context.vfs - Virtual file system instance.
     * @returns {Promise<number>} Exit code (0 success, 1 error).
     * @example
     * man list core.*
     * man show core.ls --author
     * man docs core.edit --show 0
     * man /lib/z_attention.js
     */
    async execute(args, context) {
      const { stdout, stderr, vfs, cwd } = context;
      if (args.length === 0) {
        stderr.write('Usage: man list core.* | man show core.<cmd> [--field] | man <file.js>\n');
        return 1;
      }

      // ---- Core command introspection (static properties + methods) ----
      if (args[0] === 'list') {
        const target = args[1];
        if (target === 'core.*') {
          const files = await vfs.readdir('/bin');
          for (const f of files) {
            try {
              const cmdClass = await vfs.readClass(`/bin/${f}`);
              if (cmdClass && cmdClass.name) {
                stdout.write(`${cmdClass.name} – ${cmdClass.description || 'No description'}\n`);
              }
            } catch(e) { /* ignore */ }
          }
          return 0;
        }
        stderr.write(`Unknown namespace: ${target}\n`);
        return 1;
      }

      if (args[0] === 'show') {
        const cmdRef = args[1];
        if (!cmdRef || !cmdRef.startsWith('core.')) {
          stderr.write('Usage: man show core.<command> [--field]\n');
          return 1;
        }
        const cmdName = cmdRef.substring(5);
        const fullPath = `/bin/${cmdName}.js`;
        const cmdClass = await vfs.readClass(fullPath).catch(() => null);
        if (!cmdClass) {
          stderr.write(`Command ${cmdName} not found.\n`);
          return 1;
        }
        const fieldFlag = args[2];
        if (fieldFlag === '--author') {
          stdout.write(`${cmdClass.author || 'Unknown'}\n`);
          return 0;
        }

        // Basic static info
        stdout.write(`Command: ${cmdName}\n`);
        stdout.write(`Author: ${cmdClass.author || 'Unknown'}\n`);
        stdout.write(`Version: ${cmdClass.version || 'n/a'}\n`);
        stdout.write(`Description: ${cmdClass.description || 'None'}\n`);
        if (cmdClass.docs) stdout.write(`Docs: ${cmdClass.docs.join(', ')}\n`);
        if (cmdClass.tests) stdout.write(`Tests: ${cmdClass.tests.join(', ')}\n`);
        if (cmdClass.config_default) stdout.write(`Config: ${JSON.stringify(cmdClass.config_default)}\n`);

        // ---- Method listing via reflection + docblocks ----
        const sourceCode = await vfs.readFile(fullPath, 'utf8');
        const methodDocblocks = this._extractMethodDocblocks(sourceCode);
        const methodNames = Reflect.ownKeys(cmdClass.prototype)
          .filter(name => name !== 'constructor' && typeof cmdClass.prototype[name] === 'function' && !name.startsWith('_'));

        if (methodNames.length) {
          stdout.write(`\nMethods:\n`);
          for (const method of methodNames) {
            const doc = methodDocblocks.get(method);
            stdout.write(`  ${method}()`);
            if (doc && doc.param) {
              stdout.write(`\n    Parameters: ${doc.param.replace(/\n/g, '\n    ')}`);
            }
            if (doc && doc.returns) {
              stdout.write(`\n    Returns: ${doc.returns}`);
            }
            if (doc && doc.example) {
              stdout.write(`\n    Example: ${doc.example.replace(/\n/g, '\n    ').slice(0, 200)}`);
            }
            stdout.write(`\n`);
          }
        }
        return 0;
      }

      if (args[0] === 'docs') {
        const cmdRef = args[1];
        if (!cmdRef || !cmdRef.startsWith('core.')) {
          stderr.write('Usage: man docs core.<command> [--show <index>]\n');
          return 1;
        }
        const cmdName = cmdRef.substring(5);
        const cmdClass = await vfs.readClass(`/bin/${cmdName}.js`).catch(() => null);
        if (!cmdClass) {
          stderr.write(`Command ${cmdName} not found.\n`);
          return 1;
        }
        const docs = cmdClass.docs || [];
        if (args[2] === '--show') {
          const idx = parseInt(args[3], 10);
          if (isNaN(idx) || idx < 0 || idx >= docs.length) {
            stderr.write('Invalid index.\n');
            return 1;
          }
          const docPath = docs[idx];
          if (docPath.startsWith('http')) {
            stdout.write(`Remote doc: ${docPath}\n`);
          } else {
            try {
              const content = await vfs.readFile(docPath);
              stdout.write(content + '\n');
            } catch(e) {
              stderr.write(`Cannot read doc: ${e.message}\n`);
              return 1;
            }
          }
        } else {
          for (let i = 0; i < docs.length; i++) stdout.write(`[${i}] ${docs[i]}\n`);
        }
        return 0;
      }

      if (args[0] === 'tests') {
        const cmdRef = args[1];
        if (!cmdRef || !cmdRef.startsWith('core.')) {
          stderr.write('Usage: man tests core.<command>\n');
          return 1;
        }
        const cmdName = cmdRef.substring(5);
        const cmdClass = await vfs.readClass(`/bin/${cmdName}.js`).catch(() => null);
        if (!cmdClass) {
          stderr.write(`Command ${cmdName} not found.\n`);
          return 1;
        }
        const tests = cmdClass.tests || [];
        for (const t of tests) stdout.write(t + '\n');
        return 0;
      }

      // ---- Fallback: JSDoc parsing for user files ----
      let target = args[0];
      if (!target.endsWith('.js')) target += '.js';
      if (!target.startsWith('/')) {
        const binPath = `/bin/${target}`;
        const libPath = `/lib/${target}`;
        const cwdPath = cwd.endsWith('/') ? cwd + target : cwd + '/' + target;
        if (await vfs.exists(binPath)) target = binPath;
        else if (await vfs.exists(libPath)) target = libPath;
        else if (await vfs.exists(cwdPath)) target = cwdPath;
        else {
          stderr.write(`man: ${target}: No such file or directory\n`);
          return 1;
        }
      } else if (!await vfs.exists(target)) {
        stderr.write(`man: ${target}: No such file or directory\n`);
        return 1;
      }

      const content = await vfs.readFile(target, 'utf8');
      const jsdoc = this._parseJSDoc(content);
      if (!jsdoc) {
        stderr.write(`man: ${target}: No JSDoc found\n`);
        return 1;
      }

      const name = jsdoc.file || target.split('/').pop();
      stdout.write(`\n${'='.repeat(70)}\n`);
      stdout.write(`MANUAL PAGE: ${name}\n`);
      stdout.write(`${'='.repeat(70)}\n\n`);

      if (jsdoc.description) stdout.write(`NAME\n    ${name} – ${jsdoc.description.split('\n')[0]}\n\n`);
      if (jsdoc.version) stdout.write(`VERSION\n    ${jsdoc.version}\n\n`);
      if (jsdoc.author) stdout.write(`AUTHOR\n    ${jsdoc.author}\n\n`);
      if (jsdoc.param || jsdoc.returns || jsdoc.throws) {
        stdout.write(`SYNOPSIS\n`);
        if (jsdoc.param) stdout.write(`    ${jsdoc.param.replace(/\n/g, '\n    ')}\n`);
        if (jsdoc.returns) stdout.write(`    Returns: ${jsdoc.returns}\n`);
        if (jsdoc.throws) stdout.write(`    Throws: ${jsdoc.throws}\n`);
        stdout.write(`\n`);
      }
      if (jsdoc.description) stdout.write(`DESCRIPTION\n    ${jsdoc.description.replace(/\n/g, '\n    ')}\n\n`);
      if (jsdoc.example) stdout.write(`EXAMPLES\n    ${jsdoc.example.replace(/\n/g, '\n    ')}\n\n`);
      if (jsdoc.features) stdout.write(`FEATURES\n    ${jsdoc.features.replace(/\n/g, '\n    ')}\n\n`);
      if (jsdoc.pattern) stdout.write(`PATTERN\n    ${jsdoc.pattern}\n\n`);
      if (jsdoc.rationale) stdout.write(`RATIONALE\n    ${jsdoc.rationale}\n\n`);
      if (jsdoc.principle) stdout.write(`PRINCIPLES\n    ${jsdoc.principle.replace(/\n/g, '\n    ')}\n\n`);
      if (jsdoc.AI_Instructions) stdout.write(`AI INSTRUCTIONS\n    ${jsdoc.AI_Instructions.replace(/\n/g, '\n    ')}\n\n`);

      return 0;
    }
  }
  return ManCommand;
}));