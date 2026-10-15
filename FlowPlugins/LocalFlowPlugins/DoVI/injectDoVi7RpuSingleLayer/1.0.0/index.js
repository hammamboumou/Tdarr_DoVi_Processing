"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");

/*
  Produces a single-layer Profile 8.1 HEVC stream from a Profile 7 source.

  - Video stream untouched since "Extract DoVi 7 RPU" (single-track): it still holds the P7 RPU and
    the EL, so "dovi_tool -m 2 convert --discard" converts it in place.
  - Video stream re-encoded in between, or dual-track source: the stream has no RPU any more, so the
    P8.1 RPU extracted earlier is injected with "dovi_tool inject-rpu".
*/
var details = function () {
  return {
    name: 'Inject DoVi 7 (Dual > Single-Layer)',
    description: 'Converts Dolby Vision Profile 7 to single-layer Profile 8.1 (EL discarded)',
    style: { borderColor: 'orange' },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.11.01',
    sidebarPosition: -1,
    icon: '',
    inputs: [],
    outputs: [
      { number: 1, tooltip: 'Continue to next plugin' },
    ],
  };
};
exports.details = details;

var shellQuote = function (str) { return "'" + String(str).replace(/'/g, "'\\''") + "'"; };

var plugin = async function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  var pluginWorkDir = args.workDir + "/dovi_tool";
  args.deps.fsextra.ensureDirSync(pluginWorkDir);

  var inputFilePath = args.inputFileObj._id;
  var baseName = (0, fileUtils_1.getFileName)(args.originalLibraryFile._id);
  var rpuFilePath = pluginWorkDir + "/" + baseName + ".rpu.bin";
  var outFilePath = pluginWorkDir + "/" + baseName + "_rpu_injected.hevc";

  var user = args.variables.user || {};
  var rpuSource = user.dovi_p7_rpu_source;
  var convertInPlace = !rpuSource
    || (rpuSource === inputFilePath && user.dovi_p7_dual_track !== 'true');

  var cliString;
  if (convertInPlace) {
    args.jobLog('Video stream unchanged since RPU extraction: converting P7 to P8.1 in place');
    cliString = "/usr/local/bin/dovi_tool -m 2 convert --discard " + shellQuote(inputFilePath)
      + " -o " + shellQuote(outFilePath);
  } else {
    if (!args.deps.fsextra.existsSync(rpuFilePath)) {
      throw new Error("RPU file not found: " + rpuFilePath);
    }
    args.jobLog('Injecting extracted P8.1 RPU into base layer');
    cliString = "/usr/local/bin/dovi_tool inject-rpu -i " + shellQuote(inputFilePath)
      + " --rpu-in " + shellQuote(rpuFilePath)
      + " -o " + shellQuote(outFilePath);
  }

  var cli = new cliUtils_1.CLI({
    cli: '/bin/bash',
    spawnArgs: ['-c', cliString],
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: outFilePath,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
  });

  var res = await cli.runCli();
  if (res.cliExitCode !== 0) {
    args.jobLog('Injecting/Converting DoVi RPU failed');
    throw new Error('dovi_tool failed');
  }

  args.logOutcome('tSuc');
  return {
    outputFileObj: {
      _id: outFilePath,
    },
    outputNumber: 1,
    variables: args.variables,
  };
};
exports.plugin = plugin;
