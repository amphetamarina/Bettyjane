export type MemoKind = "memory" | "pin";

export type MemoContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "pointer"; readonly pointer: Uint8Array };

export interface Memo {
  readonly kind: MemoKind;
  readonly content: MemoContent;
}

export class EmptyMemoError extends Error {
  constructor() {
    super("memo content must not be empty");
    this.name = "EmptyMemoError";
  }
}

export function text(value: string): MemoContent {
  if (value.length === 0) throw new EmptyMemoError();
  return { type: "text", text: value };
}

export function pointer(bytes: Uint8Array): MemoContent {
  if (bytes.length === 0) throw new EmptyMemoError();
  return { type: "pointer", pointer: bytes };
}

export function memory(content: MemoContent): Memo {
  return { kind: "memory", content };
}

export function pin(content: MemoContent): Memo {
  return { kind: "pin", content };
}
