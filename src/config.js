import * as util from './util.js';

function debuglog() {
  //console.log(...arguments);
}

export const config = {};

export const validTypes = new Set([
  "bool", "path", "string", "int", "enum", "float", "none"
]);

export class ConfigParseError extends Error {}

export const typeDefaults = {
  bool  : false,
  path  : "",
  string: "",
  int   : 0,
  enum  : 0,
  float : 0.0,
  none  : undefined,
};

function checkType(type) {
  type = type.toLowerCase().trim();

  if (!validTypes.has(type)) {
    throw new Error("invalid type " + type);
  }

  return type;
}

function preStrip(s, c) {
  while (s.startsWith(c)) {
    s = s.slice(1, s.length);
  }

  return s;
}

export class ConfigItem {
  constructor(name, type, value, help, flag) {
    this.name = name;
    this.type = checkType(type);
    this.value = value;

    this.flags = {[flag]: undefined};

    this.help = help ? help : "";
    this.defaultValue = value;
  }
}

export class ConfigDef extends Map {
  constructor() {
    super();

    this.add("help", "none", undefined, "Print this help.");
  }

  getOption(flag) {
    for (let ci of this.values()) {
      if (flag in ci.flags) {
        return ci;
      }
    }
  }

  hasFlag(flag) {
    for (let ci of this.values()) {
      if (flag in ci.flags) {
        return true;
      }
    }

    return false;
  }

  /* If short is undefined it will be auto-generated,
   * if null it will be ignored.
   * Bools are tricky:
   *
   * --bool    : true
   * --no-bool : false
   * --bool=[true/false]
   * --bool [true/false]
   **/
  add(name, type, value, help, flag = undefined, short = undefined) {
    let had_flag = flag !== undefined;
    flag = flag ?? name.toLowerCase().replace(/[ \t]/g, "-");

    if (!flag.startsWith("-")) {
      flag = "--" + flag;
    }

    let ci = new ConfigItem(name, type, value, help, flag);

    if (type === "bool") {
      flag = preStrip(flag, "-");

      ci.flags["--" + flag] = true;
      ci.flags["--no-" + flag] = false;

      if (short) {
        ci.flags[short] = !value;
      }
    } else if (short) {
      ci.flags[short] = undefined;
    }

    if (short === undefined) {
      short = this.#makeShort(type, value, preStrip(flag, "-"));

      debuglog("short:", short, preStrip(flag, "-"));
      if (type === "bool") {
        const short2 = this.#makeShort(type, !value, flag);

        ci.flags[short] = !value;
        ci.flags[short2] = value;
      } else {
        ci.flags[short] = undefined;
      }
    }

    this.set(name, ci);
  }

  #makeShort(type, value, flag) {
    function make(f) {
      /*
       * Remember that bool short flags invert
       * the default value.
       */
      if (type === "bool" && value) {
        f = "n" + f;
      }

      return "-" + f;
    }

    let short = make(flag[0]);

    if (this.hasFlag(short)) {
      for (let i = 2; i <= 5; i++) {
        if (flag.length < i) {
          break;
        }

        short = make(flag.slice(0, i));
        if (!this.hasFlag(short)) {
          break;
        }
      }
    }

    if (this.hasFlag(short)) {
      let rand = new util.MersenneRandom(this.size());
      let ri = 'a'.charCodeAt(0) + ~~(rand.random()*27);

      short += String.fromCharCode(ri);
    }

