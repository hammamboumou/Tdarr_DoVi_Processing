"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;

var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");

/*
  We remove the forced "-m 2" for Profile 7 extraction,
  ensuring HDR10 fallback is retained.
  For all DV profiles (4,5,7,8), we now just do "extract-rpu" untouched.
*/

var details = function () {
  return {
    name: 'Extract DoVi RPU',
    description: 'Extract Dolby Vision RPU data (handles P4, P5, P8)',
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

// Copies an Annex B HEVC stream, keeping one Dolby Vision RPU NAL unit (type 62) per access unit: the first
// one after the frame's slices. RPUs before the first slice and further RPUs after the kept one are dropped.
// Some releases carry an extra copy per frame (in front of the slices or right after the frame's RPU), which
// makes dovi_tool discard one RPU per frame and panic on the last one ("Missing frame/slices for metadata!").
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
  var kept = null;
  var compare = function (a, b) {
    if (a.equals(b)) stats.identical += 1;
    else stats.different += 1;
  };

  var nalStart = function (buf, pos) { return (pos > 0 && buf[pos - 1] === 0) ? pos - 1 : pos; };
  // Adds buf[from, to) to keep unless it is a misplaced or extra RPU; the NAL's start code is at codePos
  var handleNal = function (buf, codePos, from, to, keep) {
    var type = (buf[codePos + 3] >> 1) & 0x3f;
    var firstSlice = type < 32 && codePos + 5 < to && (buf[codePos + 5] & 0x80) !== 0;
    if ((startsAccessUnit(type) || firstSlice) && seenVcl) {
      seenVcl = false;
      misplaced = null;
      kept = null;
    }
    if (type === 62) {
      var rpu = buf.subarray(codePos + 3, to);
      if (!seenVcl) {
        // In front of the frame's slices
        stats.dropped += 1;
        misplaced = Buffer.from(rpu);
        return;
      }
      if (kept) {
        // A second RPU after the frame's slices
        stats.dropped += 1;
        compare(kept, rpu);
        return;
      }
      kept = Buffer.from(rpu);
      if (misplaced) {
        compare(misplaced, rpu);
        misplaced = null;
      }
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

var extractRpu = function (args, inputPath, outputFilePath) {
  var cli = new cliUtils_1.CLI({
    cli: '/usr/local/bin/dovi_tool',
    spawnArgs: ['extract-rpu', inputPath, '-o', outputFilePath],
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: outputFilePath,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
  });
  return cli.runCli();
};

var plugin = async function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  var pluginWorkDir = args.workDir + "/dovi_tool";
  args.deps.fsextra.ensureDirSync(pluginWorkDir);

  var outputFilePath = pluginWorkDir + "/" + (0, fileUtils_1.getFileName)(args.originalLibraryFile._id) + ".rpu.bin";
  var inputPath = args.inputFileObj._id;
  var outputFileObj = args.inputFileObj;

  // Regardless of profile, we now do a raw "extract-rpu"
  // to ensure no fallback data is discarded
  var res = await extractRpu(args, inputPath, outputFilePath);

  if (res.cliExitCode !== 0 && (0, fileUtils_1.getContainer)(inputPath) === 'hevc') {
    args.jobLog('Extracting DoVi RPU failed, checking the stream for duplicate RPUs');
    var cleanedPath = (0, fileUtils_1.getPluginWorkDir)(args) + "/" + (0, fileUtils_1.getFileName)(inputPath) + ".hevc";
    var stats = await removeMisplacedRpus(inputPath, cleanedPath);
    args.jobLog("Duplicate RPUs removed: " + stats.dropped + " (identical to the frame's RPU: " + stats.identical
      + ", different: " + stats.different + ")");
    if (stats.dropped > 0) {
      res = await extractRpu(args, cleanedPath, outputFilePath);
      // Continue with the cleaned stream; the uncleaned copy is a Tdarr cache file and can go
      if (res.cliExitCode === 0) {
        if (inputPath.startsWith(args.workDir)) args.deps.fsextra.removeSync(inputPath);
        outputFileObj = { _id: cleanedPath };
      } else {
        args.deps.fsextra.removeSync(cleanedPath);
      }
    } else {
      args.deps.fsextra.removeSync(cleanedPath);
    }
  }

  if (res.cliExitCode !== 0) {
    args.jobLog('Extracting DoVi RPU failed');
    throw new Error('dovi_tool failed');
  }

  args.logOutcome('tSuc');
  return {
    outputFileObj: outputFileObj,
    outputNumber: 1,
    variables: args.variables,
  };
};
exports.plugin = plugin;
