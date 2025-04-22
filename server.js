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

// For debugging in production
const isProduction = process.env.NODE_ENV === 'production';
console.log(`Running in ${isProduction ? 'production' : 'development'} environment`);
console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
console.log(`Using FFmpeg path: ${ffmpegPath}`);

// Create Express app
const app = express();
const PORT = process.env.PORT || 7777;

// Middleware
app.use(cors({
    origin: ['http://localhost:5500', 'http://127.0.0.1:5500', process.env.FRONTEND_URL, 'https://reel-2c4k5kyzy-rjdeep0301-gmailcoms-projects.vercel.app', 'https://traxit-1r3oh4fxx-rjdeep0301-gmailcoms-projects.vercel.app'].filter(Boolean),
    methods: ['GET', 'POST'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));  // Serve files from the current directory

// Temporary storage for downloaded files
// Using /tmp for Vercel compatibility
const TEMP_DIR = process.env.NODE_ENV === 'production' ? '/tmp' : path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR);
}

// Log temp directory status
try {
    fs.accessSync(TEMP_DIR, fs.constants.W_OK);
    console.log(`Temp directory ${TEMP_DIR} is writable`);
    // List files in temp dir
    const tempFiles = fs.readdirSync(TEMP_DIR);
    console.log(`Files in temp directory: ${tempFiles.length}`);
} catch (err) {
    console.error(`Temp directory ${TEMP_DIR} is not writable:`, err);
}

// Add route handlers for the specific static files
app.get('/styles.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.sendFile(path.join(__dirname, 'styles.css'));
});

app.get('/script.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.sendFile(path.join(__dirname, 'script.js'));
});

// Add a route handler for the root path
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Add a status/health check endpoint
app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
    });
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
                                reject(new Error(`ffmpeg process failed with code ${code}`));
                            }
                        });
                        
                        ffmpeg.on('error', (err) => {
                            console.error(`ffmpeg process error: ${err}`);
                            reject(err);
                        });
                    });
                    
                    // Check if the output file exists and has content
                    if (!fs.existsSync(outputPath)) {
                        throw new Error('Audio extraction failed: Output file not created');
                    }
                    
                    const outputStats = fs.statSync(outputPath);
                    if (outputStats.size === 0) {
                        throw new Error('Audio extraction failed: Empty output file');
                    }
                    
                    console.log(`Audio file created successfully: ${outputPath} (${outputStats.size} bytes)`);
                    
                    // Set headers for file download
                    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(headerSafeFileName)}"`);
                    res.setHeader('Content-Type', 'audio/mpeg');
                    res.setHeader('Content-Length', outputStats.size);
                    
                    // Stream the audio file to response
                    const audioFile = fs.createReadStream(outputPath);
                    
                    // Define cleanup function
                    const cleanup = () => {
                        try {
                            // Clean up temporary files
                            if (fs.existsSync(tempFilePath)) {
                                fs.unlinkSync(tempFilePath);
                                console.log(`Deleted temp video file: ${tempFilePath}`);
                            }
                            if (fs.existsSync(outputPath)) {
                                fs.unlinkSync(outputPath);
                                console.log(`Deleted output audio file: ${outputPath}`);
                            }
                        } catch (cleanupErr) {
                            console.error(`Error during cleanup: ${cleanupErr}`);
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
                        console.log('File streaming completed, cleaning up...');
                        cleanup();
                    });
                    
                    // Send the file
                    return audioFile.pipe(res);
                } catch (ffmpegError) {
                    console.error('Error extracting audio:', ffmpegError.message);
                    return res.status(500).json({ error: `Error extracting audio: ${ffmpegError.message}` });
                }
            } catch (error) {
                console.error('Error extracting audio:', error.message);
                return res.status(500).json({ error: `Error extracting audio: ${error.message}` });
            }
        }
        try {
            // Check if we've reached this point with a valid platform
            if (!platform || platform !== 'youtube') {
                throw new Error('Unsupported platform or invalid URL format');
            }
        } catch (error) {
            console.error('Error processing URL:', error.message);
            return res.status(500).json({ error: 'Failed to process URL' });
        }
    } catch (error) {
        console.error('Error processing download:', error.message);
        return res.status(500).json({ error: 'Failed to process download' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Helper functions
function detectPlatform(url) {
    // Implement your logic to detect the platform based on the URL
    // This is a placeholder and should be replaced with the actual implementation
    return 'youtube'; // Placeholder, actual implementation needed
}

async function extractYouTubeInfo(url) {
    try {
        console.log(`Extracting info for YouTube URL: ${url}`);
        
        // Validate YouTube URL format
        if (!url.includes('youtube.com') && !url.includes('youtu.be')) {
            throw new Error('Invalid YouTube URL format');
        }
        
        // Use ytdl to get video info
        const ytdlOptions = {
            requestOptions: {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                }
            }
        };
        
        // Get video info from ytdl
        try {
            const info = await ytdl.getInfo(url, ytdlOptions);
            console.log(`YouTube info retrieved successfully for: ${info.videoDetails.title}`);
            
            return {
                title: info.videoDetails.title,
                duration: info.videoDetails.lengthSeconds,
                url: url,
                thumbnail: info.videoDetails.thumbnails[0]?.url || '',
                author: info.videoDetails.author.name,
                videoId: info.videoDetails.videoId
            };
        } catch (ytdlError) {
            console.error('Error extracting YouTube info with ytdl:', ytdlError.message);
            
            // Fallback to basic info
            return {
                title: 'YouTube Video',
                duration: '0:00',
                url: url
            };
        }
    } catch (error) {
        console.error('Error in extractYouTubeInfo:', error.message);
        // Return minimal valid object to prevent client errors
        return {
            title: 'YouTube Video',
            duration: '0:00',
            url: url
        };
    }
}

function sanitizeFilename(filename) {
    // Implement your logic to sanitize the filename
    // This is a placeholder and should be replaced with the actual implementation
    return filename.replace(/[^a-zA-Z0-9-_.]/g, '_');
}

function sanitizeFilenameForHeader(filename) {
    // Implement your logic to sanitize the filename for use in headers
    // This is a placeholder and should be replaced with the actual implementation
    return filename.replace(/[^a-zA-Z0-9-_.]/g, '_');
}