# Tdarr_DoVi_Processing

A set of Tdarr plugins that can handle Dolby Vision videos in **Profiles 4, 5, 7, 8**, and **HDR10+**, remuxing them into MP4 files compatible with LG TVs (and other devices). This project originated from andrasmaroy’s [Tdarr_Plugins_DoVi](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi), then expanded to include additional functionality for Profile 7 and HDR10+ with the help of ChatGPT.

---

## Overview

Many LG OLED owners (and other users) encounter problems with certain Dolby Vision (DoVi) profiles, missing HDR10 fallback, or device crashes (e.g., the Nvidia Shield showing a green or purple screen). 

- **Goal**: Preserve Dolby Vision whenever possible while ensuring the file remains playable on LG TVs and other devices.  
- **Main Approach**:  
  - Filter or identify DV files (Profiles 4, 5, 7, 8) and HDR10+ content.  
  - If DV Profile 7 lacks HDR10 fallback metadata, optionally convert it from dual-layer to single-layer (Profile 8.1).  
  - Repack or transcode as needed, then remux into MP4 with correct DoVi flags.

This README explains how the **Extract → Inject → Package** (or skip steps if not needed) pipeline works, which ensures safer playback on LG TVs and the Nvidia Shield.

---

## Key Features

1. **Handles DV Profiles 4/5/7/8 & HDR10+.**  
2. **Optional fallback detection** (checks if ST 2086 / MaxCLL / Master Display info is present).  
3. **Profile 7** can remain dual-layer or be converted to single-layer if fallback is missing.  
4. **HDR10+** → DV Profile 8 conversion using `hdr10plus_tool`.  
5. **SRT Subtitle extraction** and re-injection if desired.  
6. **Can re-encode the base HEVC** or do simple pass-through.

---

## Plugin Flow (High-Level)

1. **Check HDR type**  
   - Identifies if file is DV, HDR10+, or SDR.  
2. **Check DoVi Profile**  
   - Determines Profile 4, 5, 7, or 8.  
3. **Check for HDR10 fallback**  
   - Looks for Mastering Display / ST 2086 / CLL. If missing, flags it.  
4. **Extract / Reorder streams**  
   - Plugin to reorder audio/subtitle streams or extract raw HEVC if needed.  
5. **Process**  
   - **Profile 4/5/8**: Typically just extract RPU and inject back, then package as DV Profile 8 MP4.  
   - **Profile 7 (dual-layer)**: Keep both layers or discard the EL if fallback is missing → single-layer Profile 8.  
   - **HDR10+**: Extract HDR10+ metadata to JSON, convert to DV Profile 8.  
6. **Inject**  
   - Re-inject the RPU or newly created DV metadata.  
7. **Package**  
   - Use MP4Box to add the DV container flags (`:dvp=8.1`, or `:dvp=5` for Profile 5). The frame rate is taken from the original file.  
8. **Remux**  
   - Final step merges the original audio streams back into an MP4 container. Subtitles are kept as sidecar files.  
   - **Restore DoVi MP4 Config** then re-adds the Dolby Vision configuration record, which ffmpeg 7.1 drops during the remux.

---

## Detailed Plugins

Below is a quick summary of each plugin used in the flow. Many are adapted from [andrasmaroy/Tdarr_Plugins_DoVi](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi) with modifications:

1. **Check HDR Type**  
   - Determines if the file is Dolby Vision, HDR10+, HDR10, or SDR by scanning MediaInfo.  
   - Adjusted to handle SMPTE ST 2094 (HDR10+) properly.

2. **Check DoVi Profile**  
   - Inspects Dolby Vision to see if it’s Profile 4, 5, 7, or 8.  
   - Unmodified from the original version.

3. **Check HDR10 Fallback Metadata**  
   - Detects missing fallback (e.g., `cll=0,0` or no mention of ST 2086 / Master Display).  
   - Flags if fallback is absent.

4. **ffmpeg - Reorder Streams DoVi**  
   - Reorders audio/subtitle/video streams so the video stream is last.  
   - Helps certain DoVi injection steps that rely on a fixed stream order.

5. **ffmpeg - Extract Streams DoVi**  
   - Extracts the first video stream as raw HEVC. Audio and other tracks are dropped (audio is taken from the original file when remuxing).  
   - Text subtitles (SRT, ASS, mov_text, WebVTT) are written next to the original file as `<original name>.<lang>[.forced][.sdh].srt`; PGS subtitles as `.sup` (can be disabled). A second track with the same name is skipped.  
   - You can specify which subtitle languages to keep (default: English).

6. **Extract DoVi RPU / Inject DoVi RPU / Package DoVi MP4**  
   - For **Profiles 4/5/8**: No forced `-m 2` usage. Metadata is kept intact. Profile 5 is packaged as `dvp=5`, the others as `dvp=8.1`.  
   - For **Profile 7** (output is always single-layer Profile 8.1, the EL is discarded):
     - **Extract DoVi 7 RPU** extracts the RPU converted to Profile 8.1 (`-m 2`). For dual-track sources it is read from the EL track of the original file.  
     - **Inject DoVi RPU 7** converts the stream in place (`convert --discard`) if it is unchanged since extraction, or injects the extracted RPU if the HEVC was re-encoded in between.  
     - **Package DoVi 7 mp4** uses MP4Box with `:dvp=8.1`.  
     - The `(Dual > Single-Layer)` variants behave the same and are kept so existing flows keep working.  
   - If `dovi_tool extract-rpu` fails, the Extract plugins check the raw HEVC for a second RPU per frame, either in front of the frame's slices or right after its RPU (seen in some releases; dovi_tool then logs `Unexpected RPU NALU found for frame N. Discarding.` for every frame and ends with `Missing frame/slices for metadata!`). Only the first RPU after each frame's slices is kept, extraction is retried and the flow continues with the cleaned stream.

