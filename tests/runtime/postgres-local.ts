import original from "npm:postgres@3.4.7";
function localPostgres(url: string, options: original.Options<{}>): original.Sql<{}> {
  const address = new URL(url);
  if (Deno.env.get("CI_RUNTIME_MODE") !== "disposable" ||
      address.hostname !== "127.0.0.1" || address.port !== "54329") {
    throw new Error("Local test PostgreSQL adapter refuses a non-fixture database.");
  }
  return original(url, { ...options, ssl: false });
}
namespace localPostgres {
  export type TransactionSql = original.TransactionSql;
}
export default localPostgres;
