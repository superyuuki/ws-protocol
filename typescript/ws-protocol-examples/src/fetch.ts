export default async function fetch(
  ...args: Parameters<typeof import("node-fetch")["default"]>
): Promise<Response> {
  // Hack to import ESM-only module: https://github.com/microsoft/TypeScript/issues/43329
  // eslint-disable-next-line no-eval
  const importedFetch = ((await eval("import('node-fetch')")) as typeof import("node-fetch"))
    .default;
  return (await importedFetch(...args)) as Response;
}
