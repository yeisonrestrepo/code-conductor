export async function resolve(specifier, context, next) {
  if (specifier === 'node:sqlite' || specifier === 'sqlite') {
    const err = new Error("Cannot find module 'node:sqlite'");
    err.code = 'ERR_MODULE_NOT_FOUND';
    throw err;
  }
  return next(specifier, context);
}
