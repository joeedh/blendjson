#!/usr/bin/env node

import './src/diffblend.js';
import {readBlendFile} from './src/diffblend.js';
import {configDef, config} from './src/config.js';

function main(args) {
  args = process.argv;
  args = args.slice(2, args.length);

  let nonflag_args = configDef.readArgs(args);
  configDef.writeConfig(config);
  console.log("\nconfig:", config, "\n");

  if (nonflag_args.length === 0) {
    console.log(configDef.printHelp());
    process.exit(-1);
  }

  let path1 = nonflag_args[0];
  let blend1 = readBlendFile(path1);

  if (config.print) {
    blend1.compressFile();
    blend1.printTree();
  }
}

main(process.arguments)


