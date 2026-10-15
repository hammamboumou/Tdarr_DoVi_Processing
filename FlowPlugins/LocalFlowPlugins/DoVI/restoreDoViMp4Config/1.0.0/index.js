"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");

/*
  Run after "Execute DoVi Remux". ffmpeg 7.1 (the Jellyfin build Tdarr uses with ffmpegVersion=7) drops the
  Dolby Vision configuration record (dvcC) when stream-copying the packaged mp4, even with -strict unofficial.
  The RPUs stay in the video stream, but without the record players don't detect Dolby Vision.
  This re-imports the file with MP4Box and sets the record again. Audio tracks, languages and handler names are
  kept; file-level tags (e.g. title) are not.
*/
var details = function () {
  return {
    name: 'Restore DoVi MP4 Config',
    description: 'Re-adds the Dolby Vision configuration record dropped by the ffmpeg remux (P5 stays P5, others as P8.1)',
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

var getDoViProfile = function (fileObj) {
  var streams = (fileObj && fileObj.ffProbeData && fileObj.ffProbeData.streams) || [];
  for (var i = 0; i < streams.length; i++) {
    var sideData = streams[i].side_data_list || [];
    for (var j = 0; j < sideData.length; j++) {
      if (sideData[j].dv_profile !== undefined) return Number(sideData[j].dv_profile);
    }
  }
  var tracks = (fileObj && fileObj.mediaInfo && fileObj.mediaInfo.track) || [];
  for (var k = 0; k < tracks.length; k++) {
    var m = /dvhe\.0(\d)/.exec(tracks[k].HDR_Format_Profile || '');
    if (m) return Number(m[1]);
  }
  return 0;
};

var plugin = async function (args) {
  var lib = require('../../../../../methods/lib')();
  args.inputs = lib.loadDefaultValues(args.inputs, details);

  var inputProfile = getDoViProfile(args.inputFileObj);
  if (inputProfile) {
    args.jobLog("File already has a Dolby Vision configuration record (profile " + inputProfile + "), nothing to do");
    return {
      outputFileObj: args.inputFileObj,
      outputNumber: 1,
      variables: args.variables,
    };
  }

  var pluginWorkDir = (0, fileUtils_1.getPluginWorkDir)(args);
  var outputFilePath = pluginWorkDir + "/" + (0, fileUtils_1.getFileName)(args.originalLibraryFile._id) + ".mp4";
  var dvp = getDoViProfile(args.originalLibraryFile) === 5 ? '5' : '8.1';
  args.jobLog("Restoring Dolby Vision configuration record as profile " + dvp);

  var cli = new cliUtils_1.CLI({
    cli: '/usr/local/bin/MP4Box',
    spawnArgs: [
      '-add', args.inputFileObj._id + ":dvp=" + dvp,
      '-brand', 'mp42isom',
      '-ab', 'dby1',
      '-tmp', pluginWorkDir,
      '-new', outputFilePath,
    ],
    spawnOpts: {},
    jobLog: args.jobLog,
    outputFilePath: outputFilePath,
    inputFileObj: args.inputFileObj,
    logFullCliOutput: args.logFullCliOutput,
    updateWorker: args.updateWorker,
  });

  var res = await cli.runCli();
  if (res.cliExitCode !== 0) {
    args.jobLog('Restoring Dolby Vision configuration failed');
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
