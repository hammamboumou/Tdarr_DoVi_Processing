"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
var fileUtils_1 = require("../../../../FlowHelpers/1.0.0/fileUtils");
/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
/* eslint-disable no-param-reassign */
var details = function () { return ({
    name: 'ffmpeg - Remux DoVi MP4',
    description: "\n  If input is MP4, then the video stream from that with the audio streams from original file into mp4.\n  Otherwise the file is an MKV, remux that as is into MP4. TrueHD and DTS audio (not supported in mp4) is converted to E-AC3 or removed.\n  ",
    style: {
        borderColor: '#6efefc',
    },
    tags: 'video',
    isStartPlugin: false,
    pType: '',
    requiresVersion: '2.11.01',
    sidebarPosition: -1,
    icon: '',
    inputs: [
        {
            label: 'TrueHD / DTS audio',
            name: 'unsupported_audio',
            type: 'string',
            defaultValue: 'eac3',
            inputUI: {
                type: 'dropdown',
                options: [
                    'eac3',
                    'remove',
                ],
            },
            tooltip: 'eac3: convert TrueHD and DTS tracks to E-AC3 (640k, max 5.1). remove: drop them; the flow fails if that would leave no audio.',
        },
    ],
    outputs: [
        {
            number: 1,
            tooltip: 'Continue to next plugin',
        },
    ],
}); };
exports.details = details;

// Not well supported by ffmpeg in mp4. ffprobe reports DTS as 'dts' ('dca' is the decoder name)
var UNSUPPORTED_AUDIO = ['dts', 'dca', 'truehd'];

// ffmpeg's E-AC3 encoder supports at most 5.1
var eac3Args = function (spec, stream) {
    var outArgs = ['-c:' + spec, 'eac3', '-b:' + spec, stream.channels > 2 ? '640k' : '256k'];
    if (stream.channels > 6) {
        outArgs.push('-ac:' + spec, '6');
    }
    return outArgs;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
var plugin = function (args) {
    var _a, _b;
    var lib = require('../../../../../methods/lib')();
    args.inputs = lib.loadDefaultValues(args.inputs, details);
    var convertAudio = String(args.inputs.unsupported_audio) !== 'remove';
    var extension = (0, fileUtils_1.getContainer)(args.inputFileObj._id);
    var outputFileId = '';
    var inputArguments = [];
    var outputArguments = [
        '-dn',
        '-movflags', '+faststart',
        '-strict', 'unofficial',
    ];
    var audioCount = 0;
    if (extension === 'mkv') {
        // Only remux the file as it is
        args.variables.ffmpegCommand.streams.forEach(function (stream) {
            if (stream.codec_type === 'video') {
                return;
            }
            if (stream.codec_type !== 'audio') {
                stream.removed = true;
                return;
            }
            var unsupported = UNSUPPORTED_AUDIO.includes(stream.codec_name);
            if (unsupported && !convertAudio) {
                stream.removed = true;
                return;
            }
            audioCount += 1;
            if (unsupported) {
                stream.outputArgs.push.apply(stream.outputArgs, eac3Args('{outputIndex}', stream));
            }
            // The 'title' tag in the stream metadata is not recognized in mp4 containers
            // as a workaround setting the title in the 'handler_name' tag works
            if (stream.tags && stream.tags.title) {
                if (!unsupported) {
                    stream.outputArgs.push('-c:{outputIndex}', 'copy');
                }
                stream.outputArgs.push('-metadata:s:{outputIndex}', "handler_name=".concat(stream.tags.title));
            }
        });
        outputArguments.unshift.apply(outputArguments, [
            '-map_metadata', '0',
            '-map_metadata:c', '-1',
            '-bsf:v', 'hevc_mp4toannexb',
        ]);
        outputFileId = args.inputFileObj._id;
    }
    else {
        // Assemble the file from the previously packaged rpu.hevc.mp4 and the original file
        // Add the input file to the input arguments
        // This is needed because the output of this will be the original file
        // and tdarr will set that as the last input argument
        inputArguments = [
            '-i', args.inputFileObj._id,
        ];
        var mappingArguments = [];
        var codecArguments = ['-c:a', 'copy'];
        var metadataArguments = [];
        var originalStreams = (args.originalLibraryFile.ffProbeData && args.originalLibraryFile.ffProbeData.streams) || [];
        originalStreams.forEach(function (stream) {
            if (stream.codec_type !== 'audio') {
                return;
            }
            var unsupported = UNSUPPORTED_AUDIO.includes(stream.codec_name);
            if (unsupported && !convertAudio) {
                return;
            }
            mappingArguments.push('-map', "1:".concat(stream.index));
            if (unsupported) {
                codecArguments.push.apply(codecArguments, eac3Args("a:".concat(audioCount), stream));
            }
            // The 'title' tag in the stream metadata is not recognized in mp4 containers
            // as a workaround setting the title in the 'handler_name' tag works
            if (stream.tags && stream.tags.title) {
                metadataArguments.push("-metadata:s:a:".concat(audioCount), "handler_name=".concat(stream.tags.title));
            }
            audioCount += 1;
        });
        // Copy metadata, but leave out chapter names as that creates an additional data stream
        // in mp4 which I found to cause issues during playback in this case.
        // Reference: https://stackoverflow.com/a/60374650
        outputArguments.unshift.apply(outputArguments, mappingArguments.concat(codecArguments, [
            '-map_metadata', '1',
            '-map_metadata:c', '-1',
        ]));
        outputArguments.push.apply(outputArguments, metadataArguments);
        outputFileId = args.originalLibraryFile._id;
    }
    var originalHasAudio = ((args.originalLibraryFile.ffProbeData && args.originalLibraryFile.ffProbeData.streams) || [])
        .some(function (stream) { return stream.codec_type === 'audio'; });
    if (audioCount === 0 && originalHasAudio) {
        args.jobLog('All audio streams are TrueHD/DTS and set to be removed, refusing to create a file without audio');
        throw new Error('No audio streams left for mp4');
    }
    (_a = args.variables.ffmpegCommand.overallInputArguments).push.apply(_a, inputArguments);
    (_b = args.variables.ffmpegCommand.overallOuputArguments).push.apply(_b, outputArguments);
    return {
        outputFileObj: {
            _id: outputFileId,
        },
        outputNumber: 1,
        variables: args.variables,
    };
};
exports.plugin = plugin;
