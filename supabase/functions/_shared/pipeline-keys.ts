import { Buffer } from "node:buffer";
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { env, HttpError } from "./runtime.ts";

function encryptionKey() {
  const key = Buffer.from(env("PIPELINE_KEY_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new HttpError(503, "Pipeline encryption key must decode to 32 bytes.");
  return key;
}
export function encryptKey(value: string, id: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}
export function decryptKey(value: string, id: string) {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(), data.subarray(0, 12));
  cipher.setAAD(Buffer.from(id));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString("utf8");
}
