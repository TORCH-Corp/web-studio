declare module 'pg' {
  const pg: { types: { setTypeParser(oid: number, parser: (value: string) => unknown): void } };
  export default pg;
}
