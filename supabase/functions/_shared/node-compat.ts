import { Buffer } from "node:buffer";

// The PostgreSQL npm client expects Node's global Buffer in Edge runtimes too.
if (typeof globalThis.Buffer === "undefined") {
  globalThis.Buffer = Buffer;
}
