"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");

/*
  Extracts the Dolby Vision RPU of a Profile 7 file, converted to Profile 8.1 (-m 2) so it can be
  injected into the base layer later, including after the base layer has been re-encoded.
  -m 2 only rewrites the RPU; the HDR10 fallback metadata lives in the base layer and is untouched.

  Single-track P7 (BL+EL in one track) carries the RPU in the working file's video stream.
  Dual-track P7 carries it in the EL track, which "Extract Streams DoVi" drops, so for those it is
  read from the original library file instead.
*/
var details = function () {
  return {
    name: 'Extract DoVi 7 (Dual > Single-Layer)',
    description: 'Extract Dolby Vision RPU data for Profile 7, converted to single-layer Profile 8.1',
    style: { borderColor: 'orange' },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.11.01',
    sidebarPosition: -1,
    icon: '',
    inputs: [],
    outputs: [
      {
        number: 1,
        tooltip: 'Continue to next plugin',
      },
    ],
  };
};
exports.details = details;

var shellQuote = function (str) { return "'" + String(str).replace(/'/g, "'\\''") + "'"; };

var countVideoStreams = function (fileObj) {
  var streams = (fileObj && fileObj.ffProbeData && fileObj.ffProbeData.streams) || [];
  return streams.filter(function (stream) {
    return stream.codec_type === 'video'
      && !(stream.disposition && Number(stream.disposition.attached_pic) === 1);
  }).length;
};

var plugin = async function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  var pluginWorkDir = args.workDir + "/dovi_tool";
  args.deps.fsextra.ensureDirSync(pluginWorkDir);

  // Must match the path the "Inject DoVi RPU 7" plugins read from
  var outputFilePath = pluginWorkDir + "/" + (0, fileUtils_1.getFileName)(args.originalLibraryFile._id) + ".rpu.bin";

  var dualTrack = countVideoStreams(args.originalLibraryFile) > 1;
  var sourceFile = dualTrack ? args.originalLibraryFile._id : args.inputFileObj._id;
  var sourceMap = dualTrack ? '0:v:1' : '0:v:0';
  args.jobLog("Extracting P7 RPU (" + (dualTrack ? 'dual-track, from EL of original file' : 'single-track') + ")");

  var shellCmd = "set -o pipefail; "
    + "ffmpeg -y -loglevel error -i " + shellQuote(sourceFile) + " "
    + "-map " + sourceMap + " -c:v copy -bsf:v hevc_mp4toannexb -f hevc - | "
    + "/usr/local/bin/dovi_tool -m 2 extract-rpu - -o " + shellQuote(outputFilePath);

  var cli = new cliUtils_1.CLI({
    cli: '/bin/bash',
    spawnArgs: ['-c', shellCmd],
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: outputFilePath,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
  });

  var res = await cli.runCli();
  if (res.cliExitCode !== 0) {
    args.jobLog('Extracting DoVi 7 RPU failed');
    throw new Error('dovi_tool failed');
  }

  // Lets the inject step tell whether the video stream was re-encoded in between
  args.variables.user = args.variables.user || {};
  args.variables.user.dovi_p7_rpu_source = args.inputFileObj._id;
  args.variables.user.dovi_p7_dual_track = String(dualTrack);

  args.logOutcome('tSuc');
  return {
    outputFileObj: args.inputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
exports.plugin = plugin;
