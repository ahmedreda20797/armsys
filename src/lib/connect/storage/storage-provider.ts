// src/lib/connect/storage/storage-provider.ts
// ══════════════════════════════════════════════════════════════
//  QNALYS Connect 1.0 — STORAGE-INDEPENDENT ATTACHMENT CONTRACT
//
//  A CONTRACT ONLY (§SPEC-5E / §SPEC-15). Firebase Storage is
//  unavailable (requires a paid plan) and NO upload/download is
//  implemented in 1.0 — there are no fake upload controls, no public
//  URLs, no Base64-in-RTDB fallback.
//
//  The contract exists so a future provider (self-hosted object
//  storage, Firebase Storage when the plan allows) plugs in WITHOUT
//  touching message/conversation business logic: services speak only
//  the types below.
//
//  §NOT-WIRED: no route, no UI control and no RTDB path references
//  this module in 1.0 beyond the type contract itself.
// ══════════════════════════════════════════════════════════════

/** Logical attachment entity (future persisted shape — NOT used in 1.0). */
export interface AttachmentRecord {
  attachmentId: string;
  conversationId: string;
  messageId: string;
  uploaderUserId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  /** Provider id (see StorageProvider). */
  provider: string;
  /** Provider-specific opaque reference (bucket/path/key). */
  storageRef: string;
  uploadState: 'pending' | 'complete' | 'failed';
  createdAt: string;
  updatedAt: string;
}

export interface StorageUploadInput {
  conversationId: string;
  uploaderUserId: string;
  filename: string;
  mimeType: string;
  /** Provider-agnostic byte source — never persisted in RTDB. */
  bytes: Uint8Array;
}

export interface StorageUploadResult {
  attachment: AttachmentRecord;
}

/**
 * The storage boundary. A future implementation fills this interface;
  * message logic never learns which provider is behind it.
 */
export interface StorageProvider {
  readonly id: string;
  /** true when the provider can actually store bytes. */
  readonly available: boolean;
  upload(input: StorageUploadInput): Promise<StorageUploadResult>;
  /** A download URL usable by AUTHORIZED members (enforcement upstream). */
  downloadUrl(attachment: AttachmentRecord): Promise<string>;
}

/** §NOT-AVAILABLE — the ONLY provider in 1.0. Every call fails loudly. */
export const unavailableStorageProvider: StorageProvider = {
  id: 'unavailable',
  available: false,
  async upload(): Promise<StorageUploadResult> {
    throw new Error('مرفقات المحادثات غير متاحة في الإصدار الحالي (التخزين السحابي يتطلب ترقية خطة Firebase)');
  },
  async downloadUrl(): Promise<string> {
    throw new Error('مرفقات المحادثات غير متاحة في الإصدار الحالي');
  },
};

export function getStorageProvider(): StorageProvider {
  return unavailableStorageProvider;
}
