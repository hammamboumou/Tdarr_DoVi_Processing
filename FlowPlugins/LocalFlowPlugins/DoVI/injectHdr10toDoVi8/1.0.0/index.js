"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var cliUtils_1 = require("../../../../FlowHelpers/1.0.0/cliUtils");
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");
var details = function () { return ({
    name: 'Inject HDR10+ as DoVi P8',
    description: 'Generate Dolby Vision RPU from HDR10+ metadata and inject it',
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
}); };
exports.details = details;

var shellQuote = function (str) { return "'" + String(str).replace(/'/g, "'\\''") + "'"; };

// Reads the original file's HDR10 static metadata from MediaInfo for the RPU's L6 block,
// e.g. MaxCLL "1000 cd/m2", MasteringDisplay_Luminance "min: 0.0050 cd/m2, max: 1000 cd/m2".
// L6 min luminance is in units of 0.0001 cd/m2.
var getLevel6 = function (args) {
    var level6 = {
        max_display_mastering_luminance: 1000,
        min_display_mastering_luminance: 1,
        max_content_light_level: 1000,
        max_frame_average_light_level: 400,
    };
    var tracks = (args.originalLibraryFile.mediaInfo && args.originalLibraryFile.mediaInfo.track) || [];
    var video = tracks.find(function (t) { return t['@type'] && t['@type'].toLowerCase() === 'video'; });
    if (!video) return level6;
    var num = function (str) { var m = /([\d.]+)/.exec(str || ''); return m ? Number(m[1]) : NaN; };
    var maxCll = num(video.MaxCLL);
    var maxFall = num(video.MaxFALL);
    var lum = video.MasteringDisplay_Luminance || '';
    var minLum = num((/min:\s*([\d.]+)/.exec(lum) || [])[1]);
    var maxLum = num((/max:\s*([\d.]+)/.exec(lum) || [])[1]);
    if (maxCll > 0) level6.max_content_light_level = Math.round(maxCll);
    if (maxFall > 0) level6.max_frame_average_light_level = Math.round(maxFall);
    if (maxLum > 0) level6.max_display_mastering_luminance = Math.round(maxLum);
    if (minLum > 0) level6.min_display_mastering_luminance = Math.max(1, Math.round(minLum * 10000));
    return level6;
};

var runShell = async function (args, shellCmd, outputFilePath) {
    var cli = new cliUtils_1.CLI({
        cli: '/bin/sh',
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

var plugin = async function (args) {
    var lib = require('../../../../../methods/lib')();
    args.inputs = lib.loadDefaultValues(args.inputs, details);
    // The extracted HDR10+ metadata is in 'hdr10plus_tool' (written by "Extract HDR10+ Metadata"),
    // everything generated here goes into a separate injection folder
    var extractWorkDir = args.workDir + "/hdr10plus_tool";
    var injectWorkDir = args.workDir + "/hdr10plus_inject";
    args.deps.fsextra.ensureDirSync(injectWorkDir);
    var baseName = (0, fileUtils_1.getFileName)(args.originalLibraryFile._id);
    var metaFilePath = extractWorkDir + "/" + baseName + "_hdr10plus_metadata.json";
    var rpuBinPath = injectWorkDir + "/" + baseName + ".rpu.bin";
    var extraJsonPath = injectWorkDir + "/extra.json";
    var blHevcPath = injectWorkDir + "/" + baseName + "_BL.hevc";
    var outHevcPath = injectWorkDir + "/" + baseName + "_BL_RPU.hevc";

    var level6 = getLevel6(args);
    args.jobLog("RPU L6 metadata: " + JSON.stringify(level6));
    args.deps.fsextra.writeFileSync(extraJsonPath, JSON.stringify({
        cm_version: "V29",
        length: 100000,
        level6: level6,
    }, null, 2));

    // 1) Extract base layer to BL.hevc
    var res1 = await runShell(args, "ffmpeg -i " + shellQuote(args.inputFileObj._id)
        + " -y -loglevel error -stats -map 0:v:0 -c:v copy -bsf:v hevc_mp4toannexb -f hevc "
        + shellQuote(blHevcPath), blHevcPath);
    if (res1.cliExitCode !== 0) {
        args.jobLog('Failed creating BL.hevc');
        throw new Error('ffmpeg failed');
    }

    // 2) Generate RPU from HDR10+ JSON
    var res2 = await runShell(args, "/usr/local/bin/dovi_tool generate -j " + shellQuote(extraJsonPath)
        + " --hdr10plus-json " + shellQuote(metaFilePath)
        + " -o " + shellQuote(rpuBinPath), rpuBinPath);
    if (res2.cliExitCode !== 0) {
        args.jobLog('Failed generating RPU.bin');
        throw new Error('dovi_tool generate failed');
    }

    // 3) Inject RPU => DoVi P8
    var res3 = await runShell(args, "/usr/local/bin/dovi_tool inject-rpu -i " + shellQuote(blHevcPath)
        + " --rpu-in " + shellQuote(rpuBinPath)
        + " -o " + shellQuote(outHevcPath), outHevcPath);
    if (res3.cliExitCode !== 0) {
        args.jobLog('Failed injecting RPU');
        throw new Error('dovi_tool inject-rpu failed');
    }

    args.logOutcome('tSuc');
    return {
        outputFileObj: { _id: outHevcPath },
        outputNumber: 1,
        variables: args.variables,
    };
};
exports.plugin = plugin;
