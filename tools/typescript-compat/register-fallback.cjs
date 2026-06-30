const Module = require('module');
const path = require('path');

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'typescript') {
        try {
            const paths = parent ? parent.paths : [];
            return require.resolve('typescript-js', { paths });
        } catch (e) {
            // Fallback if typescript-js is not installed locally
            return originalResolveFilename.apply(this, arguments);
        }
    }
    return originalResolveFilename.apply(this, arguments);
};

// Also register an ESM loader so that ESM imports (like typedoc) get intercepted.
try {
    const { register } = require('node:module');
    const loaderCode = `
export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'typescript') {
        return nextResolve('typescript-js', context);
    }
    return nextResolve(specifier, context);
}
    `;
    register('data:text/javascript,' + encodeURIComponent(loaderCode));
} catch (e) {
    // Ignore if module.register is unavailable or already registered.
}
