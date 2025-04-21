# TraxIt - YouTube Audio Extractor

TraxIt is a web application that allows users to extract audio from YouTube videos. It provides a simple, clean interface for downloading audio in MP3 format from YouTube videos.

## Features

- Extract audio from YouTube videos
- Support for YouTube Shorts
- Clean, modern user interface
- Fast, reliable downloads
- No account required
- No ads or tracking

## Installation

Follow these steps to set up TraxIt locally:

1. Clone the repository:
   ```
   git clone https://github.com/rxhul/traxit.git
   cd traxit
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Start the server:
   ```
   npm start
   ```

4. Open your browser and navigate to `http://localhost:7777`

## Requirements

- Node.js 14.x or higher
- FFmpeg (for audio extraction)

### Installing FFmpeg

**On macOS (using Homebrew):**
```
brew install ffmpeg
```

**On Ubuntu/Debian:**
```
sudo apt update
sudo apt install ffmpeg
```

**On Windows:**
1. Download FFmpeg from [ffmpeg.org](https://ffmpeg.org/download.html)
2. Extract the files and add the bin folder to your PATH

## Usage

1. Paste a YouTube URL into the input field
2. Click "Extract Audio"
3. Wait for the analysis to complete
4. Click "Download Audio"
5. The MP3 file will download to your computer

## Technical Details

TraxIt uses:
- Express.js for the backend server
- ytdl-core and youtube-dl-exec for YouTube processing
- FFmpeg for audio conversion
- Vanilla JavaScript for the frontend

## Planned Features

- Support for Instagram content
- Audio quality options
- Playlists support
- Progressive Web App (PWA) features

## Legal Notice

TraxIt is designed for extracting audio from videos where you have the right to do so. This includes videos that are in the public domain, videos that you created, or videos where the creator has given permission to download the audio.

Please respect copyright laws and the YouTube Terms of Service. Do not use this tool to infringe on copyrighted content.

## License

MIT License

## Author

Rahul

## Local Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

## Deploying to Vercel

1. Sign up for an account at [Vercel](https://vercel.com/)
2. Install the Vercel CLI:
   ```bash
   npm install -g vercel
   ```
3. Login to Vercel:
   ```bash
   vercel login
   ```
4. Deploy the app:
   ```bash
   vercel
   ```
5. For production deployment:
   ```bash
   vercel --prod
   ```

### Important Notes for Vercel Deployment

1. **FFmpeg Support**: The app requires FFmpeg for audio extraction. Vercel's serverless functions don't include FFmpeg by default, so you'll need to use a modified approach:
   - Consider using a [Vercel build step](https://vercel.com/docs/concepts/functions/serverless-functions/runtimes/node-js#installing-dependencies) to install FFmpeg binaries
   - Or use a pre-built FFmpeg for Vercel environment like `@ffmpeg-installer/ffmpeg`

2. **Memory and Timeout Limits**: Audio extraction can be resource-intensive. The `vercel.json` configuration includes increased memory (1024MB) and execution time (60 seconds) for the serverless function.

3. **File System Limitations**: Vercel serverless functions have a read-only filesystem except for the `/tmp` directory. Make sure all file operations use this directory:
   ```javascript
   const tempDir = '/tmp';
   ```

4. **Environment Variables**: Set your environment variables in the Vercel dashboard.

## API Endpoints

- **POST /api/process**: Process a video URL and get metadata
- **GET /api/download/audio**: Download audio from a video URL

## Technologies Used

- Node.js
- Express
- ytdl-core
- youtube-dl-exec
- FFmpeg 