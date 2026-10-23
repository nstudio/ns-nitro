export interface HybridObject<PlatformSpec = { ios?: 'swift' | 'c++' }> {
  readonly name: string;
  readonly memorySize: number;
  toString(): string;
  dispose(): void;
  equals(other: HybridObject<PlatformSpec>): boolean;
}

/**
 * Nitrogen `.nitro.ts` specification for `DeviceSecureEnclave`.
 *
 * Bridges pure Swift 6 CryptoKit value types (`HKDF<SHA256>`, `AES.GCM.SealedBox`,
 * `SymmetricKey`) and C++20 `NitroModules::ArrayBuffer` / `NitroModules::Promise<T>`
 * directly into NativeScript's V8 JSI runtime via `HybridObjectRegistry`.
 */
export interface DeviceSecureEnclave extends HybridObject<{ ios: 'swift' }> {
  readonly enclaveArchitecture: string;
  readonly hardwareConcurrency: number;
  readonly operationsExecuted: number;

  /**
   * Derives a 256-bit (64 hex char) cryptographic key using pure Swift
   * `CryptoKit.HKDF<SHA256>.deriveKey` with zero Objective-C overhead.
   */
  deriveHkdfKeyHex(secret: string, salt: string, info: string): string;

  /**
   * Encrypts `plaintext` with `CryptoKit.AES.GCM.seal` (12-byte nonce +
   * ciphertext + 16-byte authentication tag) and returns the combined box hex.
   */
  sealAesGcmPayload(plaintext: string, secret: string): string;

  /**
   * Allocates a zero-copy C++20 `NitroModules::ArrayBuffer` and populates it
   * in-place with cryptographic entropy from Swift `SymmetricKey(size: .bits256)`.
   */
  generateEntropyBuffer(byteLength: number): ArrayBuffer;

  /**
   * Runs `rounds` iterations of `HKDF<SHA256>` key derivation on a background
   * worker thread via `NitroModules::Promise<T>::async` and resolves on the
   * NativeScript V8 `tns::EventLoop`.
   */
  deriveKeyRoundsAsync(secret: string, rounds: number): Promise<string>;
}
