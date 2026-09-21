/**
 * @file research/lib/chain/MathExt.js
 * @author Will Fobbs
 * @version 1.0.0
 * @description Installs Math.ext (a namespace) and Math.init(ExtClass, opts)
 *              (a registration function) onto the real, global Math object.
 *              Math.init constructs one default shared instance of ExtClass
 *              and installs it at Math.ext.<name> -- so Math.ext.Vector.add(...)
 *              works with zero ceremony -- while ExtClass itself stays
 *              exposed and newable for a caller who wants an independent
 *              instance (Math.ext.Vector.constructor, or importing the
 *              class directly).
 *
 *              Collision policy is borrowed from ExtendX.override(), not
 *              reinvented: registering a name that already exists throws
 *              unless the caller explicitly passes { overrides: true } --
 *              same rule, same reasoning (two unrelated things sharing one
 *              name is a bug the guard exists to catch; a deliberate
 *              replacement is the one case allowed to say so explicitly).
 *
 *              The init pattern is meant to be fractal: Math.init installs
 *              a group at the Math level, and nothing here prevents that
 *              group's own class from exposing a second, narrower .init()
 *              of its own (e.g. Vector.init(VectorWasm) swapping that one
 *              group's backend) -- this file only provides the top level.
 * @principle "Interface Polymorphism" -- Math becomes a plugin host by
 *   adding a namespace and a registration function, not by overriding
 *   anything that already exists.
 * @example Math.init(Vector); // installs Math.ext.Vector
 * @example Math.ext.Vector.add([1,2], [3,4]); // [4,6]
 * @example Math.init(Vector, { overrides: true }); // deliberate replacement
 */
(function (root, factory)
{
  if (typeof module === 'object' && module.exports)
  {
    module.exports = factory(typeof Math !== 'undefined' ? Math : undefined);
  }
  else if (typeof define === 'function' && define.amd)
  {
    define([], function () { return factory(Math); });
  }
  else
  {
    root.MathExt = factory(Math);
  }
}(typeof self !== 'undefined' ? self : this, function (MathGlobal)
{
  'use strict';

  if (typeof MathGlobal.init === 'function' && MathGlobal.init.__mathExtAware)
  {
    return {
      name: 'MathExt',
      author: 'Will Fobbs',
      version: '1.0.0',
      install: MathGlobal.init,
    };
  }

  MathGlobal.ext = MathGlobal.ext || {};

  /**
   * @param {Function} ExtClass a class with static `extName` (or a plain
   *   `.name`), an empty constructor, and an `init(config)` returning `this`
   * @param {object} [opts]
   * @param {boolean} [opts.overrides=false] required to replace an
   *   already-registered name; otherwise a collision throws
   * @param {*} [opts.config] passed straight through to `new ExtClass().init(config)`
   * @returns {object} the installed default instance, at `Math.ext[name]`
   */
  function install(ExtClass, opts)
  {
    const options = opts || {};
    if (typeof ExtClass !== 'function')
    {
      throw new TypeError('Math.init: ExtClass must be a constructor function');
    }
    const name = ExtClass.extName || ExtClass.name;
    if (!name)
    {
      throw new TypeError('Math.init: ExtClass needs a stable name (static extName, or a named class/function)');
    }
    if (Object.prototype.hasOwnProperty.call(MathGlobal.ext, name) && options.overrides !== true)
    {
      throw new Error('Math.init: "' + name + '" is already registered under Math.ext. Pass { overrides: true } to replace it deliberately.');
    }
    const instance = new ExtClass().init(options.config);
    instance.constructor = ExtClass;
    MathGlobal.ext[name] = instance;
    return instance;
  }
  install.__mathExtAware = true;

  MathGlobal.init = install;

  return {
    name: 'MathExt',
    author: 'Will Fobbs',
    version: '1.0.0',
    description: 'Installs Math.ext (namespace) and Math.init(ExtClass, opts) (registration, ExtendX.override()-style collision policy) onto the global Math object.',
    docs: ['research/lib/chain/docs/MathExt.md'],
    tests: ['research/lib/chain/tests/MathExt.unit.js'],
    install,
  };
}));
