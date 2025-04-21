/**
 * TraxIt - Server-side Component
 * 
 * A tool to extract audio from YouTube videos
 */

// Required dependencies
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const ytdl = require('ytdl-core');
const { exec } = require('child_process');
const youtubeDl = require('youtube-dl-exec');
const os = require('os');
const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Create Express app
const app = express();
const PORT = process.env.PORT || 7777;

// Middleware
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', process.env.FRONTEND_URL, 'https://reel-2c4k5kyzy-rjdeep0301-gmailcoms-projects.vercel.app'].filter(Boolean),
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(__dirname));  // Serve files from the current directory

// Temporary storage for downloaded files
// Using /tmp for Vercel compatibility
const TEMP_DIR = process.env.NODE_ENV === 'production' ? '/tmp' : path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// Add a route handler for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

/**
 * Main API endpoint to analyze a URL
 * This detects the platform and extracts metadata
 */
app.post('/api/process', async (req, res) => {
    try {
        const { url } = req.body;
        
        console.log('Process API call received:');
        console.log('- Request body:', req.body);
        console.log('- URL from request:', url);
        
        if (!url) {
            console.error('Error: Missing URL in request body');
            return res.status(400).json({ error: 'URL is required' });
        }
        
        const platform = detectPlatform(url);
        console.log('- Detected platform:', platform);
        
        if (!platform) {
            console.error('Error: Unsupported platform');
            return res.status(400).json({ error: 'Unsupported platform. Please provide a YouTube URL.' });
        }
        
        let videoInfo;
        
        try {
            switch (platform) {
                case 'youtube':
                    videoInfo = await extractYouTubeInfo(url);
                    break;
                case 'instagram':
                    // Placeholder for future implementation
                    return res.status(501).json({ 
                        error: 'Instagram support coming soon',
                        message: 'We\'re working on adding Instagram support. Please use YouTube URLs for now.'
                    });
                default:
                    return res.status(400).json({ error: 'Unsupported platform. Currently only YouTube is supported.' });
            }
            
            console.log('- Video info retrieved successfully');
            
            // Send successful response
            return res.json({
                success: true,
                platform,
                videoInfo
            });
        } catch (error) {
            console.error('Error extracting video info:', error.message);
            return res.status(500).json({ error: `Error extracting video info: ${error.message}` });
        }
    } catch (error) {
        console.error('Error processing URL:', error.message);
        return res.status(500).json({ error: 'Failed to process URL' });
    }
});

/**
 * API endpoint to download audio content
 */
