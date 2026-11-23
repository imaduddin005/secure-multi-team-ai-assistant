import type { Config } from './config';
import type { Database } from './database';
import type { TokenVerifier } from './auth';
export interface Source {
  chunkId:string; documentId:string; versionId:string; title:string; text:string; label:string;
  locationKind:'page'|'lines'; pageStart:number|null; pageEnd:number|null; lineStart:number|null; lineEnd:number|null;
}
export interface StorageAdapter {
  put(key:string,bytes:Uint8Array,mime:string):Promise<void>;
  get(key:string):Promise<Uint8Array>;
  remove(keys:string[]):Promise<void>;
}
export interface AIAdapter {
  embed(texts:string[]):Promise<number[][]>;
  answer(question:string,sources:Source[]):Promise<{answer:string;citations:string[]}>;
}
export interface AppContext { db:Database; cfg:Config; verifier:TokenVerifier; storage:StorageAdapter; ai:AIAdapter }
