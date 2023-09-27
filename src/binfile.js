export const Endian = {
  BIG   : false,
  LITTLE: true
};

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
