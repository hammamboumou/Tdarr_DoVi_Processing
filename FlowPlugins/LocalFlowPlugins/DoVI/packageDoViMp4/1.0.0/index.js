"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");
/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
var details = function () {
  return {
    name: 'Package DoVi mp4',
    description: 'Package HEVC stream with injected DoVi RPU in mp4 (P5 stays P5, P4/P8 as P8.1; preserves frame rate)',
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

var getDoViProfile = function (fileObj) {
  var streams = (fileObj.ffProbeData && fileObj.ffProbeData.streams) || [];
  for (var i = 0; i < streams.length; i++) {
    var sideData = streams[i].side_data_list || [];
    for (var j = 0; j < sideData.length; j++) {
      if (sideData[j].dv_profile !== undefined) return Number(sideData[j].dv_profile);
    }
  }
  var tracks = (fileObj.mediaInfo && fileObj.mediaInfo.track) || [];
  for (var k = 0; k < tracks.length; k++) {
    var m = /dvhe\.0(\d)/.exec(tracks[k].HDR_Format_Profile || '');
    if (m) return Number(m[1]);
  }
  return 0;
};

var plugin = async function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  var pluginWorkDir = (0, fileUtils_1.getPluginWorkDir)(args);
  var outputFilePath = pluginWorkDir + "/" + (0, fileUtils_1.getFileName)(args.originalLibraryFile._id) + ".rpu.hevc.mp4";

  var rate = getFrameRate(args);
  // Profile 5 has no HDR10-compatible base layer, so it must not be flagged as 8.1
  var dvp = getDoViProfile(args.originalLibraryFile) === 5 ? '5' : '8.1';
  args.jobLog("Packaging as DV profile " + dvp + " at " + rate.fps + " fps (timescale " + rate.timescale + ")");

  var cliArgs = [
    '-add', args.inputFileObj._id + ":fps=" + rate.fps + ":timescale=" + rate.timescale + ":dvp=" + dvp + ":xps_inband",
    '-tmp', pluginWorkDir + "/tmp",
    '-brand', 'mp42isom',
    '-ab', 'dby1',
    '-no-iod',
    '-enable', '1',
    outputFilePath,
  ];

  var cli = new cliUtils_1.CLI({
    cli: '/usr/local/bin/MP4Box',
    spawnArgs: cliArgs,
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: outputFilePath,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
  });

  var res = await cli.runCli();
  if (res.cliExitCode !== 0) {
    args.jobLog('Packaging stream into mp4 failed');
    throw new Error('MP4Box failed');
  }

  args.logOutcome('tSuc');
  return {
    outputFileObj: { _id: outputFilePath },
    outputNumber: 1,
    variables: args.variables,
  };
};
exports.plugin = plugin;
