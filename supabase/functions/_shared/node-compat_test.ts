import { Buffer } from "node:buffer";
import postgres from "npm:postgres@3.4.7";

Deno.test("PostgreSQL initializes when the Edge runtime has no global Buffer", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
  try {
    Reflect.deleteProperty(globalThis, "Buffer");
    await import("./node-compat.ts?missing-buffer");
    if (globalThis.Buffer !== Buffer) throw new Error("Node Buffer compatibility was not installed.");
    const sql = postgres("postgresql://test:test@127.0.0.1:1/test", { max: 1, prepare: false });
    await sql.end({ timeout: 0 });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "Buffer", descriptor);
    else Reflect.deleteProperty(globalThis, "Buffer");
  }
});

Deno.test("Node compatibility preserves an existing runtime Buffer", async () => {
  const previous = globalThis.Buffer;
  await import("./node-compat.ts?existing-buffer");
  if (globalThis.Buffer !== previous) throw new Error("Existing runtime Buffer was replaced.");
});
