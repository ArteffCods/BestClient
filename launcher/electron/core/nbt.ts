/**
 * Minimal Java-Edition NBT reader/writer - just enough for `servers.dat`.
 *
 * `servers.dat` is *uncompressed*, big-endian NBT whose root is a named TAG_Compound.
 * Strings use Java's modified UTF-8, which differs from standard UTF-8 for U+0000 and
 * for characters outside the BMP; both are handled here so an existing entry with an
 * emoji in its name survives a round trip untouched.
 */

export const TAG = {
  End: 0,
  Byte: 1,
  Short: 2,
  Int: 3,
  Long: 4,
  Float: 5,
  Double: 6,
  ByteArray: 7,
  String: 8,
  List: 9,
  Compound: 10,
  IntArray: 11,
  LongArray: 12,
} as const;

export type NbtTag =
  | { type: 'byte'; value: number }
  | { type: 'short'; value: number }
  | { type: 'int'; value: number }
  | { type: 'long'; value: bigint }
  | { type: 'float'; value: number }
  | { type: 'double'; value: number }
  | { type: 'byteArray'; value: Buffer }
  | { type: 'string'; value: string }
  | { type: 'list'; elementType: number; value: NbtTag[] }
  | { type: 'compound'; value: NbtCompound }
  | { type: 'intArray'; value: number[] }
  | { type: 'longArray'; value: bigint[] };

export type NbtCompound = Record<string, NbtTag>;

export interface NbtRoot {
  name: string;
  value: NbtCompound;
}

// --------------------------------------------------------------------------- reading

class Reader {
  private offset = 0;

  constructor(private readonly buffer: Buffer) {}

  byte(): number {
    const value = this.buffer.readInt8(this.offset);
    this.offset += 1;
    return value;
  }

