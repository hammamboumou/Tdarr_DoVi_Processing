"use strict";
/* eslint no-plusplus: ["error", { "allowForLoopAfterthoughts": true }] */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plugin = exports.details = void 0;
/* eslint-disable no-param-reassign */

const details = () => ({
    name: 'ffmpeg - Extract Streams DoVI',
    description: "Extract raw HEVC and subtitle streams from file. Text subtitles are written next to the original file as "
        + ".srt (and PGS as .sup if enabled), named after the original file so media servers pick them up.",
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
            label: 'Subtitle languages',
            name: 'subtitle_languages',
            type: 'string',
            defaultValue: 'eng,en',
            inputUI: {
                type: 'text',
            },
            tooltip: 'Specify subtitle languages to keep using a comma-separated list e.g., eng.',
        },
        {
            label: 'Extract PGS subtitles',
            name: 'extract_image_subtitles',
            type: 'boolean',
            defaultValue: true,
            inputUI: {
                type: 'switch',
            },
            tooltip: 'PGS (image) subtitles cannot go in mp4 or be converted to srt. If enabled they are kept as .sup sidecar files.',
        },
    ],
    outputs: [
        {
            number: 1,
            tooltip: 'Continue to next plugin',
        },
    ],
});
exports.details = details;

// Text subtitle codecs ffmpeg can convert to srt
const TEXT_SUBTITLES = ['subrip', 'srt', 'ass', 'ssa', 'mov_text', 'webvtt', 'text'];
const IMAGE_SUBTITLES = ['hdmv_pgs_subtitle'];

const isFlagged = (stream, disposition, titlePattern) => Number(stream.disposition?.[disposition]) === 1
    || titlePattern.test(stream.tags?.title || '');

var plugin = function (args) {
    const path = require('path');
    const fs = require('fs');
    const lib = require('../../../../../methods/lib')();
    args.inputs = lib.loadDefaultValues(args.inputs, details);

    const subtitleLanguages = String(args.inputs.subtitle_languages)
        .split(',')
        .map((lang) => lang.trim().toLowerCase())
        .filter((lang) => lang !== '');
    const extractImageSubs = args.inputs.extract_image_subtitles === true
        || args.inputs.extract_image_subtitles === 'true';
    args.variables.ffmpegCommand.container = 'hevc';
    args.variables.ffmpegCommand.shouldProcess = true;

    // Sidecars use the original file name (with year) so they match the final .mp4 after "Replace Original File"
    const originalDir = path.dirname(args.originalLibraryFile._id);
    const originalBaseName = path.parse(args.originalLibraryFile._id).name;

    // Each subtitle is written to its own output file, so its output arguments must come before the
    // video's, which go to the main .hevc output that Tdarr appends last.
    const streams = args.variables.ffmpegCommand.streams;
    streams.sort((a, b) => (a.codec_type === 'video') - (b.codec_type === 'video'));

    const usedPaths = new Set();
    let videoKept = false;
    streams.forEach((stream) => {
        if (stream.codec_type === 'subtitle') {
            const lang = String(stream.tags?.language || 'und').toLowerCase();
            const codec = String(stream.codec_name || '').toLowerCase();
            const isText = TEXT_SUBTITLES.includes(codec);
            const isImage = extractImageSubs && IMAGE_SUBTITLES.includes(codec);

            if (!subtitleLanguages.includes(lang) || (!isText && !isImage)) {
                stream.removed = true;
                return;
            }

            const flags = (isFlagged(stream, 'forced', /forced/i) ? '.forced' : '')
                + (isFlagged(stream, 'hearing_impaired', /\bsdh\b/i) ? '.sdh' : '');
            const subtitlePath = path.join(originalDir, `${originalBaseName}.${lang}${flags}.${isText ? 'srt' : 'sup'}`);

            if (usedPaths.has(subtitlePath)) {
                args.jobLog(`Skipping subtitle stream ${stream.index}: ${path.basename(subtitlePath)} already extracted from another stream`);
                stream.removed = true;
                return;
            }
            usedPaths.add(subtitlePath);

            // Never overwrite a sidecar that is already in the library (e.g. a hand-picked .srt)
            if (fs.existsSync(subtitlePath)) {
                args.jobLog(`Skipping subtitle stream ${stream.index}: ${path.basename(subtitlePath)} already exists`);
                stream.removed = true;
                return;
            }

            stream.outputArgs.push('-c:s', isText ? 'srt' : 'copy');
            stream.outputArgs.push(subtitlePath);
        } else if (stream.codec_type === 'video' && !videoKept) {
            // Only the first video stream fits in a raw .hevc. For dual-track P7 the EL is read
            // from the original file by "Extract DoVi 7 RPU".
            videoKept = true;
            stream.outputArgs.push('-c:v');
            stream.outputArgs.push('copy');
            stream.outputArgs.push('-bsf:v');
            stream.outputArgs.push('hevc_mp4toannexb');
        } else {
            stream.removed = true;
        }
    });

    return {
        outputFileObj: args.inputFileObj,
        outputNumber: 1,
        variables: args.variables,
    };
};

exports.plugin = plugin;
