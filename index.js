const fs = require('fs');
const path = require('path');
const args = require('yargs').argv;
const mimeTypes = require('mime-types');
const ptt = require("parse-torrent-title");
const which = require('which');
const ffmpeg = require('fluent-ffmpeg');
const filesize = require('filesize');
const cliProgress = require('cli-progress');
const util = require('util');

if (args.keepLogs) {
    const log_file = fs.createWriteStream(path.resolve('./debug.log'), {flags : 'w'});
    const log_stdout = process.stdout;

    console.log = function(d) { //
        log_file.write(util.format(d) + '\n');
        log_stdout.write(util.format(d) + '\n');
    };

    console.warn = function(d) { //
        log_file.write(util.format(d) + '\n');
        log_stdout.write(util.format(d) + '\n');
    };

    console.error = function(d) { //
        log_file.write(util.format(d) + '\n');
        log_stdout.write(util.format(d) + '\n');
    };
}

const binaries = {
    ffprobe: null,
    ffmpeg: null
}

const results = {
    files: [],
    folders: []
}

const cleanup = {
    oldFiles: [],
    oldBytes: 0,
    newBytes: 0
};


const handleClose = () => {
    if (args.cleanOld) {
        cleanup.oldFiles.map(file => {
            fs.unlinkSync(file);
        })
    }

    console.log(`done! library went from ${filesize(cleanup.oldBytes)} to ${filesize(cleanup.newBytes)}`);
}

const startVideoScrubbing = () => {
    const multibar = new cliProgress.MultiBar({
        clearOnComplete: false,
        hideCursor: true
    
    }, cliProgress.Presets.legacy);
    

    let finishedHandled = false;
    const scrubNextVideo = () => {
        if (results.files.length === 0) {
            if (!finishedHandled) {
                finishedHandled = true;

                handleClose();
            }
        }

        const firstVideo = results.files.shift();

        scrubVideo(firstVideo);

        return;
    };

    const scrubVideo = async (video) => {
        console.log(`starting video scrub for ${video.name}`);
    
        const vidInfo = ptt.parse(video.name);
    
        const outputFolder = path.dirname(video.path);

        let outputName = vidInfo.title;

        if (vidInfo.season) {
            outputName = outputName + '.' + vidInfo.season;
        }

        if (vidInfo.episode) {
            outputName = outputName + '.' + vidInfo.episode;
        }

        if (vidInfo.codec) {
            outputName = outputName + '.' + vidInfo.codec;
        }

        if (vidInfo.year) {
            outputName = outputName + '.' + vidInfo.year;
        }

        if (vidInfo.extended) {
            outputName = outputName + '.' + vidInfo.extended;
        }

        if (vidInfo.hardcoded) {
            outputName = outputName + '.' + vidInfo.hardcoded;
        }

        if (vidInfo.audio) {
            outputName = outputName + '.' + vidInfo.audio;
        }

        if (vidInfo.convert) {
            outputName = outputName + '.' + vidInfo.convert;
        }

        if (vidInfo.group) {
            outputName = outputName + '.' + vidInfo.group;
        }

        if (vidInfo.language) {
            outputName = outputName + '.' + vidInfo.language;
        }

        if (vidInfo.proper) {
            outputName = outputName + '.' + vidInfo.proper;
        }
        
        if (vidInfo.region) {
            outputName = outputName + '.' + vidInfo.region;
        }

        if (vidInfo.remastered) {
            outputName = outputName + '.' + vidInfo.remastered;
        }

        if (vidInfo.repack) {
            outputName = outputName + '.' + vidInfo.repack;
        }

        if (vidInfo.resolution) {
            outputName = outputName + '.' + vidInfo.resolution;
        }

        if (vidInfo.retail) {
            outputName = outputName + '.' + vidInfo.retail;
        }

        outputName = outputName + '.MediaOptimizer';

        if (vidInfo.container) {
            outputName = outputName + '.' + vidInfo.container;
        }

        const outputPath = path.resolve(path.join(outputFolder, outputName))
    
        ffmpeg.ffprobe(video.path, (err, data) => {
            let totalTime = 0;
            let progressBar = null;
    
            ffmpeg(video.path)
            .addOptions([
                '-c:v libx264',
                `-threads ${args.ffmpegThreads || 2}`
            ])
            .audioBitrate(128)
            .audioCodec('aac')
            .size('1280x720')
            .outputFPS(24)
            .output(outputPath)
            .on('codecData', data => {
                // HERE YOU GET THE TOTAL TIME
                totalTime = parseInt(data.duration.replace(/:/g, '')) 
    
                progressBar = multibar.create(100, 0);
             })
            .on('progress', progress => {
                // HERE IS THE CURRENT TIME
                const time = parseInt(progress.timemark.replace(/:/g, ''))
    
                // AND HERE IS THE CALCULATION
                const percent = (time / totalTime) * 100
    
                progressBar.update(Math.floor(percent * 100) / 100, { filename: video.name });
            }).on('end', () => {
                const sourceSize = fs.statSync(video.path);
                const cleanSize = fs.statSync(outputPath);
    
                console.log(`${video.name} scrub done, source was ${filesize(sourceSize.size)}, output was ${filesize(cleanSize.size)}`);

                cleanup.oldBytes = cleanup.oldBytes + sourceSize.size;
                cleanup.newBytes = cleanup.newBytes + cleanSize.size;
    
                progressBar.stop();

                if (args.cleanSource) {
                    fs.unlinkSync(video.path);
                } else {
                    fs.rename(video.path, video.path + '.bckp');

                    cleanup.oldFiles.push(video.path + '.bckp');
                }

                setTimeout(() => {
                    scrubNextVideo();
                }, args.scrubDelay || 5000);
            })
            .run();
        })
    }

    for(var i = 0; i < (args.ffmpegSpawn || 1); i++) {
        console.log(`starting scrubbing loop ${i}`);

        scrubNextVideo();
    }
}


