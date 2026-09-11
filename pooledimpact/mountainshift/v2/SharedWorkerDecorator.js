/**
 * SharedWorkerDecorator.js
 *
 * Composes a SharedWorker's script from real, live code instead of a
 * hand-typed template string. The worker still has to be built via
 * Blob + createObjectURL -- that's the only way to hand a SharedWorker
 * dynamically-composed code -- but what actually made the previous
 * approach brittle was typing/copying source into a literal by hand.
 * That's what this replaces: everything composed here comes from a real
 * source (a live class/function, reflected via toString(); or a file's
 * real text, fetched) and is never duplicated by hand.
 *
 * CodeComposer.inject(ClassDef) only faithfully reproduces code that
 * round-trips through Function.prototype.toString(): a real ES6 `class`
 * body (methods included), or a plain function. It does NOT capture
 * methods added afterward via `Foo.prototype.x = function(){}` --
 * toString() on the constructor alone omits every one of those. For that
 * style, use injectSource(text) with the real file's text (e.g. from
 * fetch()) -- still not hand-pasted, just not reflectable.
 */

class CodeComposer
{
    constructor()
    {
        this.parts = [];
    }

    /** Compose a live class/function's real source via toString(). */
    inject(ClassDef)
    {
        this.parts.push(ClassDef.toString());
        return this;
    }

    /**
     * Compose real source text obtained elsewhere (fetch, import, etc)
     * for code that doesn't round-trip through toString() -- e.g.
     * ES5 prototype-style definitions. Caller is expected to obtain
     * 'text' from the real source, never by retyping it.
     */
    injectSource(text)
    {
        this.parts.push(text);
        return this;
    }

    toString()
    {
        return this.parts.join('\n\n');
    }
}

class SharedWorkerDecorator extends CodeComposer
{
    /**
     * @param {Function} targetFn - a plain function whose BODY is the
     * worker's own top-level script (self.onconnect, etc). Must be a
     * real function (not an ES6 class) so toString() extraction of its
     * body is unambiguous.
     */
    constructor(targetFn)
    {
        super();
        if (typeof targetFn !== 'function')
        {
            throw new TypeError('SharedWorkerDecorator target must be a function whose body is the worker script');
        }
        this.targetFn = targetFn;
    }

    build()
    {
        const injectionsStr = this.toString();

        // Extract the target function's body: 'function name(...) { <body> }'
        const targetStr = this.targetFn.toString();
        const body = targetStr
            .replace(/^[^{]*{\s*/, '')
            .replace(/\s*}[^}]*$/, '');

        const code = injectionsStr ? `${injectionsStr}\n\n${body}` : body;
        const blob = new Blob([code], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);

        return {
            url,
            worker: new SharedWorker(url),
            destroy()
            {
                URL.revokeObjectURL(url);
            }
        };
    }
}
