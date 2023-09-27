import './polyfill.js';

export class cachering extends Array {
  #cur = 0;

  constructor(func, count) {
    super();

    for (let i = 0; i < count; i++) {
      this.push(func());
    }
  }

  next() {
    const ret = this[this.#cur];

    this.#cur = (this.#cur + 1) % this.length;

    return ret;
  }

  static fromConstructor(cls, count) {
    return new this(() => new cls(), count);
  }
}

export class IDGen {
  cur = 1;

  next() {
    return this.cur++;
  }

  toJSON() {
    return this;
  }

  loadJSON(obj) {
    this.cur = obj.cur;
  }
}

export function list(iter) {
  const ret = [];

  for (let item of iter) {
    ret.push(item);
  }

  return ret;
}

export function indent(n, c=" ") {
  let s = '';
  for (let i=0; i<n; i++) {
    s += c;
  }

  return s;
}

//from:https://en.wikipedia.org/wiki/Mersenne_Twister
function _int32(x) {
  // Get the 31 least significant bits.
  return ~~(((1<<30) - 1) & (~~x))
}

export class MersenneRandom {
  constructor(seed) {
    // Initialize the index to 0
    this.index = 624;
    this.mt = new Uint32Array(624);

    this.seed(seed);
  }

  random() {
    return this.extract_number()/(1<<30);
  }

  /** normal-ish distribution */
  nrandom(n=3) {
    let ret = 0.0;

    for (let i=0; i<n; i++) {
      ret += this.random();
    }

    return ret / n;
  }

  seed(seed) {
    seed = ~~(seed*8192);

    // Initialize the index to 0
    this.index = 624;
    this.mt.fill(0, 0, this.mt.length);

    this.mt[0] = seed;  // Initialize the initial state to the seed

    for (let i = 1; i < 624; i++) {
      this.mt[i] = _int32(
        1812433253*(this.mt[i - 1] ^ this.mt[i - 1]>>30) + i);
    }
  }

  extract_number() {
    if (this.index >= 624)
      this.twist();

    let y = this.mt[this.index];

    // Right shift by 11 bits
    y = y ^ y>>11;
    // Shift y left by 7 and take the bitwise and of 2636928640
    y = y ^ y<<7 & 2636928640;
    // Shift y left by 15 and take the bitwise and of y and 4022730752
    y = y ^ y<<15 & 4022730752;
    // Right shift by 18 bits
    y = y ^ y>>18;

    this.index = this.index + 1;

    return _int32(y);
  }

  twist() {
    for (let i = 0; i < 624; i++) {
      // Get the most significant bit and add it to the less significant
      // bits of the next number
      let y = _int32((this.mt[i] & 0x80000000) +
        (this.mt[(i + 1)%624] & 0x7fffffff));
      this.mt[i] = this.mt[(i + 397)%624] ^ y>>1;

      if (y%2 !== 0)
        this.mt[i] = this.mt[i] ^ 0x9908b0df;
    }

    this.index = 0;
  }
}

let _mt = new MersenneRandom(0);

export function random() {
  return _mt.extract_number()/(1<<30);
}

export function seed(n) {
//  console.trace("seed called");
  _mt.seed(n);
}