// define our scan directory loop
const scanDirectory = (dir) => {
    console.log(`starting scan in ${dir}`);

    const files = fs.readdirSync(dir);

    // define our folder scannign loop, 
    const runFileCheckLoop = () => {

        // when our file loop is done, we want to call this functoin
        const runNextAction = () => {
            setTimeout(() => {
                if (files.length === 0) {
                    if (results.folders.length === 0) {
                        if (results.files.length === 0) {
                            handleClose();

                            return;
                        } else {
                            startVideoScrubbing();
                        }

                        return;
                    } else {
                        const nextScanDir = results.folders.shift();

                        scanDirectory(nextScanDir);
                    }
                } else {
                    runFileCheckLoop();
                }
            }, args.scanTime || 250);
        };

        // if our files in this requested directory are empty, run the next action
        if (files.length === 0) {
            runNextAction();

            return;
        }

        // grab our current folder
        const curPath = files.shift();
        // turn our current folder into a path
        const curPathFull = path.resolve(path.join(dir, curPath));

        // what type of file path are we working with here? a folder or file
        const fileType = fs.lstatSync(curPathFull);

        console.log(`  found ${curPathFull}`)
    
        if (fileType.isDirectory()) {
            results.folders.push(curPathFull);

            runNextAction();

            return;
        }
    
        if (fileType.isFile()) {
            if (curPathFull.includes('MediaOptimizer')) {
                console.warn(`  ${curPathFull} looks like it already has been ran by mediaoptimizer`)
                
                runNextAction();

                return;
            }

            const fileMime = mimeTypes.lookup(curPath);

            if (!fileMime) {
                console.warn(`  ${curPathFull} does not look like a video`)
                
                runNextAction();

                return;
            }

            if (fileMime.startsWith('video/')) {
                results.files.push({
                    path: curPathFull,
                    name: curPath,
                    mimetype: fileMime
                });
            } else {
                console.warn(`  ${curPathFull} does not look like a video`)
            }

            runNextAction();

            return;
        }
    }

    runFileCheckLoop();
}

const locateBinaries = async () => {
    // locate ffprobe
    if (typeof args.ffprobePath !== 'undefined') {
        const binPath = path.resolve(args.ffprobePath);

        if (!fs.existsSync(binPath)) {
            console.error(`Failed to locate ffprobe at ${binPath}`)

            return;
        }

        binaries.ffprobe = binPath;
    } else {
        try {
            binaries.ffprobe = await which('ffprobe');
        }
        catch(error) {
            console.error(`Failed to locate ffprobe ${error}`)
    
            return;
        }
    }

    // locate ffmpeg
    if (typeof args.ffmpegPath !== 'undefined') {
        const binPath = path.resolve(args.ffmpegPath);

        if (!fs.existsSync(binPath)) {
            console.error(`Failed to locate ffmpeg at ${binPath}`)

            return;
        }

        binaries.ffmpeg = binPath;
    } else {
        try {
            binaries.ffmpeg = await which('ffmpeg');
        }
        catch(error) {
            console.error(`Failed to locate ffmpeg ${error}`)
    
            return;
        }
    }

    const scanPath = path.resolve(args._[0] || args.scanDir || './');

    if (!fs.existsSync(scanPath)) {
        console.log(`Could not locate the directory requested to scan ${scanPath}`)

        return;
    }

    ffmpeg.setFfprobePath(binaries.ffprobe);
    ffmpeg.setFfmpegPath(binaries.ffmpeg);

    // start our application
    scanDirectory(scanPath);
}



locateBinaries();