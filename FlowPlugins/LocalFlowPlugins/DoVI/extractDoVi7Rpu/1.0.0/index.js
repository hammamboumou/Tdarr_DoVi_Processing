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
    name: 'Extract DoVi 7 RPU',
    description: 'Extract Dolby Vision RPU data for Profile 7, converted to Profile 8.1',
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

// Copies an Annex B HEVC stream, dropping Dolby Vision RPU NAL units (type 62) that come before the first
// slice of their access unit. An RPU belongs after the slices of its frame; some releases carry an extra copy
// in front, which makes dovi_tool discard one RPU per frame and panic on the last one
// ("Missing frame/slices for metadata!").
var removeMisplacedRpus = async function (inputPath, outputPath) {
  var fs = require('fs');
  var pipeline = require('stream').promises.pipeline;
  var START_CODE = Buffer.from([0, 0, 1]);
  // NAL types that start a new access unit after a picture (AUD, VPS, SPS, PPS, prefix SEI, reserved ranges)
  var startsAccessUnit = function (type) {
    return (type >= 32 && type <= 35) || type === 39 || (type >= 41 && type <= 44) || (type >= 48 && type <= 55);
  };
  var stats = { dropped: 0, identical: 0, different: 0 };
  var seenVcl = false;
  var misplaced = null;

  var nalStart = function (buf, pos) { return (pos > 0 && buf[pos - 1] === 0) ? pos - 1 : pos; };
  // Adds buf[from, to) to keep unless it is a misplaced RPU; the NAL's start code is at codePos
  var handleNal = function (buf, codePos, from, to, keep) {
    var type = (buf[codePos + 3] >> 1) & 0x3f;
    var firstSlice = type < 32 && codePos + 5 < to && (buf[codePos + 5] & 0x80) !== 0;
    if ((startsAccessUnit(type) || firstSlice) && seenVcl) {
      seenVcl = false;
      misplaced = null;
    }
    if (type === 62 && !seenVcl) {
      stats.dropped += 1;
      misplaced = Buffer.from(buf.subarray(codePos + 3, to));
      return;
    }
    if (type === 62 && misplaced) {
      if (misplaced.equals(buf.subarray(codePos + 3, to))) stats.identical += 1;
      else stats.different += 1;
      misplaced = null;
    }
    if (type < 32) seenVcl = true;
    keep.push(buf.subarray(from, to));
  };

  var filterNals = async function* (source) {
    var carry = Buffer.alloc(0);
    for await (var chunk of source) {
      var buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      var keep = [];
      var code = buf.indexOf(START_CODE);
      if (code === -1) { carry = buf; continue; }
      if (carry.length === 0 && nalStart(buf, code) > 0) keep.push(buf.subarray(0, nalStart(buf, code)));
      var next = buf.indexOf(START_CODE, code + 3);
      while (next !== -1) {
        handleNal(buf, code, nalStart(buf, code), nalStart(buf, next), keep);
        code = next;
        next = buf.indexOf(START_CODE, code + 3);
      }
      carry = buf.subarray(nalStart(buf, code));
      if (keep.length) yield Buffer.concat(keep);
    }
    if (carry.length) {
      var last = [];
      var lastCode = carry.indexOf(START_CODE);
      if (lastCode !== -1) handleNal(carry, lastCode, 0, carry.length, last);
      else last.push(carry);
      if (last.length) yield Buffer.concat(last);
    }
  };

  await pipeline(
    fs.createReadStream(inputPath, { highWaterMark: 16 * 1024 * 1024 }),
    filterNals,
    fs.createWriteStream(outputPath),
  );
  return stats;
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

  var extractRpu = function (file) {
    var shellCmd = "set -o pipefail; "
      + "ffmpeg -y -loglevel error -i " + shellQuote(file) + " "
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
    return cli.runCli();
  };

  var outputFileObj = args.inputFileObj;
  var res = await extractRpu(sourceFile);

  if (res.cliExitCode !== 0 && !dualTrack && (0, fileUtils_1.getContainer)(sourceFile) === 'hevc') {
    args.jobLog('Extracting DoVi 7 RPU failed, checking the stream for misplaced duplicate RPUs');
    var cleanedPath = (0, fileUtils_1.getPluginWorkDir)(args) + "/" + (0, fileUtils_1.getFileName)(sourceFile) + ".hevc";
    var stats = await removeMisplacedRpus(sourceFile, cleanedPath);
    args.jobLog("Misplaced RPUs removed: " + stats.dropped + " (identical to the frame's RPU: " + stats.identical
      + ", different: " + stats.different + ")");
    if (stats.dropped > 0) {
      res = await extractRpu(cleanedPath);
      // Continue with the cleaned stream; the uncleaned copy is a Tdarr cache file and can go
      if (res.cliExitCode === 0) {
        if (sourceFile.startsWith(args.workDir)) args.deps.fsextra.removeSync(sourceFile);
        outputFileObj = { _id: cleanedPath };
      } else {
        args.deps.fsextra.removeSync(cleanedPath);
      }
    } else {
      args.deps.fsextra.removeSync(cleanedPath);
    }
  }

  if (res.cliExitCode !== 0) {
    args.jobLog('Extracting DoVi 7 RPU failed');
    throw new Error('dovi_tool failed');
  }

  // Lets the inject step tell whether the video stream was re-encoded in between
  args.variables.user = args.variables.user || {};
  args.variables.user.dovi_p7_rpu_source = outputFileObj._id;
  args.variables.user.dovi_p7_dual_track = String(dualTrack);

  args.logOutcome('tSuc');
  return {
    outputFileObj: outputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
exports.plugin = plugin;
