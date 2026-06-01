export class MemoCodecError extends Error {}

export class MemoTooLargeError extends MemoCodecError {
  constructor(
    readonly size: number,
    readonly limit: number,
  ) {
    super(`memo payload is ${size} bytes, exceeds the ${limit}-byte limit; use a pointer`);
    this.name = "MemoTooLargeError";
  }
}

export class MalformedMemoError extends MemoCodecError {
  constructor(reason: string) {
    super(`malformed memo: ${reason}`);
    this.name = "MalformedMemoError";
  }
}

export class UnsupportedVersionError extends MemoCodecError {
  constructor(readonly version: number) {
    super(`unsupported memo version: ${version}`);
    this.name = "UnsupportedVersionError";
  }
}