7. **Processing HDR10+**  
   - **Extract HDR10+ Metadata** → .json using `hdr10plus_tool`.  
   - **Inject HDR10+ as DoVi P8** → Convert it to DV. The RPU's L6 metadata (mastering luminance, MaxCLL, MaxFALL) is taken from the original file.  
   - **Package** the new DV (Profile 8) track in MP4.

8. **Remux DoVi MP4**  
   - If input is MP4, merges the original file's audio streams with the new DV video. If MKV, re-mux to MP4.  
   - TrueHD and DTS audio is converted to E-AC3 (640k, max 5.1) by default, or removed if set to `remove`. The flow fails rather than produce a file without audio.

9. **Restore DoVi MP4 Config**  
   - Place it right after the Execute step of **Remux DoVi MP4**.  
   - ffmpeg 7.1 (used by Tdarr with `ffmpegVersion=7`) drops the Dolby Vision configuration record (`dvcC`) when remuxing, even with `-strict unofficial`. The RPU data stays in the stream, but players no longer detect Dolby Vision.  
   - Re-imports the file with MP4Box and sets the record again (`dvp=5` for Profile 5, `dvp=8.1` otherwise). Audio tracks, languages and track titles are kept; file-level tags such as the title are not.  
   - Does nothing if the file still has the record.

---

## Common Flows

**Short version**:  
[Input File] → [Extract raw HEVC stream] → [Extract Dolby Vision RPU] → [Optional re-encode HEVC / keep fallback if needed] → [Inject DV RPU] → [Package into MP4 with DV Profile 8.1] → [Remux with original audio/subtitles]


- *Note*: If you do re-encode, add it between the Extract and Inject steps, and keep the colour tags (`-color_primaries bt2020 -color_trc smpte2084 -colorspace bt2020nc`). `-metadata "cll=..."` has no effect on a raw `.hevc` stream; check with MediaInfo that the encoder kept the mastering display / MaxCLL metadata.

---

## Docker Image / Environment

Because we need `dovi_tool`, `hdr10plus_tool`, and `MP4Box`, a **custom Docker image** is needed:

- **Docker Hub**: [`nichols89ben/dovi-tdarr-node:latest`](https://hub.docker.com/r/nichols89ben/dovi-tdarr-node)  
- This image aligns with the current Tdarr version and includes the required tools.  
- If you’re running locally, you can install these tools yourself, but it’s untested here.

### Example Docker Compose
**- Included in this repo**

### Installing Plugins

1. Clone or download this repository.
2. Copy the `DoVi` folder into your local Flow Plugins directory:

**/path/to/server/Tdarr/Plugins/FlowPlugins/LocalFlowPlugins/DoVi**

3. **Important**: Do not place them in the “community” folder, as updates may overwrite them.

---

### Tdarr Flow JSON

- A sample **Flow JSON** is included in this repository.
- To import it into Tdarr:
1. Go to “Flow” → “Import Flow.”
2. Paste the JSON file provided, which includes the chain of plugins as described above.

---

### Notes & Tips

- **Important for Non-Tdarr Pro Users**  
  The `Requeue` and `Node Tags` features are Pro-only. However, DoVi plugins require the correct DoVi version to function properly. Without Pro, here's what you can do:

  1. In your `docker-compose` file, disable the internal node:
     ```yaml
     - internalNode=false
     - inContainer=false
     ```
  2. Run separate nodes alongside the server using the custom image:
     ```yaml
     tdarr_DoVi-node:
       image: nichols89ben/dovi-tdarr-node:0.00.00 #Version number
       container_name: tdarr_DoVi-node
     ```
     You can add more nodes if needed:
     ```yaml
     tdarr_DoVi-node2:
       image: nichols89ben/dovi-tdarr-node:0.00.00 #Version number
       container_name: tdarr_DoVi-node2
     ```
  3. Remove or disable the `Requeue for DoVi Node` step in the flow.

  For more details, see the [Tdarr Docker Compose Docs](https://docs.tdarr.io/docs/installation/docker/run-compose#compose).
  <br>
- **Requeue to a DoVi Node**  
  Ensure your node is tagged (e.g., `DoVi_Yeezy`) to use the correct environment. Configure it under:  

  **Custom Node > Options > Node Tags > DoVi_Yeezy**  

  Adjust tag names as needed for your specific setup or hardware (CPU/GPU).  
  <br>
- **Make This the Last Flow**  
Further processing on the MP4 file may overwrite/corrupt the DoVi metadata. Best to use this flow at the end of your pipeline.
  <br>
- **Replacing the Original File**  
Certain steps reference the original file for final packaging. If you’ve done prior processing, be sure to replace the original so it doesn’t revert your changes.

---

## References

- [**Tdarr_Plugins_DoVi** (original)](https://github.com/andrasmaroy/Tdarr_Plugins_DoVi)  
- [**dvmkv2mp4**](https://github.com/gacopl/dvmkv2mp4)  
- [**dovi_tool**](https://github.com/quietvoid/dovi_tool)  
- [**MP4Box** GPAC Wiki](https://wiki.gpac.io/MP4Box/MP4Box/)  
- [**hdr10plus_tool**](https://github.com/quietvoid/hdr10plus_tool)