    return short;
  }

  /**
   * from({
   *   option : ["bool", false, long-flag, short-flag]
   * })
   */
  from(obj) {
    for (let k in obj) {
      let v = [k, ...obj[k]];

      if (v.length < 2) {
        v.append("bool");
      }

      v[1] = checkType(v[1]);

      if (v.length < 3) {
        v.append(typeDefaults[v[1]]);
      }

      this.add(...v);
    }

    return this;
  }

  readArgs(args) {
    let standalone = [];

    for (let arg of args) {
      if (arg === "--help" || arg === "-h") {
        console.log(this.printHelp());
        process.exit(0);
      }
    }

    let cur = 0;
    let hasArg = () => cur < args.length;
    let readArg = () => {
      cur++;
      return args[cur - 1];
    };
    let skipArg = () => cur++;
    let peekArg = () => {
      if (!hasArg) {
        return "";
      }

      return args[cur];
    };

    let validBools = {
      "true" : true,
      "false": false,
      "1"    : true,
      "0"    : false,
      "on"   : true,
      "off"  : false,
      "yes"  : true,
      "no"   : false
    };

    let isBool = (s) => {
      s = s.trim().toLowerCase();
      return s in validBools;
    }
    let parseBool = (s) => {
      let s2 = s.trim().toLowerCase();
      if (!(s2 in validBools)) {
        throw new ConfigParseError("Invalid boolean value " + s2);
      }

      return validBools[s2];
    };
    let readBool = () => {
      return parseBool(readArg());
    };

    let readFlag = (arg) => {
      let flag, value;
      let has_value = false;

      if (arg.search("=") >= 0) {
        arg = arg.split("=");

        value = arg[1].trim();
        flag = arg[0].trim();
        has_value = true;
      } else {
        flag = arg;
      }

      if (!this.hasFlag(flag)) {
        return false;
      }

      let ci = this.getOption(flag);

      if (value !== undefined) {
        if (ci.type === "bool") {
          value = parseBool(value);
        }
      }

      debuglog("Reading flag " + flag);

      if (ci.type === "bool" && hasArg() && isBool(peekArg())) {
        value = readBool();
      }

      if (peekArg() === "=") {
        skipArg();

        if (!hasArg()) {
          throw new ConfigParseError("Expected a value after \"=\"");
        }

        value = readArg();
        if (ci.type === "bool") {
          value = parseBool(value);
        }
      }

      if (ci.type === "bool") {
        if (value !== undefined) {
          let v = ci.flags[flag];

          if (!v) {
            debuglog("bool flag", v)
            value = Boolean(value ^ true);
          }
        } else {
          value = ci.flags[flag];
        }
      }

      debuglog("value:", value);
      debuglog("\n");

      ci.value = value;

      return true;
    }

    while (cur < args.length) {
      let arg = readArg();

      if (readFlag(arg)) {
        continue;
      }

      if (arg.startsWith("-")) {
        throw new Error("invalid argument " + arg);
      } else {
        standalone.push(arg);
      }
    }

    debuglog("standalone:", standalone);
    return standalone;
  }

  writeConfig(dest) {
    for (let k of this.keys()) {
      if (k === 'help') {
        continue;
      }

      dest[k] = this.get(k).value;
    }

    debuglog(dest);
    return this;
  }

  printHelp() {
    let s = 'Usage: node diffblend.js [options] path1 path2\n';
    let options = [];
    let maxcol = 0;
    let indent = 4;

    for (let [k, v] of this) {
      console.log(v)
      let a = [];

      for (let k in v.flags) {
        let value = v.flags[k];
        let flag = k;

        if (v.type === "bool") {
          if (k.startsWith("--") && !k.startsWith("--no-")) {
            flag += "=(optional true/false\n";
            //k += util.indent(2);
            flag += util.indent(1 + k.length) + "defaults to true)";
          } else {
            flag += ` (always ${value})`;
          }
        } else if (v.type !== "none") {
          flag += ` = (${v.type})`;
        }

        a = a.concat(flag.split("\n"));
      }

      /* Deliberately make undefined v.help print "undefined" to
       * more easily spot unhelped options.
       */
      let help = "" + v.help;

      let b = help.split("\n");

      options.push([a, b]);

      for (let line of a) {
        maxcol = Math.max(maxcol, line.length);
      }
    }

    maxcol += indent + 2;

    for (let [flags, help] of options) {
      let maxlines = Math.max(flags.length, help.length);
      for (let i = 0; i < maxlines; i++) {
        let line = '';

        if (i < flags.length) {
          if (i > 0) {
            line += " ";
          }
          line += util.indent(indent) + flags[i];
        }

        while (line.length < maxcol) {
          line += " ";
        }

        if (i === 0) {
          line += ": ";
        } else {
          line += "  ";
        }

        if (i < help.length) {
          line += help[i];
        }

        s += line + "\n";
      }
    }

    return s;
  }
}

export const configDef = new ConfigDef().from({
  "print": ["bool", false, "Prints file tree"]
});
