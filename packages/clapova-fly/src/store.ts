/**
 * Object storage seam (Cloudflare R2 or any S3-compatible bucket).
 * Everything the coordinator and the Machines exchange goes through this
 * interface, so tests use the local directory store.
 */

import {
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

export interface ObjectInfo {
  size: number;
}

export interface ObjectStore {
  putFile(key: string, filePath: string): Promise<void>;
  getFile(key: string, destPath: string): Promise<void>;
  /** Null when the object does not exist. */
  head(key: string): Promise<ObjectInfo | null>;
  putText(key: string, body: string): Promise<void>;
  /** Null when the object does not exist. */
  getText(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

/** Filesystem-backed store for tests and local dry runs. */
export function createLocalStore(root: string): ObjectStore {
  const at = (key: string) => {
    if (key.includes("..")) throw new Error(`invalid key: ${key}`);
    return join(root, key);
  };
  return {
    async putFile(key, filePath) {
      const dest = at(key);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(filePath, dest);
    },
    async getFile(key, destPath) {
      const src = at(key);
      if (!existsSync(src)) throw new Error(`object not found: ${key}`);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(src, destPath);
    },
    async head(key) {
      const p = at(key);
      return existsSync(p) ? { size: statSync(p).size } : null;
    },
    async putText(key, body) {
      const dest = at(key);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, body);
    },
    async getText(key) {
      const p = at(key);
      return existsSync(p) ? readFileSync(p, "utf-8") : null;
    },
    async remove(key) {
      rmSync(at(key), { force: true });
    },
  };
}

export interface S3StoreOptions {
  bucket: string;
  /** Key prefix, e.g. "renders". */
  prefix?: string;
  /** R2: https://<account>.r2.cloudflarestorage.com */
  endpoint?: string;
  /** R2 uses "auto". */
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Minimal slice of the AWS SDK v3 surface we use (avoids a hard type dependency). */
interface AwsS3Module {
  S3Client: new (cfg: Record<string, unknown>) => { send(cmd: unknown): Promise<any> };
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
  HeadObjectCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
}

export function readS3OptionsFromEnv(env: Record<string, string | undefined>): S3StoreOptions {
  const need = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`[clapova-fly] missing env ${name}`);
    return v;
  };
  return {
    bucket: need("R2_BUCKET"),
    prefix: env.R2_PREFIX ?? "renders",
    endpoint: env.R2_ENDPOINT,
    region: env.R2_REGION ?? "auto",
    accessKeyId: need("R2_ACCESS_KEY_ID"),
    secretAccessKey: need("R2_SECRET_ACCESS_KEY"),
  };
}

/** S3/R2 store. The AWS SDK is imported lazily so unit tests never need it. */
export async function createS3Store(opts: S3StoreOptions): Promise<ObjectStore> {
  const specifier = "@aws-sdk/client-s3";
  const sdk = (await import(/* @vite-ignore */ specifier)) as AwsS3Module;
  const client = new sdk.S3Client({
    region: opts.region ?? "auto",
    endpoint: opts.endpoint,
    forcePathStyle: opts.endpoint !== undefined,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
  });
  const full = (key: string) => (opts.prefix ? `${opts.prefix}/${key}` : key);
  const Bucket = opts.bucket;
  const isMissing = (e: unknown) => {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    return (
      err?.name === "NotFound" || err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404
    );
  };
  return {
    async putFile(key, filePath) {
      await client.send(
        new sdk.PutObjectCommand({
          Bucket,
          Key: full(key),
          Body: createReadStream(filePath),
          ContentLength: statSync(filePath).size,
        }),
      );
    },
    async getFile(key, destPath) {
      const res = await client.send(new sdk.GetObjectCommand({ Bucket, Key: full(key) }));
      mkdirSync(dirname(destPath), { recursive: true });
      await pipeline(res.Body, createWriteStream(destPath));
    },
    async head(key) {
      try {
        const res = await client.send(new sdk.HeadObjectCommand({ Bucket, Key: full(key) }));
        return { size: Number(res.ContentLength ?? 0) };
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async putText(key, body) {
      await client.send(
        new sdk.PutObjectCommand({
          Bucket,
          Key: full(key),
          Body: body,
          ContentType: "application/json",
        }),
      );
    },
    async getText(key) {
      try {
        const res = await client.send(new sdk.GetObjectCommand({ Bucket, Key: full(key) }));
        return (await res.Body.transformToString()) as string;
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async remove(key) {
      await client.send(new sdk.DeleteObjectCommand({ Bucket, Key: full(key) }));
    },
  };
}

/** Key layout. One prefix per plan hash, so a rerun of the same plan resumes. */
export const keys = {
  plan: (planHash: string) => `${planHash}/plan.tar.gz`,
  chunk: (planHash: string, index: number, ext: string) => `${planHash}/chunks/${index}${ext}`,
  chunkDone: (planHash: string, index: number) => `${planHash}/chunks/${index}.done.json`,
  output: (jobId: string, ext: string) => `outputs/${jobId}${ext}`,
};

export interface ChunkDoneMarker {
  index: number;
  sha256: string;
  size: number;
  framesEncoded: number;
}