  unsignedByte(): number {
    const value = this.buffer.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  short(): number {
    const value = this.buffer.readInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  unsignedShort(): number {
    const value = this.buffer.readUInt16BE(this.offset);
    this.offset += 2;
    return value;
  }

  int(): number {
    const value = this.buffer.readInt32BE(this.offset);
    this.offset += 4;
    return value;
  }

  long(): bigint {
    const value = this.buffer.readBigInt64BE(this.offset);
    this.offset += 8;
    return value;
  }

  float(): number {
    const value = this.buffer.readFloatBE(this.offset);
    this.offset += 4;
    return value;
  }

  double(): number {
    const value = this.buffer.readDoubleBE(this.offset);
    this.offset += 8;
    return value;
  }

  bytes(length: number): Buffer {
    const value = this.buffer.subarray(this.offset, this.offset + length);
    this.offset += length;
    return Buffer.from(value);
  }

  string(): string {
    const length = this.unsignedShort();
    return decodeModifiedUtf8(this.bytes(length));
  }

  get done(): boolean {
    return this.offset >= this.buffer.length;
  }
}

function readPayload(reader: Reader, type: number): NbtTag {
  switch (type) {
    case TAG.Byte:
      return { type: 'byte', value: reader.byte() };
    case TAG.Short:
      return { type: 'short', value: reader.short() };
    case TAG.Int:
      return { type: 'int', value: reader.int() };
    case TAG.Long:
      return { type: 'long', value: reader.long() };
    case TAG.Float:
      return { type: 'float', value: reader.float() };
    case TAG.Double:
      return { type: 'double', value: reader.double() };
    case TAG.ByteArray:
      return { type: 'byteArray', value: reader.bytes(reader.int()) };
    case TAG.String:
      return { type: 'string', value: reader.string() };
    case TAG.List: {
      const elementType = reader.unsignedByte();
      const length = reader.int();
      const value: NbtTag[] = [];

      for (let i = 0; i < length; i++) {
        value.push(readPayload(reader, elementType));
      }

      return { type: 'list', elementType, value };
    }
    case TAG.Compound: {
      const value: NbtCompound = {};

      for (;;) {
        const childType = reader.unsignedByte();
        if (childType === TAG.End) break;

        const name = reader.string();
        value[name] = readPayload(reader, childType);
      }

      return { type: 'compound', value };
    }
    case TAG.IntArray: {
      const length = reader.int();
      const value: number[] = [];

      for (let i = 0; i < length; i++) value.push(reader.int());

      return { type: 'intArray', value };
    }
    case TAG.LongArray: {
      const length = reader.int();
      const value: bigint[] = [];

      for (let i = 0; i < length; i++) value.push(reader.long());

      return { type: 'longArray', value };
    }
    default:
      throw new Error(`Unsupported NBT tag type: ${type}`);
  }
}

export function readNbt(buffer: Buffer): NbtRoot {
  const reader = new Reader(buffer);
  const type = reader.unsignedByte();

  if (type !== TAG.Compound) {
    throw new Error(`Expected a root TAG_Compound, got tag type ${type}.`);
  }

  const name = reader.string();
  const root = readPayload(reader, TAG.Compound);

  if (root.type !== 'compound') {
    throw new Error('Root tag did not decode to a compound.');
  }

  return { name, value: root.value };
}

// --------------------------------------------------------------------------- writing

class Writer {
  private chunks: Buffer[] = [];

  push(buffer: Buffer): void {
    this.chunks.push(buffer);
  }

  byte(value: number): void {
    const buffer = Buffer.alloc(1);
    buffer.writeInt8(value);
    this.push(buffer);
  }

  unsignedByte(value: number): void {
    const buffer = Buffer.alloc(1);
    buffer.writeUInt8(value);
    this.push(buffer);
  }

  short(value: number): void {
    const buffer = Buffer.alloc(2);
    buffer.writeInt16BE(value);
    this.push(buffer);
  }

  unsignedShort(value: number): void {
    const buffer = Buffer.alloc(2);
    buffer.writeUInt16BE(value);
    this.push(buffer);
  }

  int(value: number): void {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value);
    this.push(buffer);
  }

  long(value: bigint): void {
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(value);
    this.push(buffer);
  }

  float(value: number): void {
    const buffer = Buffer.alloc(4);
    buffer.writeFloatBE(value);
    this.push(buffer);
  }

  double(value: number): void {
    const buffer = Buffer.alloc(8);
    buffer.writeDoubleBE(value);
    this.push(buffer);
  }

  string(value: string): void {
    const encoded = encodeModifiedUtf8(value);

    if (encoded.length > 0xffff) {
      throw new Error('NBT string exceeds 65535 bytes.');
    }

    this.unsignedShort(encoded.length);
    this.push(encoded);
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

function writePayload(writer: Writer, tag: NbtTag): void {
  switch (tag.type) {
    case 'byte':
      writer.byte(tag.value);
      break;
    case 'short':
      writer.short(tag.value);
      break;
    case 'int':
      writer.int(tag.value);
      break;
    case 'long':
      writer.long(tag.value);
      break;
    case 'float':
      writer.float(tag.value);
      break;
    case 'double':
      writer.double(tag.value);
      break;
    case 'byteArray':
      writer.int(tag.value.length);
      writer.push(tag.value);
      break;
    case 'string':
      writer.string(tag.value);
      break;
    case 'list':
      writer.unsignedByte(tag.value.length === 0 ? TAG.End : tag.elementType);
      writer.int(tag.value.length);
      for (const element of tag.value) writePayload(writer, element);
      break;
    case 'compound':
      for (const [name, child] of Object.entries(tag.value)) {
        writer.unsignedByte(tagTypeId(child));
        writer.string(name);
        writePayload(writer, child);
      }
      writer.unsignedByte(TAG.End);
      break;
    case 'intArray':
      writer.int(tag.value.length);
      for (const value of tag.value) writer.int(value);
      break;
    case 'longArray':
      writer.int(tag.value.length);
      for (const value of tag.value) writer.long(value);
      break;
  }
}

function tagTypeId(tag: NbtTag): number {
  switch (tag.type) {
    case 'byte':
      return TAG.Byte;
    case 'short':
      return TAG.Short;
    case 'int':
      return TAG.Int;
    case 'long':
      return TAG.Long;
    case 'float':
      return TAG.Float;
    case 'double':
      return TAG.Double;
    case 'byteArray':
      return TAG.ByteArray;
    case 'string':
      return TAG.String;
    case 'list':
      return TAG.List;
    case 'compound':
      return TAG.Compound;
    case 'intArray':
      return TAG.IntArray;
    case 'longArray':
      return TAG.LongArray;
  }
}

export function writeNbt(root: NbtRoot): Buffer {
  const writer = new Writer();
  writer.unsignedByte(TAG.Compound);
  writer.string(root.name);
  writePayload(writer, { type: 'compound', value: root.value });

  return writer.finish();
}

// ------------------------------------------------------------------ modified UTF-8

function encodeModifiedUtf8(value: string): Buffer {
  const bytes: number[] = [];

  for (let i = 0; i < value.length; i++) {
    // Iterating by UTF-16 code unit is deliberate: modified UTF-8 encodes each half of
    // a surrogate pair separately as three bytes.
    const code = value.charCodeAt(i);

    if (code >= 0x0001 && code <= 0x007f) {
      bytes.push(code);
    } else if (code === 0x0000 || code <= 0x07ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }

  return Buffer.from(bytes);
}

function decodeModifiedUtf8(buffer: Buffer): string {
  let result = '';

  for (let i = 0; i < buffer.length; ) {
    const first = buffer[i]!;

    if ((first & 0x80) === 0) {
      result += String.fromCharCode(first);
      i += 1;
    } else if ((first & 0xe0) === 0xc0) {
      const second = buffer[i + 1]!;
      result += String.fromCharCode(((first & 0x1f) << 6) | (second & 0x3f));
      i += 2;
    } else {
      const second = buffer[i + 1]!;
      const third = buffer[i + 2]!;
      result += String.fromCharCode(((first & 0x0f) << 12) | ((second & 0x3f) << 6) | (third & 0x3f));
      i += 3;
    }
  }

  return result;
}
