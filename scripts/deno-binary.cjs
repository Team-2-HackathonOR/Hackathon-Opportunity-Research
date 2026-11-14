const path = require("node:path");
module.exports = () => {
  const platform = `${process.platform}-${process.arch}${process.platform === "linux" ? "-glibc" : ""}`;
  return path.join(path.dirname(require.resolve(`@deno/${platform}/package.json`)),
    process.platform === "win32" ? "deno.exe" : "deno");
};
