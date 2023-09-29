export const Endian = {
  BIG   : false,
  LITTLE: true
};

export class BinWriter {
  endian = Endian.LITTLE;
  dview = new DataView(new ArrayBuffer(32));
  data = [];
  u8 = new Uint8Array(this.dview.buffer);

  constructor(data = []) {
    this.data = data;
  }

  #write(n) {
    for (let i = 0; i < n; i++) {
      this.data.push(this.u8[i]);
    }
  }

  char(s) {
    this.data.push(s.charCodeAt(0));
    return this;
  }

  /* Write a sequence of characters, is not null-terminated. */
  chars(s) {
    for (let i = 0; i < s.length; i++) {
      this.data.push(s.charCodeAt(i));
    }
    return this;
  }

  /* Write a null-terminated string. */
  string(s, width) {
    let slen = Math.min(s.length, width - 1);
    let wlen = width - slen;

    for (let i = 0; i < slen; i++) {
      this.data.push(s.charCodeAt(i));
    }
    for (let i = 0; i < wlen; i++) {
      this.data.push(0);
    }

    return this;
  }

  buffer(buf) {
    let u8 = new Uint8Array(buf);
    for (let i = 0; i < u8.length; i++) {
      this.data.push(u8[i]);
    }
    return this;
  }

  float32(f) {
    this.dview.setFloat32(0, f, this.endian);
    this.#write(4);
    return this;
  }

  float64(f) {
    this.dview.setFloat64(0, f, this.endian);
    this.#write(8);
    return this;
  }

  uint8(i) {
    this.dview.setUint8(0, i);
    this.#write(1);
    return this;
  }

  int8(i) {
    this.dview.setInt8(0, i);
    this.#write(1);
    return this;
  }

  uint16(i) {
    this.dview.setUint16(0, i, this.endian);
    this.#write(2);
    return this;
  }

  int16(i) {
    this.dview.setInt16(0, i, this.endian);
    this.#write(2);
    return this;
  }

  uint32(i) {
    this.dview.setUint32(0, i, this.endian);
    this.#write(4);
    return this;
  }

  int32(i) {
    this.dview.setInt32(0, i, this.endian);
    this.#write(4);
    return this;
  }

  uint64(i) {
    this.dview.setBigUint64(0, i, this.endian);
    this.#write(8);
    return this;
  }

  int64(i) {
    this.dview.setBigInt64(0, i, this.endian);
    this.#write(8);
    return this;
  }

  finish() {
    return new Uint8Array(this.data).buffer;
  }
}

export class BinReader {
  endian = Endian.LITTLE;
  dview = null;
  buffer = null;
  #i = 0;

  constructor(buffer) {
    let dview = buffer;

    if (dview instanceof ArrayBuffer) {
      dview = new DataView(dview);
    } else if (dview instanceof Uint8Array || dview instanceof Uint8ClampedArray) {
      dview = new DataView(dview.buffer);
    } else if (dview instanceof Array) {
      dview = new Uint8Array(dview);
      dview = new DataView(dview.buffer);
    }

    this.dview = dview;
    this.buffer = dview.buffer;
  }

  /* Advances i and returns old value. */
  #adv(n) {
    this.#i += n;
    return this.#i - n;
  }

  float32() {
    return this.dview.getFloat32(this.#adv(4), this.endian);
  }

  float64() {
    return this.dview.getFloat64(this.#adv(8), this.endian);
  }

  uint8() {
    return this.dview.getUint8(this.#adv(1));
  }

  int8() {
    return this.dview.getInt8(this.#adv(1));
  }

  uint16() {
    return this.dview.getUint16(this.#adv(2), this.endian);
  }

  int16() {
    return this.dview.getInt16(this.#adv(2), this.endian);
  }

  uint32() {
    return this.dview.getUint32(this.#adv(4), this.endian);
  }

  int32() {
    return this.dview.getInt32(this.#adv(4), this.endian);
  }

  uint64() {
    return this.dview.getBigUint64(this.#adv(8), this.endian);
  }

  int64() {
    return this.dview.getBigInt64(this.#adv(8), this.endian);
  }

  skip(n) {
    this.#adv(n);
    return this;
  }

  string(n) {
    let s = '';
    let ok = true;

    for (let i = 0; i < n; i++) {
      let c = this.uint8();

      if (c === 0) {
        ok = false;
      } else if (ok) {
        s += String.fromCharCode(c);
      }
    }

    return s;
  }

  bytes(n) {
    let i = this.#adv(n);
    return this.buffer.slice(i, i + n);
  }

  eof() {
    return this.#i >= this.buffer.byteLength;
  }
}