app.get('/api/download/audio', async (req, res) => {
    try {
        let { url, platform, title, audioQuality } = req.query;
        
        // Debug the incoming request
        console.log('Download audio request received:');
        console.log('- URL parameter:', url);
        console.log('- Platform parameter:', platform);
        console.log('- Title parameter:', title);
        console.log('- Audio quality:', audioQuality);
        console.log('- Full query:', req.query);
        
        // Make sure we have the required parameters
        if (!url) {
            console.error('Error: Missing URL parameter');
            return res.status(400).json({ error: 'URL is required' });
        }
        
        if (!platform) {
            platform = detectPlatform(url);
            if (!platform) {
                return res.status(400).json({ error: 'Could not detect platform from URL' });
            }
        }
        
        // Attempt to decode URL if it's encoded
        try {
            url = decodeURIComponent(url);
            console.log('- Decoded URL:', url);
        } catch (e) {
            console.log('- URL decoding failed, using as is');
        }
        
        // Handle URL safe encoding
        if (url.includes('%')) {
            try {
                url = decodeURIComponent(url);
                console.log('- Additional URL decoding:', url);
            } catch (e) {
                console.log('- Additional URL decoding failed');
            }
        }
        
        // Validate URL format with more flexibility
        try {
            new URL(url);
        } catch (e) {
            console.error('Error: Invalid URL format:', url);
            
            // Try to fix common URL issues
            if (url.startsWith('www.')) {
                url = 'https://' + url;
                console.log('- Fixed URL by adding https://', url);
                try {
                    new URL(url);
                } catch (e) {
                    return res.status(400).json({ error: 'Invalid URL format' });
                }
            } else {
                return res.status(400).json({ error: 'Invalid URL format' });
            }
        }
        
        // Set default value for audioQuality
        audioQuality = audioQuality || 'highest';
        
        // Sanitize the title for filename use
        const safeTitle = sanitizeFilename(title || 'audio');
        const fileName = `${safeTitle}.mp3`;
        
        // Create a header-safe filename version for Content-Disposition
        const headerSafeFilename = sanitizeFilenameForHeader(title || 'audio');
        const headerSafeFileName = `${headerSafeFilename}.mp3`;
        
        // Set download headers - use the safer version for headers
        // Use RFC 5987 encoding for the filename with special characters
        res.setHeader('Content-Disposition', `attachment; filename="${headerSafeFileName}"; filename*=UTF-8''${encodeURIComponent(headerSafeFileName)}`);
        res.setHeader('Content-Type', 'audio/mp3');
        
        if (platform === 'youtube') {
            try {
                // Handle YouTube Shorts specifically
                let isYouTubeShort = url.includes('/shorts/');
                if (isYouTubeShort) {
                    console.log('Detected YouTube Short, converting URL format...');
                    // Extract the video ID from shorts URL
                    const shortId = url.split('/shorts/')[1]?.split('?')[0];
                    if (shortId) {
                        // Convert to standard YouTube watch URL
                        url = `https://www.youtube.com/watch?v=${shortId}`;
                        console.log('Converted shorts URL to:', url);
                    }
                }
                
                // Create unique file paths
                const timestamp = Date.now();
                // Use system temp directory instead of local temp folder for better compatibility
                const tempDir = process.env.NODE_ENV === 'production' ? '/tmp' : os.tmpdir();
                const tempFilePath = path.join(tempDir, `${timestamp}_${safeTitle}.mp4`);
                const outputPath = path.join(tempDir, `${timestamp}_${safeTitle}.mp3`);
                
                console.log(`Downloading audio from YouTube: ${url}`);
                console.log(`Using temp directory: ${tempDir}`);
                console.log(`Temp video file: ${tempFilePath}`);
                console.log(`Output audio file: ${outputPath}`);
                console.log(`Using audio quality: ${audioQuality || 'highest'}`);
                
                // Verify temp directory is writable
                try {
                    fs.accessSync(tempDir, fs.constants.W_OK);
                    console.log(`Temp directory ${tempDir} is writable`);
                } catch (err) {
                    console.error(`Temp directory ${tempDir} is not writable:`, err);
                    return res.status(500).json({ 
                        error: 'Server configuration error',
                        message: 'Cannot write to temporary directory. Please contact the administrator.'
                    });
                }
                
                let downloadSuccess = false;
                
                // First try with ytdl-core
                try {
                    console.log('Trying to download audio with ytdl-core...');
                    
                    // Define ytdl options
                    const ytdlOptions = {
                        requestOptions: {
                            headers: {
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            }
                        }
                    };
                    
                    // Get the video info
                    const info = await ytdl.getInfo(url, ytdlOptions);
                    console.log(`Video found with ytdl-core: ${info.videoDetails.title}`);
                    
                    // Create write stream for video file
                    const fileWriter = fs.createWriteStream(tempFilePath);
                    
                    // Download video with specified audio quality and options
                    ytdl(url, { 
                        quality: audioQuality === 'highest' ? 'highestaudio' : audioQuality || 'highestaudio',
                        ...ytdlOptions 
                    }).pipe(fileWriter);
                    
                    // Wait for download to complete
                    await new Promise((resolve, reject) => {
                        fileWriter.on('finish', resolve);
                        fileWriter.on('error', (err) => {
                            console.error(`Error writing temp file: ${err}`);
                            reject(err);
                        });
                    });
                    
                    console.log('Video download complete with ytdl-core, checking file...');
                    
                    // Verify the file exists and has content
                    if (fs.existsSync(tempFilePath) && fs.statSync(tempFilePath).size > 0) {
                        console.log(`File exists and has size: ${fs.statSync(tempFilePath).size} bytes`);
                        console.log('Will extract audio...');
                        downloadSuccess = true;
                    } else {
                        console.log('File was not created or is empty');
                        throw new Error('Video download failed: Empty or missing file');
                    }
                } catch (ytdlError) {
                    // If ytdl-core fails, try with youtube-dl-exec
                    console.log('ytdl-core audio download failed, trying with youtube-dl-exec...');
                    console.log('ytdl-core error:', ytdlError.message);
                    
                    try {
                        // Direct download of audio using youtube-dl-exec with improved options
                        console.log('Trying direct audio download with youtube-dl-exec...');
                        
                        // Use a simpler filename for youtube-dl to avoid issues
                        const simpleName = `traxit_${timestamp}`;
                        const simpleOutput = path.join(tempDir, simpleName);
                        
                        console.log(`Using simple output path: ${simpleOutput}`);
                        
                        await youtubeDl(url, {
                            output: simpleOutput,
                            extractAudio: true,
                            audioFormat: 'mp3',
                            audioQuality: 0,  // Highest quality
                            noWarnings: true,
                            noCallHome: true,
                            noCheckCertificate: true,
                            preferFreeFormats: true,
                            addHeader: [
                                'referer:youtube.com',
                                'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                            ]
                        });
                        
                        console.log('Direct audio download attempt complete with youtube-dl-exec');
                        
                        // Add a small delay to ensure file system has completed writing
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        
                        // List all files in the temp directory to see what was actually created
                        const tempFiles = fs.readdirSync(tempDir);
                        console.log('Files in temp directory:', tempFiles.filter(f => f.includes(simpleName)).join(', '));
                        
                        // Look for our output file with different extensions
                        const possibleExtensions = ['.mp3', '.m4a', '.webm', '.mp4', '.ogg', '.opus'];
                        let foundOutputFile = null;
                        
                        for (const ext of possibleExtensions) {
                            const possibleFile = `${simpleOutput}${ext}`;
                            console.log(`Checking for ${possibleFile}`);
                            if (fs.existsSync(possibleFile)) {
                                console.log(`Found output file: ${possibleFile}`);
                                foundOutputFile = possibleFile;
                                break;
                            }
                        }
                        
                        if (foundOutputFile) {
                            console.log(`Found output file: ${foundOutputFile}`);
                            
                            // If it's already an MP3, use it directly
                            if (foundOutputFile.endsWith('.mp3')) {
                                console.log('Using MP3 file directly');
                                fs.copyFileSync(foundOutputFile, outputPath);
                                downloadSuccess = true;
                                
                                // Skip the ffmpeg conversion since we already have an MP3
                                console.log(`Audio file created: ${outputPath}, size: ${fs.statSync(outputPath).size} bytes`);
                                
                                // Set headers for download
                                res.setHeader('Content-Disposition', `attachment; filename="${headerSafeFileName}"; filename*=UTF-8''${encodeURIComponent(headerSafeFileName)}`);
                                res.setHeader('Content-Type', 'audio/mp3');
                                res.setHeader('Content-Length', fs.statSync(outputPath).size);
                                
                                // Stream the audio file to response
                                const audioFile = fs.createReadStream(outputPath);
                                
                                // Define cleanup function
                                const cleanup = () => {
                                    try {
                                        // Clean up temporary files
                                        if (foundOutputFile && fs.existsSync(foundOutputFile)) {
                                            fs.unlinkSync(foundOutputFile);
                                        }
                                        if (outputPath && fs.existsSync(outputPath)) {
                                            fs.unlinkSync(outputPath);
                                        }
                                    } catch (err) {
                                        console.error(`Error during cleanup: ${err}`);
                                    }
                                };
                                
                                // Handle errors
                                audioFile.on('error', (err) => {
                                    console.error(`Error reading audio file: ${err}`);
                                    if (!res.headersSent) {
                                        cleanup();
                                        return res.status(500).json({ error: 'Failed to read audio file' });
                                    }
                                });
                                
                                // Clean up temp files after streaming
                                audioFile.on('end', () => {
                                    console.log('File sent, cleaning up...');
                                    cleanup();
                                });
                                
                                // Send the file
                                return audioFile.pipe(res);
                            } else {
                                console.log(`Converting ${foundOutputFile} to MP3`);
                                // We'll use ffmpeg to convert whatever we got to MP3
                                tempFilePath = foundOutputFile; // Use this as input for ffmpeg later
                                downloadSuccess = true;
                            }
                        } else {
                            // Try video download instead
                            console.log('No audio file found, trying video download approach...');
                            
                            await youtubeDl(url, {
                                output: tempFilePath,
                                format: 'best',
                                noWarnings: true,
                                noCallHome: true,
                                noCheckCertificate: true,
                                preferFreeFormats: true
                            });
                            
                            // Wait and check if file exists
                            await new Promise(resolve => setTimeout(resolve, 2000));
                            
                            if (fs.existsSync(tempFilePath)) {
                                console.log('Video download complete, will convert to audio');
                                downloadSuccess = true;
                            } else {
                                throw new Error('Failed to download video file');
                            }
                        }
                    } catch (youtubeDlError) {
                        console.error('Both ytdl-core and youtube-dl-exec failed:', youtubeDlError.message);
                        console.error('Error stack:', youtubeDlError.stack);
                        
                        if (isYouTubeShort || url.includes('shorts')) {
                            return res.status(503).json({ 
                                error: 'YouTube Shorts audio download temporarily unavailable',
                                message: 'YouTube Shorts audio downloads are temporarily unavailable due to YouTube API changes. Please try a regular YouTube video instead.'
                            });
                        } else {
                            throw new Error(`YouTube audio download failed: ${youtubeDlError.message}`);
                        }
                    }
                }
                
                // Check if the temp video file exists
                if (!fs.existsSync(tempFilePath)) {
                    throw new Error('Download failed: File not created');
                }
                
                const tempFileStats = fs.statSync(tempFilePath);
                if (tempFileStats.size === 0) {
                    throw new Error('Download failed: Empty file');
                }
                
                console.log(`Temp file exists and has size: ${tempFileStats.size} bytes`);
                
                // Extract audio using ffmpeg
                try {
                    console.log(`Extracting audio to: ${outputPath}`);
                    await new Promise((resolve, reject) => {
                        const ffmpeg = spawn(ffmpegPath, [
                            '-i', tempFilePath,
                            '-vn',
                            '-acodec', 'libmp3lame',
                            '-ar', '44100',
                            '-ab', '192k',
                            '-y',
                            outputPath
                        ]);
                        
                        ffmpeg.stdout.on('data', (data) => {
                            console.log(`ffmpeg stdout: ${data}`);
                        });
                        
                        ffmpeg.stderr.on('data', (data) => {
                            console.log(`ffmpeg stderr: ${data}`);
                        });
                        
                        ffmpeg.on('close', (code) => {
                            if (code === 0) {
                                console.log('Audio extraction complete');
                                resolve();
                            } else {
                                console.error(`ffmpeg process exited with code ${code}`);
                                reject(new Error(`ffmpeg process exited with code ${code}`));
                            }
                        });
                        
                        ffmpeg.on('error', (err) => {
                            console.error(`Error executing ffmpeg: ${err}`);
                            reject(err);
                        });
                    });
                    
                    // Verify audio file exists
                    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
                        throw new Error('Audio extraction failed: File not created or is empty');
                    }
                    
                    console.log(`Audio file created: ${outputPath}, size: ${fs.statSync(outputPath).size} bytes`);
                } catch (error) {
                    console.error(`Error extracting audio: ${error}`);
                    cleanup();
                    return res.status(500).json({ error: `Error extracting audio: ${error.message}` });
                }
            } catch (error) {
                console.error(`Error extracting audio: ${error}`);
                
                // Define cleanup function if not already defined
                const cleanup = () => {
                    try {
                        // Clean up temporary files
                        if (tempFilePath && fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                        }
                        if (outputPath && fs.existsSync(outputPath)) {
                            fs.unlinkSync(outputPath);
                        }
                    } catch (err) {
                        console.error(`Error during cleanup: ${err}`);
                    }
                };
                
                cleanup();
                
                // For YouTube shorts, provide a more specific message
                if (url.includes('/shorts/') || url.includes('shorts')) {
                    return res.status(503).json({
                        error: 'YouTube Shorts audio download temporarily unavailable',
                        message: 'YouTube Shorts audio downloads are temporarily unavailable due to YouTube API changes. Please try a regular YouTube video instead.'
                    });
                } else {
                    return res.status(500).json({ error: `Failed to extract audio: ${error.message}` });
                }
            }
        } else if (platform === 'instagram') {
            // For Instagram - professional implementation needed
            console.log(`Instagram audio download functionality coming soon`);
            return res.status(501).json({ 
                error: `Instagram audio download functionality not implemented yet`,
                message: `We're working on implementing Instagram audio downloads. Please try again later.`
            });
        } else {
            // Unsupported platforms
            return res.status(400).json({ error: 'Unsupported platform for audio downloads' });
        }

        // Set headers for download
        res.setHeader('Content-Disposition', `attachment; filename="${headerSafeFileName}"; filename*=UTF-8''${encodeURIComponent(headerSafeFileName)}`);
        res.setHeader('Content-Type', 'audio/mp3');
        res.setHeader('Content-Length', fs.statSync(outputPath).size);

        // Define cleanup function if not defined earlier
        const cleanup = () => {
            try {
                // Clean up temporary files
                if (tempFilePath && fs.existsSync(tempFilePath)) {
                    fs.unlinkSync(tempFilePath);
                }
                if (outputPath && fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
            } catch (err) {
                console.error(`Error during cleanup: ${err}`);
            }
        };

        // Stream the audio file to response
        const audioFile = fs.createReadStream(outputPath);

        // Handle errors
        audioFile.on('error', (err) => {
            console.error(`Error reading audio file: ${err}`);
            if (!res.headersSent) {
                cleanup();
                return res.status(500).json({ error: 'Failed to read audio file' });
            }
        });

        // Clean up temp files after streaming
        audioFile.on('end', () => {
            console.log('File sent, cleaning up...');
            cleanup();
        });

        // Send the file
        audioFile.pipe(res);
    } catch (error) {
        console.error(`Error in audio download route: ${error}`);
        return res.status(500).json({ error: 'Failed to download audio' });
    }
});

// Detect platform from URL
function detectPlatform(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
        return 'youtube';
    } else if (url.includes('instagram.com')) {
        return 'instagram';
    }
    return null;
}

