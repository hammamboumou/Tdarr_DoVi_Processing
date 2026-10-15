"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");
var details = function () {
  return {
    name: 'Package HDR10+ mp4',
    description: 'Package the DoVi (Profile 8) or HDR10+->DoVi stream into MP4',
    style: {
      borderColor: 'orange',
    },
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

var isVideo = function (stream) {
  return stream.codec_type === 'video'
    && !(stream.disposition && Number(stream.disposition.attached_pic) === 1);
};

// The working file is a raw .hevc with no reliable frame rate metadata, so take it from the
// original file. Returns an exact fraction for MP4Box and a timescale that divides evenly by it.
var getFrameRate = function (args) {
  var streams = (args.originalLibraryFile.ffProbeData && args.originalLibraryFile.ffProbeData.streams) || [];
  var video = streams.find(isVideo);
  var rates = video ? [video.r_frame_rate, video.avg_frame_rate] : [];
  for (var i = 0; i < rates.length; i++) {
    var m = /^(\d+)\/(\d+)$/.exec(rates[i] || '');
    if (m && Number(m[1]) > 0 && Number(m[2]) > 0) {
      var num = Number(m[1]);
      var den = Number(m[2]);
      return { fps: num + "/" + den, timescale: den === 1 ? num * 1000 : num };
    }
  }
  args.jobLog('Could not read frame rate from original file, assuming 24000/1001');
  return { fps: '24000/1001', timescale: 24000 };
};

var plugin = async function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  var mp4WorkDir = args.workDir + "/dv_mp4";
  args.deps.fsextra.ensureDirSync(mp4WorkDir);
  var baseName = (0, fileUtils_1.getFileName)(args.originalLibraryFile._id);
  var outMP4Path = mp4WorkDir + "/" + baseName + "_DoVi.mp4";
  var tmpDir = mp4WorkDir + "/tmp";

  var rate = getFrameRate(args);
  args.jobLog("Packaging as DV profile 8.1 at " + rate.fps + " fps (timescale " + rate.timescale + ")");

  var cliArgs = [
    '-add', args.inputFileObj._id + ":fps=" + rate.fps + ":timescale=" + rate.timescale + ":dvp=8.1:xps_inband",
    '-tmp', tmpDir,
    '-brand', 'mp42',
    '-ab', 'dby1',
    '-no-iod',
    '-new',
    outMP4Path,
  ];

  var cli = new cliUtils_1.CLI({
    cli: '/usr/local/bin/MP4Box',
    spawnArgs: cliArgs,
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: outMP4Path,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
  });

  var res = await cli.runCli();
  if (res.cliExitCode !== 0) {
    args.jobLog('Packaging into mp4 failed');
    throw new Error('MP4Box failed');
  }

  args.logOutcome('tSuc');
  return {
    outputFileObj: { _id: outMP4Path },
    outputNumber: 1,
    variables: args.variables,
  };
};
exports.plugin = plugin;
