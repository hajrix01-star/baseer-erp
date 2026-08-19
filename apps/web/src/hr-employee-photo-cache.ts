import type { ActiveSession } from "./daily-sales-client";
import { downloadHrEmployeeDocumentVersion, listHrEmployeeDocuments, type HrEmployeeDocument } from "./hr-client";

import { HR_PROFILE_PHOTO_REFERENCE } from "./hr-employee-photo-reference";

const maxConcurrentRequests = 4;
const maxCachedDocumentLists = 200;
const maxCachedBlobs = 64;

let cacheScope = "";
let activeRequests = 0;
const requestQueue: Array<() => void> = [];
const documentLists = new Map<string, Promise<readonly HrEmployeeDocument[]>>();
const blobs = new Map<string, Promise<Blob>>();

function prepareScope(session: ActiveSession) {
  const nextScope = `${session.companyId}\u0000${session.accessToken}`;
  if (nextScope === cacheScope) return;
  cacheScope = nextScope;
  documentLists.clear();
  blobs.clear();
}

function runNext() {
  while (activeRequests < maxConcurrentRequests) {
    const start = requestQueue.shift();
    if (!start) return;
    activeRequests += 1;
    start();
  }
}

function schedule<T>(request: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    requestQueue.push(() => {
      void request().then(resolve, reject).finally(() => {
        activeRequests -= 1;
        runNext();
      });
    });
    runNext();
  });
}

function remember<K, V>(cache: Map<K, V>, key: K, value: V, maximum: number) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maximum) cache.delete(cache.keys().next().value!);
}

function cachedDocumentList(session: ActiveSession, employeeId: string) {
  prepareScope(session);
  const cached = documentLists.get(employeeId);
  if (cached) {
    remember(documentLists, employeeId, cached, maxCachedDocumentLists);
    return cached;
  }
  const pending = schedule(() => listHrEmployeeDocuments(session, employeeId, { status: "ACTIVE", pageSize: 100 }))
    .then((receipt) => receipt.documents)
    .catch((error) => {
      if (documentLists.get(employeeId) === pending) documentLists.delete(employeeId);
      throw error;
    });
  remember(documentLists, employeeId, pending, maxCachedDocumentLists);
  return pending;
}

export async function getCachedHrEmployeePhotoDocument(session: ActiveSession, employeeId: string) {
  const documents = await cachedDocumentList(session, employeeId);
  return documents.find((item) => item.referenceNumber === HR_PROFILE_PHOTO_REFERENCE && item.currentVersion?.blobStatus === "READY" && item.currentVersion.mimeType.startsWith("image/")) ?? null;
}

export function getCachedHrEmployeePhotoBlob(session: ActiveSession, versionId: string) {
  prepareScope(session);
  const cached = blobs.get(versionId);
  if (cached) {
    remember(blobs, versionId, cached, maxCachedBlobs);
    return cached;
  }
  const pending = schedule(() => downloadHrEmployeeDocumentVersion(session, versionId))
    .then(({ blob }) => blob)
    .catch((error) => {
      if (blobs.get(versionId) === pending) blobs.delete(versionId);
      throw error;
    });
  remember(blobs, versionId, pending, maxCachedBlobs);
  return pending;
}

export function primeHrEmployeePhotoBlob(session: ActiveSession, versionId: string, blob: Blob) {
  prepareScope(session);
  remember(blobs, versionId, Promise.resolve(blob), maxCachedBlobs);
}

export function invalidateHrEmployeePhotoDocuments(session: ActiveSession, employeeId: string) {
  prepareScope(session);
  documentLists.delete(employeeId);
}