// Get YouTube video info
async function extractYouTubeInfo(url) {
    try {
        // Handle YouTube Shorts specifically
        const isYouTubeShort = url.includes('/shorts/');
        
        if (isYouTubeShort) {
            console.log('Detected YouTube Short, converting URL format...');
            // Extract the video ID from shorts URL
            const shortId = url.split('/shorts/')[1]?.split('?')[0];
            if (shortId) {
                // Convert to standard YouTube watch URL
                url = `https://www.youtube.com/watch?v=${shortId}`;
                console.log('Converted shorts URL to:', url);
            }
        }
        
        // First try with ytdl-core
        try {
            console.log('Trying to get video info with ytdl-core...');
            
            // Add a user-agent to avoid IP blocks
            const options = {
                requestOptions: {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                    }
                }
            };
            
            // Get video info with options
            const info = await ytdl.getInfo(url, options);
            
            console.log('Successfully retrieved info with ytdl-core');
            
            return {
                id: info.videoDetails.videoId,
                title: info.videoDetails.title,
                thumbnail: info.videoDetails.thumbnails[0].url,
                duration: info.videoDetails.lengthSeconds,
                author: info.videoDetails.author.name,
                url: url // Use the possibly converted URL
            };
        } catch (ytdlError) {
            // If ytdl-core fails, try with youtube-dl-exec
            console.log('ytdl-core failed, trying with youtube-dl-exec...');
            console.log('ytdl-core error:', ytdlError.message);
            
            try {
                // Use youtube-dl-exec with minimal flags to get video info
                const result = await youtubeDl(url, {
                    dumpSingleJson: true,
                    noWarnings: true,
                    preferFreeFormats: true,
                    noCheckCertificates: true,
                    youtubeSkipDashManifest: true,
                });
                
                console.log('Successfully retrieved info with youtube-dl-exec');
                
                return {
                    id: result.id,
                    title: result.title,
                    thumbnail: result.thumbnail,
                    duration: result.duration,
                    author: result.uploader,
                    url: url,
                    // Also store formats for later use in download
                    formats: result.formats
                };
            } catch (youtubeDlError) {
                console.error('Both ytdl-core and youtube-dl-exec failed:', youtubeDlError.message);
                
                // If YouTube short and both methods failed, return basic info
                if (isYouTubeShort) {
                    console.log('Using basic info for YouTube Short');
                    const videoId = url.includes('watch?v=') 
                        ? url.split('watch?v=')[1].split('&')[0]
                        : url.split('/shorts/')[1]?.split('?')[0];
                    
                    if (!videoId) {
                        throw new Error('Could not extract video ID from URL');
                    }
                    
                    // Return basic information for the short
                    return {
                        id: videoId,
                        title: `YouTube Short (${videoId})`,
                        thumbnail: `https://img.youtube.com/vi/${videoId}/0.jpg`,
                        duration: '0', // Duration unknown
                        author: 'YouTube Creator',
                        url: url,
                        isShort: true
                    };
                }
                
                // For regular videos, throw a combined error
                throw new Error(`YouTube extraction failed: ${youtubeDlError.message}`);
            }
        }
    } catch (error) {
        console.error('Error getting YouTube info:', error);
        
        // Provide more detailed error message
        let errorMessage = 'Failed to get YouTube video info';
        
        if (error.message.includes('status code: 410')) {
            errorMessage = 'This video is no longer available (410 Gone)';
        } else if (error.message.includes('status code: 403')) {
            errorMessage = 'Access to this video is forbidden (403 Forbidden)';
        } else if (error.message.includes('private video')) {
            errorMessage = 'This video is private and cannot be accessed';
        } else if (error.message.includes('sign in')) {
            errorMessage = 'This video requires you to sign in to YouTube';
        } else if (error.message.includes('copyright')) {
            errorMessage = 'This video is not available due to copyright restrictions';
        } else if (error.message.includes('extract')) {
            errorMessage = 'Unable to extract video info. This may be due to YouTube updates';
        }
        
        throw new Error(errorMessage);
    }
}

// Helper function to sanitize filenames
function sanitizeFilename(filename) {
    return filename.replace(/[/\\?%*:|"<>]/g, '-').substring(0, 100);
}

// Function to make a filename safe for Content-Disposition headers
function sanitizeFilenameForHeader(filename) {
    // Replace any non-ASCII characters and common problematic characters
    const safeFilename = filename
        .replace(/[^\x20-\x7E]/g, '') // Remove non-ASCII chars
        .replace(/[(),']/g, '') // Remove parentheses, commas, quotes
        .replace(/[&+$#@!*{}[\]=~`^]/g, '') // Remove special characters
        .replace(/\s+/g, '_') // Replace spaces with underscores
        .trim();
    
    // If the filename is now empty, use a default
    return safeFilename.length > 0 ? safeFilename : 'audio';
}

// Start the server
app.listen(PORT, () => {
    console.log(`TraxIt server running on port ${PORT}`);
});